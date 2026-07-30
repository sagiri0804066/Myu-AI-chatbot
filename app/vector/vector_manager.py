# app/vector/vector_manager.py
import re
import os
import json
import hashlib
import time
import numpy as np
from .db_manager import chroma_db_mgr
from ..utils.utils import is_significant

# 预编译正则，避免重复编译
TAG_SPLIT_REGEX = re.compile(r'[，,\s]+')


class InMemoryVectorDB:
    def __init__(self):
        """情境总结长期记忆向量库"""
        # 缓存不同角色已同步的总结 ID 集合 (first_id)
        self._existing_ids_cache = {}

    def _get_existing_ids(self, current_uuid: str) -> set:
        """从 Chroma 缓存中获取已存在的所有总结首条消息 ID (仅获取 ID，不加载全量文档)"""
        if current_uuid not in self._existing_ids_cache:
            collection = chroma_db_mgr.get_chat_collection(current_uuid)
            try:
                existing_data = collection.get(include=[])
                self._existing_ids_cache[current_uuid] = set(existing_data['ids'])
            except Exception:
                self._existing_ids_cache[current_uuid] = set()
        return self._existing_ids_cache[current_uuid]

    def sync_update(self, episodic_memories: list, current_uuid: str):
        """自适应增量同步情境总结数据至向量库"""
        if not episodic_memories or not current_uuid:
            return

        existing_ids = self._get_existing_ids(current_uuid)
        new_memories = [m for m in episodic_memories if str(m['first_id']) not in existing_ids]

        if not new_memories:
            return

        documents = []
        metadatas = []
        new_ids = []

        for m in new_memories:
            first_id_str = str(m["first_id"])
            try:
                summary_data = json.loads(m["summary"])

                importance = float(summary_data.get("importance", 0.3))
                summary_obj = summary_data.get("summary", {})
                summary_text = summary_obj.get("summary_text", "").strip()
                tags = summary_obj.get("tags", "")
                keywords = summary_obj.get("keywords", [])

                # 过滤无意义记录
                if importance <= 0.0 or not summary_text:
                    existing_ids.add(first_id_str)
                    continue

                documents.append(summary_text)
                new_ids.append(first_id_str)

                keywords_str = ",".join(keywords) if isinstance(keywords, list) else str(keywords)

                metadatas.append({
                    "first_id": int(m["first_id"]),
                    "last_id": int(m["last_id"]),
                    "importance": importance,
                    "tags": str(tags),
                    "keywords": keywords_str
                })
            except Exception as parse_err:
                print(f"[VectorDB] Parsing summary JSON failed (ID: {first_id_str}): {parse_err}")
                existing_ids.add(first_id_str)

        if documents:
            try:
                collection = chroma_db_mgr.get_chat_collection(current_uuid)
                collection.add(
                    documents=documents,
                    metadatas=metadatas,
                    ids=new_ids
                )
                existing_ids.update(new_ids)
                print(f"[VectorDB] 角色 [{current_uuid[:8]}...] 增量同步了 {len(documents)} 条总结至 ChromaDB。")
            except Exception as e:
                print(f"[VectorDB] Sync to ChromaDB failed: {e}")

    def search(self, grouped_turns: dict, current_uuid: str, threshold: float = 0.65) -> list:
        """
        执行向量检索
        """
        if not grouped_turns or not current_uuid:
            return []

        current_text = grouped_turns.get("current", "").strip()
        previous_text = grouped_turns.get("previous", "").strip()

        is_curr_sig = is_significant(current_text)
        is_prev_sig = is_significant(previous_text)

        collection = chroma_db_mgr.get_chat_collection(current_uuid)
        collection_size = collection.count()
        if collection_size == 0:
            return []

        query_vec = None

        # 1. 话题连续性判定与 Embedding 向量生成
        if is_curr_sig and is_prev_sig:
            try:
                ef = collection._embedding_function
                embeddings = ef([current_text, previous_text])

                v1 = np.array(embeddings[0], dtype=np.float32)
                v2 = np.array(embeddings[1], dtype=np.float32)

                norm_v1 = np.linalg.norm(v1)
                norm_v2 = np.linalg.norm(v2)

                similarity = (np.dot(v1, v2) / (norm_v1 * norm_v2)) if (norm_v1 > 0 and norm_v2 > 0) else 0.0

                if similarity > 0.5:
                    # 相似度高，说明话题连贯，直接对两个向量求均值作为检索向量
                    query_vec = ((v1 + v2) / 2.0).tolist()
                else:
                    query_vec = v1.tolist()

            except Exception as e:
                print(f"Calculate cosine similarity error in search: {e}")
                query_text = f"{previous_text}\n{current_text}"
        elif is_curr_sig:
            query_text = current_text
        elif is_prev_sig:
            query_text = previous_text
        else:
            return []

        # 2. 执行向量检索
        n_res = min(10, collection_size)
        if query_vec is not None:
            results = collection.query(query_embeddings=[query_vec], n_results=n_res)
        else:
            results = collection.query(query_texts=[query_text], n_results=n_res)

        if not results['ids'] or not results['ids'][0]:
            return []

        ids = results['ids'][0]
        distances = results['distances'][0]
        metadatas = results['metadatas'][0]
        documents = results['documents'][0]

        scored_memories = []
        current_time_ms = time.time() * 1000.0

        # 3. 搜索打分与衰减计算
        for i in range(len(ids)):
            distance = distances[i]
            if distance <= threshold:
                similarity = 1.0 - (distance / 2.0) if distance < 2.0 else 0.0
                metadata = metadatas[i]

                first_id_ms = float(metadata.get("first_id", float(ids[i])))

                # 时间衰减截断（防止未来时间导致 time_weight > 1）
                days = max(0.0, (current_time_ms - first_id_ms) / (1000.0 * 60 * 60 * 24))
                time_weight = 0.5 ** (days / 30.0)

                importance = metadata.get("importance", 0.3)
                final_score = similarity * (1.0 + 0.2 * time_weight + 0.3 * importance)

                scored_memories.append({
                    "summary_text": documents[i],
                    "score": final_score
                })

        scored_memories.sort(key=lambda x: x["score"], reverse=True)
        return [item["summary_text"] for item in scored_memories[:5]]


class ImageVectorDB:
    def __init__(self):
        """全局共享：朋友圈配图标签向量库 (使Metadata 存储)"""
        self.hash_file = os.path.join(chroma_db_mgr.base_path, "moments_hash.json")

    def sync_images(self, image_tags_map: dict):
        """同步图片标签"""
        if not image_tags_map:
            return

        collection = chroma_db_mgr.get_shared_collection()

        serialized = json.dumps(image_tags_map, sort_keys=True, ensure_ascii=False)
        current_hash = hashlib.md5(serialized.encode('utf-8')).hexdigest()

        # 哈希一致，直接返回
        if os.path.exists(self.hash_file):
            try:
                with open(self.hash_file, 'r', encoding='utf-8') as f:
                    if json.load(f).get("hash") == current_hash:
                        print("[ImageVectorDB] 朋友圈素材未变动，无需重构")
                        return
            except Exception as e:
                print(f"读取公共素材库哈希失败: {e}")

        print("[ImageVectorDB] 朋友圈素材标签变动，正在重构向量库...")
        documents = []
        metadatas = []
        ids = []

        global_idx = 1
        for filename, tags_str in image_tags_map.items():
            tags = TAG_SPLIT_REGEX.split(tags_str)
            for tag in tags:
                tag_clean = tag.strip()
                if tag_clean:
                    documents.append(tag_clean)
                    metadatas.append({"filename": filename})  # 直接存入 metadata
                    ids.append(str(global_idx))
                    global_idx += 1

        if documents:
            existing_ids = collection.get(include=[])['ids']
            if existing_ids:
                collection.delete(ids=existing_ids)

            collection.add(documents=documents, metadatas=metadatas, ids=ids)

            try:
                with open(self.hash_file, 'w', encoding='utf-8') as f:
                    json.dump({"hash": current_hash}, f, ensure_ascii=False)
            except Exception as e:
                print(f"写入公共素材库哈希失败: {e}")

    def search_image(self, query_text: str, threshold: float = 0.4) -> list:
        """语义检索全局公共素材库"""
        if not query_text.strip():
            return []

        collection = chroma_db_mgr.get_shared_collection()
        collection_size = collection.count()
        if collection_size == 0:
            return []

        n_res = min(20, collection_size)
        results = collection.query(
            query_texts=[query_text],
            n_results=n_res
        )

        matched_filenames = []
        if results['ids'] and results['ids'][0]:
            distances = results['distances'][0]
            metadatas = results['metadatas'][0]

            for i in range(len(distances)):
                if distances[i] <= threshold:
                    filename = metadatas[i].get("filename")
                    if filename and filename not in matched_filenames:
                        matched_filenames.append(filename)

        return matched_filenames


if __name__ == "__main__":
    from db_manager import GLOBAL_DEFAULT_EF

    print(f"当前系统实际加载的长期记忆模型类: {type(GLOBAL_DEFAULT_EF)}")
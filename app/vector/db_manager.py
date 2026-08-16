# app/vector/db_manager.py
import os
import chromadb
import chromadb.utils.embedding_functions as embedding_functions

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

LOCAL_MODEL_PATH = os.path.abspath("./data/bge-small-zh")

GLOBAL_DEFAULT_EF = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name=LOCAL_MODEL_PATH
)


class ChromaDBManager:
    def __init__(self, base_path="./data/chromadb"):
        self.base_path = os.path.abspath(base_path)
        os.makedirs(self.base_path, exist_ok=True)
        self.client = chromadb.PersistentClient(path=self.base_path)

    def get_chat_collection(self, current_uuid: str):
        """获取对应角色的聊天记录集合"""
        if not current_uuid:
            raise ValueError("UUID 不能为空")

        safe_uuid = current_uuid.replace('-', '_')
        collection_name = f"chat_{safe_uuid}"

        return self.client.get_or_create_collection(
            name=collection_name,
            embedding_function=GLOBAL_DEFAULT_EF,
            metadata={"hnsw:space": "cosine"}
        )

    def get_shared_collection(self):
        """获取全局唯一的共享朋友圈素材集合"""
        return self.client.get_or_create_collection(
            name="moments_tags",
            embedding_function=GLOBAL_DEFAULT_EF,
            metadata={"hnsw:space": "cosine"}
        )


# 全局单一连接管理器
chroma_db_mgr = ChromaDBManager()
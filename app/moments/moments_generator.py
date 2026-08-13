# app/moments/moments_generator.py
import os
import re
import json
import time
import datetime
import base64
import random
import logging
import asyncio
from typing import Optional

from .db_manager import moments_db

from ..chat.db_manager import chat_db
from ..vector.vector_manager import ImageVectorDB
from ..config.config_manager import config_manager
from ..llm.llm_client import llm_client
from ..character.profile_manager import profile_manager
from ..utils.utils import is_asleep, get_current_time_str

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROMPT_INTENT_GENERATOR = config_manager.get("intent_generator")
PROMPT_POST_WRITER = config_manager.get("post_writer")
PROMPT_UNIFIED_CONVERSATION_WRITER = config_manager.get("unified_conversation_writer")
PROMPT_INTERACTION_WRITER = config_manager.get("interaction_writer")

# 魔法数字常量
COOLDOWN_INTERVAL_SECONDS = 12 * 3600
SMALLEST_TO_POST_TIME = 1800
POST_PROBABILITY = 0.4


class MomentsGeneratorEngine:
    def __init__(self):
        """
        初始化朋友圈生成引擎
        """
        try:
            # 拼装图片标签 JSON 文件的路径
            self.tags_file_path = os.path.join(moments_db.LIB_DIR, "moments_tags.json")
            # 统一使用 image_tags_map，初始为空字典，避免同步阻塞
            self.image_tags_map = {}
            self.image_vdb = ImageVectorDB()
            # 异步启动后台加载任务
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._sync_images_metadata())
            except RuntimeError:
                self.image_tags_map = self._load_tags_file_blocking()
        except Exception as e:
            logging.error(f"发帖引擎初始化失败: {e}", exc_info=True)

    def _load_tags_file_blocking(self) -> dict:
        """同步读取本地 JSON 的阻塞逻辑（在独立线程中安全运行）"""
        if not os.path.exists(self.tags_file_path):
            logging.error(f"同步图片向量库失败：找不到标签文件 {self.tags_file_path}")
            return {}
        with open(self.tags_file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    async def _sync_images_metadata(self):
        """把本地 moments_tags.json 里的图片和标签同步加载到内存和向量库中"""
        try:
            # 1. 异步读取本地标签文件
            image_tags_map = await asyncio.to_thread(self._load_tags_file_blocking)
            if not image_tags_map:
                return

            # 2. 写入 self.image_tags_map 作为缓存
            self.image_tags_map = image_tags_map

            # 3. 在线程池中执行向量同步
            await asyncio.to_thread(self.image_vdb.sync_images, image_tags_map)

            logging.info("朋友圈图片标签与向量数据库同步完成")
        except Exception as e:
            logging.error(f"同步图片向量库过程发生异常: {e}", exc_info=True)

    async def _call_llm(self, prompt: list[dict[str, str]], temperature: float) -> str:
        """调用大模型，在终端控制台实时流式打印出生成的内容"""
        full_reply = ""
        try:
            async for event_type, data in llm_client.chat_completion(prompt_list=prompt, temperature=temperature):
                if event_type == "status":
                    # 直接在控制台输出大模型状态
                    print(f"[{data}] ", end="", flush=True)
                elif event_type == "content":
                    full_reply += data
                    print(data, end="", flush=True)
            print("\n")
        except Exception as e:
            logging.error(f"大模型调用发生异常: {e}", exc_info=True)

        return full_reply

    async def run_central_scheduler_tick(self) -> bool:
        """中央时钟调度逻辑：负责冷却判定、加权抽奖、防刷屏以及防饿死判定"""
        try:
            now = int(time.time())

            init_data = chat_db.get_init_data()
            all_contacts = init_data.get("contacts", [])

            personal_contacts = [c for c in all_contacts if c.get("type") == "P"]
            num_agents = len(personal_contacts)
            if num_agents == 0:
                return False

            dynamic_interval = max(COOLDOWN_INTERVAL_SECONDS // num_agents, SMALLEST_TO_POST_TIME)

            global_last = moments_db.get_last_post_time()
            if (now - global_last) < dynamic_interval:
                return False

            lottery_pool = []
            total_weight = 0.0

            dt_now = datetime.datetime.fromtimestamp(now)
            current_hour = dt_now.hour + (dt_now.minute / 60.0)

            for agent in personal_contacts:
                agent_uuid = agent.get("uuid")
                card_data = agent.get("card_data", "")
                if not agent_uuid:
                    continue

                profile = await profile_manager.get_or_create_profile(agent_uuid, card_data)

                # 提取夜猫子系数并校验是否处于睡眠时间段
                night_owl_coef = float(profile.get("night_owl_coefficient", 1.0))
                if is_asleep(current_hour, night_owl_coef):
                    continue

                social_active_index = profile.get("social_active_index", 1.0)

                last_post_time = moments_db.get_last_post_time(agent_uuid)
                days_since_last = max((now - last_post_time) / (24 * 3600), 0.1)

                weight = (days_since_last ** 1.5) * social_active_index

                lottery_pool.append({"agent": agent, "weight": weight})
                total_weight += weight

            if not lottery_pool or total_weight <= 0.0:
                return False

            roll = random.uniform(0, total_weight)
            current_sum = 0.0
            winner_agent = lottery_pool[0]["agent"]

            for entry in lottery_pool:
                current_sum += entry["weight"]
                if roll <= current_sum:
                    winner_agent = entry["agent"]
                    break

            if random.random() > POST_PROBABILITY:
                return False

            print(f"[Moments] 摇号角色: {winner_agent.get('nickname')}")
            return await self.publish_agent_moment(winner_agent["uuid"])

        except Exception as e:
            logging.error(f"时钟判定执行失败: {e}", exc_info=True)
            return False

    def _match_best_asset_by_vector(self, keywords: list[str]) -> dict[str, str]:
        """根据关键词进行向量检索，匹配出最合适且没有重复发送过的图片"""
        if not keywords:
            return self._get_fallback_asset()

        # 从数据库读取所有已用图片，排除掉，防止重复发图
        used_images = set(moments_db.get_used_images())
        scores = {}
        for kw in keywords:
            kw_clean = kw.strip()
            if not kw_clean:
                continue

            try:
                matched_files = self.image_vdb.search_image(kw_clean)
                for rank, filename in enumerate(matched_files):
                    if filename in used_images:
                        continue
                    weight = 1.0 / (rank + 1)
                    scores[filename] = scores.get(filename, 0.0) + weight
            except Exception as e:
                logging.error(f"向量检索关键词 '{kw_clean}' 失败: {e}")

        best_filename = None
        max_score = -1.0

        for filename, score in scores.items():
            final_score = score + random.uniform(0, 0.1)
            if final_score > max_score:
                max_score = final_score
                best_filename = filename

        if best_filename:
            tags = self._get_tags_by_filename(best_filename)
            return {"file": best_filename, "tags": tags}

        return self._get_fallback_asset()

    def _get_tags_by_filename(self, filename: str) -> str:
        try:
            return self.image_tags_map.get(filename, "空")
        except Exception as e:
            print(e)
            return "空"

    def _get_fallback_asset(self) -> dict[str, str]:
        """当没有匹配到图片时的逻辑（优先选没用过的，全用过则重置记录，开始新的大循环）"""
        try:
            used_images = set(moments_db.get_used_images())
            if self.image_tags_map:
                available_files = [fn for fn in self.image_tags_map.keys() if fn not in used_images]

                if available_files:
                    rand_file = random.choice(available_files)
                    return {"file": rand_file, "tags": self.image_tags_map[rand_file]}
                else:
                    logging.warning("所有图片模板已全部发送过一遍。正在自动清空排重表，开启新一轮循环...")
                    moments_db.reset_used_images()
                    rand_file = random.choice(list(self.image_tags_map.keys()))
                    return {"file": rand_file, "tags": self.image_tags_map[rand_file]}

        except Exception as e:
            logging.error(f"获取兜底配图失败: {e}")

        # 如果 JSON 也损坏了
        try:
            all_files = [f for f in os.listdir(moments_db.LIB_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
            if all_files:
                return {"file": all_files[0], "tags": "空"}
        except Exception as e:
            print(e)
            return {"file": "", "tags": "空"}

    def _get_base64_appendix(self, filename: str) -> Optional[str]:
        """读取本地图片文件并将其转化为 Base64 格式，供发布接口调用"""
        file_path = os.path.join(moments_db.LIB_DIR, filename)
        if not os.path.exists(file_path):
            logging.error(f"找不到本地物理文件: {file_path}")
            return None
        try:
            with open(file_path, "rb") as image_file:
                encoded = base64.b64encode(image_file.read()).decode('utf-8')
                ext = os.path.splitext(filename)[1].lower().replace(".", "")
                if ext in ["jpg", "jpeg"]:
                    ext = "jpeg"
                return f"data:image/{ext};base64,{encoded}"
        except Exception as e:
            logging.error(f"配图转 Base64 失败: {e}")
            return None

    async def publish_agent_moment(self, sender_uuid: str) -> bool:
        """ 生成朋友圈 """
        try:
            speaker_info = moments_db.get_contact_info_by_uuid(sender_uuid)
            if not speaker_info:
                logging.error(f"Post failed: Character {sender_uuid} not found")
                return False

            nickname = speaker_info.get("nickname", "AI")
            char_card = speaker_info.get("card_data", "")

            # 提取对话上下文作为灵感
            latest_msgs = chat_db.get_latest_messages(10, sender_uuid)
            context_summary = ""
            if latest_msgs:
                context_summary = "\n".join([f"{m['role']}: {m['text']}" for m in latest_msgs])

            # 生成意图和关键词
            intent_text, keywords = await self._generate_intent_and_keywords(nickname, char_card, context_summary)
            if not intent_text or not keywords:
                return False

            # 匹配配图
            matched_asset = self._match_best_asset_by_vector(keywords)
            img_tags = matched_asset["tags"]

            # 格式输出示例：2026-07-28 18:30 星期二
            current_time = get_current_time_str()

            # 撰写朋友圈内容
            writing_prompt = [{
                "role": "system",
                "content": PROMPT_POST_WRITER.format(
                    nickname=nickname,
                    char_card=char_card,
                    intent=intent_text,
                    img_tags=img_tags,
                    current_time=current_time
                )
            }]

            print(f"[Moments] Generating post text for {nickname}...")
            moment_text = await self._call_llm(writing_prompt, temperature=0.9)
            moment_text = moment_text.strip().strip('"').strip('\'')

            b64_str = self._get_base64_appendix(matched_asset["file"])
            if not b64_str:
                return False

            # 写入动态本体并获取新生成的 UUID [1]
            moment_uuid = moments_db.add_moment(
                text=moment_text,
                appendix_list=[b64_str],
                sender_uuid=sender_uuid
            )

            if not moment_uuid:
                return False

            moments_db.mark_image_as_used(matched_asset["file"])
            print(f"[Moments] Moment posted successfully. UUID: {moment_uuid}")

            # 触发盖楼和点赞模拟
            await self._simulate_and_write_interactions(
                moment_id=moment_uuid,
                sender_uuid=sender_uuid,
                sender_name=nickname,
                post_text=moment_text,
                img_tags=img_tags
            )
            return True

        except Exception as e:
            logging.error(f"publish_agent_moment error: {e}", exc_info=True)
            return False

    async def _get_enriched_post_text(self, post_text: str, appendix_json: Optional[str],
                                      fallback_tags: str = "") -> str:
        """ 解析 appendix，获取 VLM 图片描述并追加到文案（兼容 Base64 和物理相对路径）"""
        if not appendix_json:
            return f"{post_text} 图片内容：{fallback_tags}" if fallback_tags else post_text

        try:
            img_paths = json.loads(appendix_json)
            if not img_paths:
                return f"{post_text} 图片内容：{fallback_tags}" if fallback_tags else post_text

            img_path = img_paths[0]

            # A. 兼容 Base64 数据
            if img_path.startswith("data:image") or ";base64," in img_path:
                img_desc = await llm_client.describe_image(img_path)
                if img_desc:
                    return f"{post_text} 图片内容：{img_desc}"
                return post_text

            # B. 兼容本地物理相对路径
            img_path_clean = img_path.lstrip("/\\")
            img_path_abs = os.path.join(PROJECT_ROOT, img_path_clean)

            # 若 PROJECT_ROOT 在子目录下（如 /app），则尝试向上一级目录寻找
            if not os.path.exists(img_path_abs):
                img_path_abs = os.path.join(os.path.dirname(PROJECT_ROOT), img_path_clean)

            if os.path.exists(img_path_abs):
                img_desc = await llm_client.describe_image(img_path_abs)
                if img_desc:
                    return f"{post_text} 图片内容：{img_desc}"
            else:
                print(f"⚠️ 图片物理文件不存在: {img_path_abs}")

        except Exception as e:
            logging.error(f"解析朋友圈 VLM 描述失败: {e}", exc_info=True)

        return f"{post_text} 图片内容：{fallback_tags}" if fallback_tags else post_text

    def _get_agent_starvation_boost(self, agent_uuid: str, now: int, max_boost: float = 4.0) -> float:
        """依据上次互动时间计算防冷落权重"""
        last_interact = moments_db.get_last_interaction_time(agent_uuid)
        hours_since_last_interact = max((now - last_interact) / 3600.0, 0.1)
        return min(1.0 + (hours_since_last_interact / 24.0) ** 1.5, max_boost)

    async def _generate_and_save_batch_comments(
            self,
            moment_uuid: str,
            sender_name: str,
            post_text: str,
            img_tags: str,
            planned_comments: list,
            start_time: int
    ) -> None:
        """合并调用模型进行批量填词，并分配顺序递增的时间戳写入数据库"""
        if not planned_comments:
            return

        planned_structure_str = ""
        unique_characters = {}

        # 整理楼层结构和人设需求
        for item in planned_comments:
            unique_characters[item["uuid"]] = (item["name"], item["char_card"])
            if item.get("reply_to_temp_id"):
                planned_structure_str += f"- ID: {item['temp_id']} | 【{item['name']}】回复了 ID 为 {item['reply_to_temp_id']} 的评论【{item['reply_to_name']}】\n"
            elif item.get("reply_to_name"):
                planned_structure_str += f"- ID: {item['temp_id']} | 【{item['name']}】回复了【{item['reply_to_name']}】\n"
            elif item["type"] == "self_comment":
                planned_structure_str += f"- ID: {item['temp_id']} | 【{item['name']}】自评\n"
            elif item["type"] == "direct_comment":
                planned_structure_str += f"- ID: {item['temp_id']} | 【{item['name']}】直接评论\n"

        character_traits_summary = ""
        for u_id, (name, trait) in unique_characters.items():
            character_traits_summary += f"【{name}】人设:\n{trait[:80]}\n\n"

        unified_comment_prompt = [{
            "role": "system",
            "content": PROMPT_UNIFIED_CONVERSATION_WRITER.format(
                sender_name=sender_name,
                post_text=post_text,
                img_tags=img_tags,
                planned_comments_structure=planned_structure_str,
                character_traits_summary=character_traits_summary
            )
        }]

        print(f"[Moments] Requesting LLM for batch comments ({len(planned_comments)} replies planned)...")
        comment_json_str = await self._call_llm(unified_comment_prompt, temperature=0.8)

        text_map = {}
        try:
            match = re.search(r'\{.*\}', comment_json_str, re.DOTALL)
            if match:
                text_map = json.loads(match.group())
        except Exception as parse_err:
            logging.error(f"Parse batch comments JSON failed: {parse_err}")
            return

        # 写入数据库，并分配错落的虚拟时间戳
        simulated_time = start_time + random.randint(30, 90)

        for item in planned_comments:
            temp_id = item["temp_id"]
            generated_text = text_map.get(temp_id, "").strip()

            if not generated_text:
                continue

            simulated_time += random.randint(90, 240)

            moments_db.add_comment(
                moment_uuid=moment_uuid,
                sender_uuid=item["uuid"],
                comment_dict={
                    "text": generated_text,
                    "reply_to": item["reply_to_uuid"],
                    "created_at": simulated_time
                }
            )
            print(
                f"[Moments] Saved comment: {item['name']} (delay: {simulated_time - start_time}s) -> {generated_text}")

    async def _generate_intent_and_keywords(self, nickname, char_card, context_summary) -> tuple[str, list]:
        """ 提取意图与关键词 """
        current_time = get_current_time_str()
        prompt = [{
            "role": "system",
            "content": PROMPT_INTENT_GENERATOR.format(
                nickname=nickname,
                char_card=char_card,
                context_summary=context_summary,
                current_time=current_time
            )
        }]
        for attempt in range(3):
            print(f"[Moments] Generating intent JSON for {nickname} (attempt {attempt + 1}/3)...")
            intent_json_str = await self._call_llm(prompt, temperature=0.9)
            try:
                match = re.search(r'\{.*\}', intent_json_str, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    intent_text = data.get("intent", "").strip()
                    keywords = data.get("keywords", [])
                    if intent_text and keywords:
                        print(f"[Moments] Intent: {intent_text} | Keywords: {keywords}")
                        return intent_text, keywords
            except Exception:
                logging.warning(f"[Moments] Parse intent JSON failed (attempt {attempt + 1}), retrying...")
        return "", []

    async def _simulate_and_write_interactions(self, moment_id: str, sender_uuid: str, sender_name: str, post_text: str,
                                               img_tags: str):
        """ 模拟互动结构并调用大模型批量生成文本 """
        try:
            now = int(time.time())
            init_data = chat_db.get_init_data()
            all_agents = [c for c in init_data.get("contacts", []) if c.get("type") == "P"]

            # A. 提取视觉描述文案
            moment_data = moments_db.get_moment_by_uuid(moment_id)
            appendix_json = moment_data.get("appendix") if moment_data else None
            enriched_post_text = await self._get_enriched_post_text(post_text, appendix_json, img_tags)

            # 1. 模拟点赞逻辑
            for agent in all_agents:
                if agent["uuid"] == sender_uuid:
                    continue
                profile = await profile_manager.get_or_create_profile(agent["uuid"], agent["card_data"])
                anti_starvation_boost = self._get_agent_starvation_boost(agent["uuid"], now, max_boost=3.0)

                # 判定点赞
                if random.random() < (0.45 * profile.get("social_active_index", 1.0) * anti_starvation_boost):
                    praise_delay = random.randint(10, 240)
                    moments_db.toggle_praise(
                        moment_uuid=moment_id,
                        sender_uuid=agent["uuid"],
                        created_at=now + praise_delay
                    )
                    print(f"[Moments] Praise scheduled: {agent['nickname']} (delay: {praise_delay}s)")

            # 2. 计算盖楼结构
            planned_comments = []
            fatigue_map = {agent["uuid"]: 1.0 for agent in all_agents}
            direct_commented_users = set()

            max_comments = 5
            global_energy = 1.0

            while len(planned_comments) < max_comments and global_energy > 0.15:
                candidates = []

                for agent in all_agents:
                    agent_uuid = agent["uuid"]
                    profile = await profile_manager.get_or_create_profile(agent_uuid, agent["card_data"])
                    anti_starvation_boost = self._get_agent_starvation_boost(agent_uuid, now, max_boost=4.0)
                    fatigue = fatigue_map.get(agent_uuid, 1.0)

                    if agent_uuid == sender_uuid:
                        if len(planned_comments) == 0:
                            base_impulse = 0.15 * profile.get("social_active_index", 1.0)
                            weight = base_impulse * fatigue
                            candidates.append({
                                "type": "self_comment",
                                "agent": agent,
                                "weight": weight,
                                "target": None
                            })
                    else:
                        if agent_uuid not in direct_commented_users:
                            base_impulse = 0.20 * profile.get("comment_initiative", 1.0)
                            weight = base_impulse * anti_starvation_boost * fatigue
                            candidates.append({
                                "type": "direct_comment",
                                "agent": agent,
                                "weight": weight,
                                "target": None
                            })

                for parent_comment in planned_comments:
                    parent_uuid = parent_comment["uuid"]

                    for agent in all_agents:
                        agent_uuid = agent["uuid"]
                        if agent_uuid == parent_uuid:
                            continue

                        profile = await profile_manager.get_or_create_profile(agent_uuid, agent["card_data"])
                        fatigue = fatigue_map.get(agent_uuid, 1.0)

                        if agent_uuid == sender_uuid:
                            base_impulse = 0.45 * profile.get("comment_initiative", 1.0)
                            weight = base_impulse * fatigue
                        else:
                            base_impulse = 0.08 * profile.get("comment_initiative", 1.0)
                            weight = base_impulse * fatigue

                        candidates.append({
                            "type": "reply_comment",
                            "agent": agent,
                            "weight": weight,
                            "target": parent_comment
                        })

                if not candidates:
                    break

                for c in candidates:
                    c["final_score"] = c["weight"] * random.uniform(0.6, 1.4) * global_energy

                candidates.sort(key=lambda x: x["final_score"], reverse=True)
                winner = candidates[0]

                if winner["final_score"] < 0.05:
                    break

                actor = winner["agent"]
                actor_uuid = actor["uuid"]
                actor_name = actor["nickname"]
                action_type = winner["type"]
                target = winner["target"]

                temp_id = f"temp_id_{len(planned_comments) + 1}"

                planned_comments.append({
                    "temp_id": temp_id,
                    "uuid": actor_uuid,
                    "name": actor_name,
                    "type": action_type,
                    "char_card": actor["card_data"],
                    "reply_to_uuid": target["uuid"] if target else None,
                    "reply_to_name": target["name"] if target else None,
                    "reply_to_temp_id": target["temp_id"] if target else None,
                })

                if action_type == "direct_comment":
                    direct_commented_users.add(actor_uuid)

                fatigue_map[actor_uuid] = 0.15

                for k in fatigue_map:
                    if k != actor_uuid:
                        fatigue_map[k] = min(1.0, fatigue_map[k] + 0.3)

                global_energy *= 0.85

            if not planned_comments:
                return

            # 3. 构造填词并写入数据库
            await self._generate_and_save_batch_comments(
                moment_uuid=moment_id,
                sender_name=sender_name,
                post_text=enriched_post_text,
                img_tags=img_tags,
                planned_comments=planned_comments,
                start_time=now
            )

        except Exception as e:
            logging.error(f"simulate_and_write_interactions error: {e}", exc_info=True)

    async def on_user_comment_added(self, moment_uuid: str, user_text: str = "", reply_to_uuid: Optional[str] = None):
        """用户评论后触发指定 AI 角色针对该句评论进行单条回复"""
        try:
            target_comment = user_text.strip()
            if not target_comment:
                return

            moment = moments_db.get_moment_by_uuid(moment_uuid)
            if not moment:
                return

            post_owner_uuid = moment.get("sender_uuid")
            post_text = moment.get("text", "")

            # 确定被触发回复的 AI 角色 UUID
            target_agent_uuid = reply_to_uuid if (reply_to_uuid and reply_to_uuid != "user") else post_owner_uuid
            if not target_agent_uuid or target_agent_uuid == "user":
                return

            speaker_info = moments_db.get_contact_info_by_uuid(target_agent_uuid)
            if not speaker_info:
                return

            nickname = speaker_info.get("nickname", "未知")
            char_card = speaker_info.get("card_data", "")
            if nickname == "未知" or not char_card:
                return

            owner_info = moments_db.get_contact_info_by_uuid(post_owner_uuid) if post_owner_uuid else None
            sender_name = owner_info.get("nickname", "未知") if owner_info else "未知"

            # 获取用户的真实昵称
            init_data = chat_db.get_init_data()
            user_info = init_data.get("user", {})
            user_nickname = user_info.get("nickname", "User")
            if not user_nickname:
                user_nickname = "User"

            # 说话的人永远是用户
            target_name = user_nickname

            all_agents = [c for c in init_data.get("contacts", []) if c.get("type") == "P"]
            agents_map = {a["uuid"]: a for a in all_agents}

            # 格式化历史评论记录
            db_comments = json.loads(moment["comments"]) if moment.get("comments") else []
            current_time = int(time.time())

            comments_list = []
            for c in db_comments:
                if c.get("created_at", 0) <= current_time:
                    c_sender = c.get("sender_uuid")
                    c_name = user_nickname if (c_sender is None or c_sender == "user") else agents_map.get(c_sender,
                                                                                                           {}).get(
                        "nickname", "未知")

                    c_reply_to = c.get("reply_to")
                    if c_reply_to:
                        reply_target_name = user_nickname if c_reply_to == "user" else agents_map.get(c_reply_to,
                                                                                                      {}).get(
                            "nickname", "未知")
                        reply_str = f"回复[{reply_target_name}]: "
                    else:
                        reply_str = ": "

                    comments_list.append(f"  * [{c_name}]{reply_str}\"{c.get('text', '')}\"")

            conversation_history = "\n".join(comments_list) if comments_list else "  * 暂无评论"

            # 构造单句对答提示词
            prompt = [{
                "role": "system",
                "content": PROMPT_INTERACTION_WRITER.format(
                    nickname=nickname,
                    sender_name=sender_name,
                    post_text=post_text,
                    conversation_history=conversation_history,
                    target_name=target_name,
                    target_comment=target_comment,
                    char_card=char_card
                )
            }]

            print(f"[Moments] Generating target reaction for {nickname} to '{target_name}: {target_comment}'...")
            reply_text = await self._call_llm(prompt, temperature=0.8)
            reply_text = reply_text.strip().strip('"').strip('\'')

            if not reply_text:
                return

            # 写入数据库
            simulated_time = current_time + random.randint(30, 90)
            moments_db.add_comment(
                moment_uuid=moment_uuid,
                sender_uuid=target_agent_uuid,
                comment_dict={
                    "text": reply_text,
                    "reply_to": "user",
                    "created_at": simulated_time
                }
            )
            print(f"[Moments] Saved single reaction comment: {nickname} -> {reply_text}")

        except Exception as e:
            logging.error(f"on_user_comment_added error: {e}", exc_info=True)
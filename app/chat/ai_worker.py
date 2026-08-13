# app/chat/ai_worker.py
import asyncio
import json
import re
import time
from datetime import datetime
import random
from typing import Optional, List

from .buffer_heap import heap
from .db_manager import chat_db
from .summary import summary_pipeline

from ..moments.db_manager import moments_db
from ..config.config_manager import config_manager
from ..vector.vector_manager import InMemoryVectorDB
from ..llm.llm_client import llm_client
from ..character.profile_manager import profile_manager
from ..utils.utils import should_trigger_proactive, get_current_time_str, parse_wakeup_sleep_time


# 1. 上下文与 Prompt 组装器
class ContextBuilder:
    def __init__(self, vdb: InMemoryVectorDB):
        self.vdb = vdb

    def build_prompt(self, current_input: str, init_data: dict, speaker_info: dict, auto: Optional[bool] = None,
                     merged_count: int = 30, wakeup_remark: Optional[str] = None) -> List[dict]:
        user_info = init_data.get("user", {})
        user_nickname = user_info.get("nickname", "用户")
        current_contact = init_data.get("contact", {})
        is_group = (current_contact.get("type") == "G")
        speaker_nickname = speaker_info.get("nickname", "AI")
        target_speaker_uuid = speaker_info.get("uuid")

        # 格式化人设卡
        u_header = f'nickname: "{user_nickname}", org: "{user_info.get("org", "")}", gender: "{user_info.get("gender", "")}", birthday: "{user_info.get("birthday", "")}", hobbies: "{user_info.get("hobbies", "")}"'
        char_card = speaker_info.get("card_data", "").replace("{{user}}", user_nickname)
        char_card_formatted = f"[这是user的个人信息:{u_header}\n这是你的个人设定:{char_card}]"

        # 长期记忆
        ltm_list = self._retrieve_ltm(current_contact.get("uuid"), target_speaker_uuid, is_group)
        moments_context = self._assemble_moments() or []

        # 短期记忆
        stm_msgs = chat_db.get_latest_messages(limit=merged_count)
        nickname_map = {c['uuid']: c['nickname'] for c in init_data.get("contacts", [])}
        stm_list = self._assemble_stm(stm_msgs, is_group, user_nickname, nickname_map, speaker_nickname)

        # 组装基础消息
        if auto or wakeup_remark:
            decision_stm = chat_db.get_latest_messages(limit=10)
            decision_history_lines = [
                f"[{m['time']}][{user_nickname if m['role'] == 'user' else speaker_nickname}]: {m['text']}"
                for m in decision_stm
            ]
            messages = ltm_list + moments_context

            template_name = "wakeup_message" if wakeup_remark else "auto_message"
            template = config_manager.get(template_name)

            messages.append({
                "role": "system",
                "content": template.format(
                    nickname=speaker_nickname,
                    char_data=char_card,
                    user_nickname=user_nickname,
                    user_data=u_header,
                    current_time=get_current_time_str(),
                    chat_history="\n".join(decision_history_lines),
                    remark=wakeup_remark or ""
                )
            })
            final_prompt = messages
        else:
            messages = stm_list + moments_context + ltm_list
            scheduled_tasks = None
            if not is_group:
                tasks = chat_db.get_wakeup_tasks(target_speaker_uuid)
                scheduled_tasks = json.dumps(
                    [
                        {
                            "wakeup_time": task["wakeup_time"],
                            "remark": task["remark"]
                        }
                        for task in tasks
                    ],
                    ensure_ascii=False,
                    indent=2
                )
            final_prompt = llm_client.call_st_preset(messages,current_input,char_card_formatted,scheduled_tasks)

        if is_group:
            final_prompt.append({
                "role": "system",
                "content": f"[System Command]\n你当前在群聊中必须且只能扮演角色 [{speaker_nickname}]。\n严禁替群聊中的其他成员发言，严禁在回复中输出他人的名字前缀。"
            })

        return final_prompt

    def _retrieve_ltm(self, current_uuid, target_speaker_uuid, is_group):
        ltm_list = []
        all_memories = chat_db.get_all_episodic_memories(target_uuid=current_uuid)
        self.vdb.sync_update(all_memories, current_uuid)

        fact_target_uuid = target_speaker_uuid if is_group else None
        facts_list = chat_db.get_all_semantic_memories(target_uuid=fact_target_uuid)
        if facts_list:
            formatted_facts = "\n".join([f"- {item['fact']}" for item in facts_list])
            ltm_list.append({"role": "system", "content": f"### 你已知关于对方的了解与事实 ###:\n{formatted_facts}"})

        grouped_turns = chat_db.get_grouped_turns_by_role()
        target = target_speaker_uuid if is_group else current_uuid
        retrieved_summaries = self.vdb.search(grouped_turns, target)
        for summary in (retrieved_summaries or []):
            ltm_list.append({"role": "system", "content": f"### 你的回忆 ###: \n{summary}"})
        return ltm_list

    def _assemble_moments(self):
        recent_moments = moments_db.get_moments(limit=3)
        if not recent_moments:
            return []
        res = [{"role": "system",
                "content": "### 社交朋友圈近况动态 (最新3条) ###\n你可以选择在谈话逻辑自然的情况下作为破冰话题，不要刻意全盘念出..."}]
        for m in recent_moments:
            author = m.get("nickname", "未知")
            text = m.get("text", "")
            praises = "、".join(m.get("praise", [])) if m.get("praise") else "无"
            comments = [f"  * [{c.get('name')}]" + (
                f"回复[{c.get('reply_to_name')}]: " if c.get('reply_to_name') else ": ") + f"\"{c.get('text')}\"" for c
                        in m.get("comments", [])]
            comments_str = "\n".join(comments) if comments else "  * 暂无评论"
            res.append({"role": "system",
                        "content": f"[发布人]: {author}\n[内容]: \"{text}\"\n[点赞]: {praises}\n[评论区]:\n{comments_str}"})
        return res

    def _assemble_stm(self, stm_msgs, is_group, user_nickname, nickname_map, speaker_nickname):
        stm_list = []
        for m in stm_msgs:
            r = m['role']
            if is_group:
                p_name = user_nickname if r == "user" else nickname_map.get(m.get("sender_uuid"), speaker_nickname)
                stm_list.append({"role": r, "content": f"[{m['time']}][{p_name}]: {m['text']}"})
            else:
                stm_list.append({"role": r, "content": f"[{m['time']}] {m['text']}"})
        return stm_list


# 2. 回复清洗、落库器
class ResponseProcessor:
    @staticmethod
    def clean_reply(full_reply: str) -> str:
        reply = re.sub(r'<thinking>.*?</thinking>', '',full_reply, flags=re.DOTALL | re.IGNORECASE)
        reply = re.sub(r'<think>.*?</think>','',reply,flags=re.DOTALL | re.IGNORECASE)
        return re.sub(r'<schedule_wakeup>.*?</schedule_wakeup>','',reply,flags=re.DOTALL | re.IGNORECASE)

    @staticmethod
    def extract_blocks(reply: str) -> List[str]:
        if "<chat>" not in reply or "</chat>" not in reply:
            lines = reply.split('\n')
            reply = "".join(f"<chat>{line.strip()}</chat>" for line in lines if line.strip())
        return re.findall(r'<chat>(.*?)</chat>', reply, re.DOTALL)

    @staticmethod
    async def save_block_with_delay(block: str, is_group: bool, speaker_nickname: str, target_speaker_uuid: str) -> str:
        block = re.sub(r'\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}', '', block)
        block = re.sub(r'\d{1,2}:\d{2}(:\d{2})?', '', block)
        block = re.sub(r'<[^>]+>', '', block).strip().lstrip('[][] ').strip()

        if is_group:
            block = re.sub(rf'^\[?{re.escape(speaker_nickname)}\]?[:：\s]*', '', block).strip()

        if not block:
            return ""

        heap.update_status(3)
        delay_sec = min(1 + (len(block) * 0.1), 10.0)
        await asyncio.sleep(delay_sec)

        final_id = int(time.time() * 1000)
        msg_to_save = {
            "id": final_id,
            "role": "assistant",
            "text": block,
            "time": time.strftime("%Y/%m/%d %H:%M", time.localtime(final_id / 1000))
        }
        if is_group:
            msg_to_save["sender_uuid"] = target_speaker_uuid

        chat_db.save_message(msg_to_save)
        return block


# 3. 核心调度引擎
class MoYunxiEngine:
    def __init__(self):
        self.vdb = InMemoryVectorDB()
        self.context_builder = ContextBuilder(self.vdb)
        self.processor = ResponseProcessor()
        self.active_task = None
        self._background_tasks = set()
        self.merged_count = 30
        self.min_merged_count = 30
        self.max_merged_count = 50

    def interrupt(self):
        if self.active_task and not self.active_task.done():
            self.active_task.cancel()
            heap.update_status(0)
            print("收到打断信号，已掐断上一轮流水线")

    async def on_new_message(self, text: str, auto: Optional[bool] = None, wakeup_remark: Optional[str] = None):
        if self.active_task and not self.active_task.done():
            self.interrupt()

        self.active_task = asyncio.create_task(self._pipeline(text, auto, wakeup_remark))
        try:
            await self.active_task
        except asyncio.CancelledError:
            print("流水线已取消")

    async def _router_decision(self, text, current_contact, nickname_map, user_nickname, is_group):
        if not is_group:
            return current_contact.get("uuid")

        decision_stm = chat_db.get_latest_messages(limit=10)
        decision_history_lines = [
            f"[{user_nickname if m['role'] == 'user' else nickname_map.get(m.get('sender_uuid'), '已退群成员')}]: {m['text']}"
            for m in decision_stm
        ]

        existing_members = [m for m in current_contact.get("members", []) if m in nickname_map]
        if not existing_members:
            return None

        member_briefs = "".join(
            [f"- 昵称: {chat_db.get_contact_info_by_uuid(mid)['nickname']} | 必须返回的UUID: {mid}\n"
             for mid in existing_members if chat_db.get_contact_info_by_uuid(mid)])

        prompt = [
            {"role": "system", "content": config_manager.get("decision_router")},
            {"role": "user",
             "content": f"[可选群成员列表]\n{member_briefs}\n\n[群聊历史对话草稿]\n====================\n"
                        f"\n".join(decision_history_lines) + f"\n====================\n\n[最新消息]: {text}\n\n"
                                                             f"请分析上述聊天记录，并输出 JSON。记住你当前是分发器，严禁扮演群内成员直接回复用户！"}
        ]

        try:
            res_json = await llm_client.get_simple_completion(prompt)
            match = re.search(r'\{.*\}', res_json, re.DOTALL)
            if match:
                nxt = json.loads(match.group()).get("next_id")
                if nxt and str(nxt).upper() != "NULL":
                    return str(nxt)
        except Exception as e:
            print(f"路由决策失败: {e}")
        return None

    async def _request_reply(self, final_prompt):
        full_reply = ""
        try:
            async for event_type, data in llm_client.chat_completion(final_prompt):
                if event_type == "status":
                    status_map = {"status_busy": 1, "status_offline": 2, "status_ok": 3}
                    if data in status_map:
                        heap.update_status(status_map[data])
                        if data != "status_ok":
                            return None
                elif event_type == "content":
                    full_reply += data
                    print(data, end="", flush=True)
            print("\n")
        except asyncio.CancelledError:
            heap.update_status(0)
            raise
        return full_reply

    async def _pipeline(self, newest_text: str, auto: Optional[bool] = None, wakeup_remark: Optional[str] = None):
        current_round = 0
        current_input = newest_text
        init_data = chat_db.get_init_data()
        current_contact = init_data.get("contact", {})
        is_group = (current_contact.get("type") == "G")

        # 私聊 1 轮，群聊最多 1~12 轮
        chain_limit = 1 if not is_group else random.randint(1, 12)

        while current_round <= chain_limit:
            user_nickname = init_data.get("user", {}).get("nickname", "用户")
            all_contacts = init_data.get("contacts", [])
            nickname_map = {c['uuid']: c['nickname'] for c in all_contacts}
            if current_contact.get("uuid"):
                nickname_map[current_contact['uuid']] = current_contact['nickname']

            # 1. 路由选择发言人
            target_speaker_uuid = await self._router_decision(current_input, current_contact, nickname_map,
                                                              user_nickname, is_group)
            if not target_speaker_uuid or target_speaker_uuid not in nickname_map:
                break

            speaker_info = chat_db.get_contact_info_by_uuid(target_speaker_uuid) or current_contact
            speaker_nickname = speaker_info.get("nickname", "AI")

            # 2. 组装 Prompt
            final_prompt = self.context_builder.build_prompt(current_input, init_data, speaker_info, auto,
                                                             self.merged_count, wakeup_remark)

            # 3. LLM 请求
            full_reply = await self._request_reply(final_prompt)
            if not full_reply:
                break

            # 4. 任务创建，群聊、自动搭话和定时唤醒都不创建任务
            if not is_group and not auto and not wakeup_remark:
                wakeup_data = parse_wakeup_sleep_time(full_reply)
                if wakeup_data:
                    self.create_wakeup_task(target_speaker_uuid,wakeup_data)

            # 5. 文本清洗与任务处理
            cleaned_reply = self.processor.clean_reply(full_reply)

            # 6. 切分与打字机落库
            raw_blocks = self.processor.extract_blocks(cleaned_reply)
            last_valid_block = ""
            for block in raw_blocks:
                processed = await self.processor.save_block_with_delay(block, is_group, speaker_nickname,
                                                                       target_speaker_uuid)
                if processed:
                    last_valid_block = processed

            # 动态上下文窗口
            if self.merged_count >= self.max_merged_count:
                self.merged_count = self.min_merged_count
            else:
                self.merged_count += 2

            # 私聊完成，后台异步触发总结
            if not is_group:
                task = asyncio.create_task(summary_pipeline.summary())
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
                break

            current_round += 1
            if last_valid_block:
                current_input = last_valid_block

        heap.update_status(0)

    async def auto_message_loop(self):
        """后台主动消息轮询任务"""
        while True:
            await asyncio.sleep(1800)

            if self.active_task and not self.active_task.done():
                continue

            try:
                init_data = chat_db.get_init_data()
                current_contact = init_data.get("contact", {})
                agent_uuid = current_contact.get("uuid")
                if not agent_uuid:
                    continue

                speaker_info = chat_db.get_contact_info_by_uuid(agent_uuid) or current_contact
                profile = await profile_manager.get_or_create_profile(agent_uuid, speaker_info.get("card_data", ""))

                if should_trigger_proactive(profile):
                    print(f"[主动AI] 角色 [{agent_uuid[:8]}...] 触发主动搭话")
                    await self.on_new_message("", auto=True)
                else:
                    print(f"[主动AI] 角色 [{agent_uuid[:8]}...] 不满足主动搭话触发条件，跳过主动搭话")

            except Exception as e:
                print(f"[主动AI] 轮询周期出错: {e}")

    async def scan_wakeup_tasks(self):
        """启动时恢复未到期任务，清理过期任务。"""
        for task in chat_db.get_wakeup_tasks():
            try:
                sleep_time = datetime.strptime(task["wakeup_time"], "%Y/%m/%d %H:%M").timestamp() - time.time()
            except ValueError:
                sleep_time = 0
            if sleep_time <= 0:
                chat_db.delete_wakeup_task(task["owner_uuid"], task["task_id"])
            else:
                self._start_wakeup_task(task, sleep_time)

    def create_wakeup_task(self, owner_uuid: str, wakeup_data: dict):
        """保存并启动单个唤醒任务。"""
        task = chat_db.save_wakeup_task(owner_uuid, wakeup_data["wakeup_time"], wakeup_data["remark"])
        if task:
            self._start_wakeup_task(task, wakeup_data["sleep_time"])

    def _start_wakeup_task(self, task: dict, sleep_time: float):
        async def wakeup():
            await asyncio.sleep(sleep_time)
            chat_db.delete_wakeup_task(task["owner_uuid"], task["task_id"])
            active_uuid = chat_db.get_init_data().get("contact", {}).get("uuid")
            if active_uuid != task["owner_uuid"] or (self.active_task and not self.active_task.done()):
                return
            await self.on_new_message("", wakeup_remark=task["remark"])

        background_task = asyncio.create_task(wakeup())
        self._background_tasks.add(background_task)
        background_task.add_done_callback(self._background_tasks.discard)

engine_instance = MoYunxiEngine()
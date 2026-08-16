# app/chat/summary.py
import asyncio
import logging
import json

from .db_manager import chat_db
from ..llm.llm_client import llm_client
from ..config.config_manager import config_manager

# 日志记录器
logger = logging.getLogger("SummaryPipeline")


class SummaryPipeline:
    def __init__(self):
        """
        长期记忆总结流水线
        """
        # 引入协程锁，确保全局同时只有一个总结任务在后台运行
        self._lock = asyncio.Lock()

    async def summary(self):
        """
        长期记忆总结主循环
        """
        if self._lock.locked():
            return

        async with (self._lock):
            logger.info("[Summary] 启动长期记忆总结流水线。")

            # 用于记录本次循环开始时的初始联系人 UUID
            initial_contact_uuid = None

            while True:
                try:
                    # 抓取当前活跃联系人 UUID
                    first_contact_uuid = chat_db.get_active_contact_uuid_for_memory()
                    if not first_contact_uuid:
                        logger.info("[Summary] 未获取到活跃联系人 UUID，总结终止。")
                        break

                    # 加载用户资料
                    init_data = chat_db.get_init_data()
                    user_info = init_data.get("user", {})
                    u_header = f'nickname: "{user_info.get("name", "user")}", org: "{user_info.get("org", "")}", gender: "{user_info.get("gender", "")}", birthday: "{user_info.get("birthday", "")}", hobbies: "{user_info.get("hobbies", "")}"'

                    # 加载角色卡
                    char_data = chat_db.get_contact_info_by_uuid(first_contact_uuid)
                    char_card = char_data.get("card_data", "")

                    # 初始化初始联系人，或检查联系人是否发生跨轮切换
                    if initial_contact_uuid is None:
                        initial_contact_uuid = first_contact_uuid
                    elif first_contact_uuid != initial_contact_uuid:
                        logger.info(
                            f"[Summary] 检测到当前活跃联系人已从 {initial_contact_uuid} 切换至 {first_contact_uuid}，总结结束。")
                        break

                    # 获取当前总结断点与最新消息 ID
                    summary_last_id = chat_db.get_last_summary_last_id()
                    messages_last_id = chat_db.get_last_message_id_for_memory()

                    # 基础积压条件判定
                    if messages_last_id <= summary_last_id:
                        logger.info("[Summary] 当前无积压的未总结消息，总结结束。")
                        break

                    # 从旧到新拉取未总结消息
                    raw_list = chat_db.get_messages_newer_than_id_for_memory(summary_last_id)
                    if not raw_list:
                        logger.info("[Summary] 获取未总结消息列表为空，总结结束。")
                        break

                    # 正序遍历合并同角色消息，按时间间隔截断
                    merged_list = []
                    current_group = None
                    turn_counter = 0

                    for msg in raw_list:
                        role = msg["role"]
                        msg_id = msg["id"]
                        text = str(msg["text"] or "").strip()
                        msg_time = msg["time"]

                        if not text:
                            continue

                        if current_group is None:
                            current_group = {
                                "role": role,
                                "first_id": msg_id,
                                "last_id": msg_id,
                                "texts": [text],
                                "time": msg_time
                            }
                        elif current_group["role"] == role:
                            current_group["last_id"] = msg_id
                            current_group["texts"].append(text)
                        else:
                            current_group["text"] = "\n".join(current_group["texts"])
                            merged_list.append(current_group)
                            turn_counter += 1

                            time_gap_hours = (msg_id - current_group["last_id"]) / (1000 * 3600.0)

                            # 达到 30 轮限制，或出现大于 6 小时的时间裂缝，进行物理边界截断
                            if turn_counter >= 30 or time_gap_hours > 6.0:
                                current_group = None
                                break

                            current_group = {
                                "role": role,
                                "first_id": msg_id,
                                "last_id": msg_id,
                                "texts": [text],
                                "time": msg_time
                            }

                    # 闭合最后一个未打包的组
                    if current_group:
                        current_group["text"] = "\n".join(current_group["texts"])
                        merged_list.append(current_group)
                        turn_counter += 1

                    # 活跃轮防截断判定：若最后一轮的 last_id 等于 messages_last_id，说明该轮未完全闭合
                    if merged_list and merged_list[-1]["last_id"] == messages_last_id:
                        logger.info(
                            f"[Summary] 最后一轮 (ID: {merged_list[-1]['last_id']}) 处于未闭合活跃状态，安全排除。")
                        merged_list.pop()

                    # 判定当前积压消息总量和时间跨度是否达到总结阈值
                    merged_count = len(merged_list)
                    time_span_hours = (raw_list[-1]["id"] - raw_list[0]["id"]) / (
                            1000 * 3600.0) if merged_count >= 2 else 0.0

                    if merged_count < 30 and time_span_hours < 6.0:
                        logger.info(
                            f"[Summary] 积压消息轮数({merged_count}) < 30 且时间跨度({time_span_hours:.1f}) < 6.0h，终止总结。"
                        )
                        break

                    if not merged_list:
                        logger.info("[Summary] 切除活跃轮后无剩余稳定轮次，总结结束。")
                        break

                    # 锁定当前总结切片的起止边界 ID
                    safe_first_id = merged_list[0]["first_id"]
                    safe_last_id = merged_list[-1]["last_id"]

                    # 调用大模型生成长期记忆总结
                    PROMPT_SUMMARY_TEMPLATE = config_manager.get("summary_prompt")
                    if not PROMPT_SUMMARY_TEMPLATE:
                        logger.error("[Summary] 未能从 config_manager 获取到 'summary_prompt'，流水线中断。")
                        break

                    dialogue_log = ""
                    for turn in merged_list:
                        sender = "用户" if turn["role"] == "user" else "智能体"
                        dialogue_log += f"[{turn['time']}] {sender}: {turn['text']}\n"

                    final_prompt = PROMPT_SUMMARY_TEMPLATE.replace("{user_data}", u_header).replace("{char_data}", char_card).replace("{dialogue_log}", dialogue_log)
                    prompt_list = [{"role": "user", "content": final_prompt}]

                    logger.info(
                        f"[Summary] 发送切片文本至 LLM 进行事件总结 (ID 范围: {safe_first_id} -> {safe_last_id})。")
                    raw_response = await llm_client.get_simple_completion(prompt_list=prompt_list)

                    # 格式化解析与清洗
                    clean_text = raw_response.strip()
                    if clean_text.startswith("```"):
                        lines = clean_text.splitlines()
                        if lines[0].startswith("```"):
                            lines = lines[1:]
                        if lines and lines[-1].startswith("```"):
                            lines = lines[:-1]
                        clean_text = "\n".join(lines).strip()

                    clean_text = clean_text.replace("{{", "{").replace("}}", "}")

                    try:
                        summary_json_res = json.loads(clean_text)
                    except Exception as e:
                        logger.error(f"[Summary] 解析总结 JSON 失败: {e}。原始响应: {raw_response}")
                        break

                    importance = float(summary_json_res.get("importance", 0.3))
                    cleaned_save_data = {
                        "importance": importance,
                        "unmeaningful_reason": summary_json_res.get("unmeaningful_reason", ""),
                        "summary": {
                            "summary_text": summary_json_res.get("summary_text", ""),
                            "tags": summary_json_res.get("tags", ""),
                            "keywords": summary_json_res.get("keywords", [])
                        }
                    }
                    summary_json_str = json.dumps(cleaned_save_data, ensure_ascii=False)

                    # 事实消歧合并决策
                    operations = []
                    if importance >= 0.8:
                        logger.info(f"[Summary] 事件重要度 ({importance}) >= 0.8，启动事实更新决策。")

                        current_active_uuid = chat_db.get_active_contact_uuid_for_memory()
                        read_target_uuid = None if first_contact_uuid == current_active_uuid else first_contact_uuid
                        old_facts = chat_db.get_all_semantic_memories(target_uuid=read_target_uuid)

                        factual_reconcile_prompt_template = config_manager.get("factual_reconcile_prompt")

                        if factual_reconcile_prompt_template:
                            reconcile_prompt = factual_reconcile_prompt_template.replace("{user_data}", u_header
                            ).replace(
                                "{char_data}", char_card
                            ).replace(
                                "{old_facts_json}", json.dumps(old_facts, ensure_ascii=False)
                            ).replace(
                                "{summary_text}", cleaned_save_data["summary"]["summary_text"]
                            )

                            prompt_list_reconcile = [{"role": "user", "content": reconcile_prompt}]
                            reconcile_response = await llm_client.get_simple_completion(
                                prompt_list=prompt_list_reconcile)

                            clean_reconcile_text = reconcile_response.strip()
                            if clean_reconcile_text.startswith("```"):
                                lines = clean_reconcile_text.splitlines()
                                if lines[0].startswith("```"):
                                    lines = lines[1:]
                                if lines and lines[-1].startswith("```"):
                                    lines = lines[:-1]
                                clean_reconcile_text = "\n".join(lines).strip()

                            clean_reconcile_text = clean_reconcile_text.replace("{{", "{").replace("}}", "}")

                            try:
                                reconcile_json_res = json.loads(clean_reconcile_text)
                                operations = reconcile_json_res.get("operations", [])
                            except Exception as e:
                                logger.error(f"[Summary] 解析事实消歧 JSON 失败: {e}。原始响应: {reconcile_response}")
                        else:
                            logger.error("[Summary] 未能从 config_manager 获取到 'factual_reconcile_prompt'。")

                    # 双端 UUID 状态校验与自适应落库
                    second_contact_uuid = chat_db.get_active_contact_uuid_for_memory()
                    switched = (first_contact_uuid != second_contact_uuid)

                    if not switched:
                        # 状态未改变，直接写入当前活跃数据库
                        target_uuid = None
                        logger.info(f"[Summary] UUID 状态一致，写入活跃角色的临时数据库: {first_contact_uuid}")
                    else:
                        # 状态已改变，物理写入冷备份对应联系人数据库
                        target_uuid = first_contact_uuid
                        logger.info(f"[Summary] 检测到联系人已切换，写入物理备份数据库: {first_contact_uuid}")

                    # 事件落库
                    chat_db.save_episodic_memory(
                        first_id=safe_first_id,
                        last_id=safe_last_id,
                        importance=importance,
                        summary=summary_json_str,
                        target_uuid=target_uuid
                    )

                    # 事实更新
                    if importance >= 0.8 and operations:
                        chat_db.execute_semantic_memory_operations(operations, target_uuid=target_uuid)

                    # 切换判定退出：如果在本次总结期间发生了联系人切换，安全落库并同步后，必须退出
                    if switched:
                        logger.info(
                            f"[Summary] 本次总结期间检测到联系人切换 ({first_contact_uuid} -> {second_contact_uuid})，落库完成后退出总结循环。")
                        break
                except Exception as loop_error:
                    logger.error(f"[Summary] 总结流水线执行中遭遇异常错误: {loop_error}。退出当前总结。")
                    break


# 实例化单例
summary_pipeline = SummaryPipeline()
# app/utils/utils.py
import re
import datetime
import random
from typing import Dict, Any


# ==========================================
# 意义检测
# ==========================================
def is_significant(text: str) -> bool:
    """判断消息是否有价值触发长期记忆检索"""
    if not text:
        return False

    # 剔除纯标点符号和空格
    text_no_punct = re.sub(r'[^\w\s]', '', text).strip()

    # 太短的不查
    if len(text_no_punct) <= 3:
        return False

    return True


# ==========================================
# 酒馆预设解析
# ==========================================
def ST_preset(messages, newest, default_data, char_data):
    """根据酒馆 JSON 组装 Prompt"""

    def replace_tag_with_list(source_list, tag, replacement_list):
        new_list = []
        for item in source_list:
            if item == tag:
                new_list.extend(replacement_list)
            else:
                new_list.append(item)
        return new_list

    character = [{"role": "system", "content": char_data}]
    prompt_list = []

    prompt_order = default_data.get("prompt_order", [])
    prompts = default_data.get("prompts", [])

    # 内置宏标签白名单，这些不需要去 prompts 数组里找
    builtin_tags = ["chatHistory", "charDescription", "activeTasks"]

    for order_entry in prompt_order:
        if order_entry.get("character_id") == 100001:
            for identifier_data in order_entry.get("order", []):
                ident = identifier_data.get("identifier")
                if identifier_data.get("enabled"):
                    if ident in builtin_tags:
                        prompt_list.append(ident)  # 占位
                    else:
                        for prompt in prompts:
                            if prompt.get("identifier") == ident:
                                safe_role = prompt.get("role", "system")
                                safe_content = prompt.get("content", "")
                                prompt_list.append({"role": safe_role, "content": safe_content})
                                break
            break

    # 按顺序执行替换
    prompt_list = replace_tag_with_list(prompt_list, "charDescription", character)
    prompt_list = replace_tag_with_list(prompt_list, "chatHistory", messages)

    # 替换最新的用户输入
    for prompt in prompt_list:
        if isinstance(prompt, dict) and "{{lastUserMessage}}" in prompt.get("content", ""):
            prompt["content"] = prompt["content"].replace("{{lastUserMessage}}", newest)

    # 合并相邻的同角色（role）消息
    merged_prompt_list = []
    for prompt in prompt_list:
        if isinstance(prompt, dict) and "role" in prompt:
            # 如果新列表中已有消息，且最后一条消息的角色与当前消息相同
            if (merged_prompt_list
                    and isinstance(merged_prompt_list[-1], dict)
                    and merged_prompt_list[-1].get("role") == prompt.get("role")):
                # 获取前一条和当前的内容，用 \n 拼接
                last_content = merged_prompt_list[-1].get("content", "")
                curr_content = prompt.get("content", "")
                merged_prompt_list[-1]["content"] = f"{last_content}\n{curr_content}"
            else:
                # 复制一份字典，避免直接修改外部传入的原始数据
                merged_prompt_list.append(dict(prompt))
        else:
            # 兼容处理：如果列表中混入了非字典类型的数据则直接放入
            merged_prompt_list.append(prompt)

    return merged_prompt_list


# =====================================================================
# 独立工具 性格画像
# =====================================================================
def is_asleep(current_hour: float, night_owl_coef: float) -> bool:
    sleep_start = (21.0 + 3.0 * night_owl_coef) % 24.0
    sleep_end = (sleep_start + 8.0) % 24.0
    return sleep_start <= current_hour < sleep_end if sleep_start < sleep_end else (
                current_hour >= sleep_start or current_hour < sleep_end)


def should_trigger_proactive(profile_data: Dict[str, Any]) -> bool:
    s_act = float(profile_data.get("social_active_index", 1.0))
    n_owl = float(profile_data.get("night_owl_coefficient", 1.0))
    if s_act <= 0.0:
        return False
    now = datetime.datetime.now()
    current_hour = now.hour + (now.minute / 60.0)
    if is_asleep(current_hour, n_owl):
        return False
    return random.random() < (0.05 * (s_act ** 1.5))
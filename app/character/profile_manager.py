# app/character/profile_manager.py
import json
import re
import logging
from typing import Any

from .db_manager import profile_db

from ..llm.llm_client import llm_client
from ..config.config_manager import config_manager


class ProfileManager:
    """角色性格与社交画像服务"""

    @staticmethod
    async def get_or_create_profile(agent_uuid: str, card_data: str) -> dict[str, Any]:
        """获取角色的社交特征画像。如果数据库没有缓存，则调用大模型评估并存入缓存"""
        prompt_template = config_manager.get("char_profiler")

        try:
            cached_profile_str = profile_db.get_cognitive_profile(agent_uuid)
            if cached_profile_str:
                return json.loads(cached_profile_str)
        except Exception as e:
            logging.warning(f"读取画像缓存失败: {e}")

        print(f"[ProfileManager] 正在为角色 {agent_uuid} 生成性格画像...")
        prompt = [{"role": "system", "content": prompt_template.format(card_data=card_data)}]
        profile_json_str = await llm_client.get_simple_completion(prompt)

        # 移除推理模型思考标签
        profile_json_str = re.sub(r'<(think|thinking)>.*?</\1>', '', profile_json_str, flags=re.DOTALL | re.IGNORECASE)
        profile_json_str = re.sub(r'<(think|thinking)>.*', '', profile_json_str, flags=re.DOTALL | re.IGNORECASE)

        # 清理 Markdown 代码块标记
        cleaned_str = re.sub(r'```(?:json)?\s*|\s*```', '', profile_json_str, flags=re.IGNORECASE).strip()

        # 提取 JSON 内容
        start_idx = cleaned_str.find('{')
        end_idx = cleaned_str.rfind('}')
        if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
            raise ValueError(f"大模型响应中未找到有效的 JSON 对象: {profile_json_str[:200]}")

        json_candidate = cleaned_str[start_idx:end_idx + 1]

        try:
            parsed = json.loads(json_candidate)
        except json.JSONDecodeError as e:
            raise ValueError(f"解析画像 JSON 失败: {e}. 提取文本: {json_candidate}")

        # 校验必填字段
        required_keys = ["social_active_index", "comment_initiative", "night_owl_coefficient"]
        profile_data = {}

        for key in required_keys:
            if key not in parsed:
                raise KeyError(f"画像 JSON 缺少必要字段 [{key}]: {parsed}")
            try:
                profile_data[key] = float(parsed[key])
            except (ValueError, TypeError):
                raise ValueError(f"画像字段 [{key}] 无法转换为浮点数: {parsed[key]}")

        # 写入缓存
        profile_db.update_cognitive_profile(agent_uuid, json.dumps(profile_data, ensure_ascii=False))
        return profile_data


profile_manager = ProfileManager()
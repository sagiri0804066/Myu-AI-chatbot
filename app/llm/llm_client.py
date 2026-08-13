# app/llm/llm_client
import openai
from openai import AsyncOpenAI
import asyncio
from PIL import Image
import io
import base64
import json
import os
from ..config.config_manager import config_manager
from ..config.db_manager import config_db
from ..utils.utils import ST_preset


class LLMClient:
    def __init__(self):
        self.db = config_db
        self.client = None
        self.model_name = None
        # VLM 相关属性
        self.vlm_enabled = False
        self.vlm_client = None
        self.vlm_model_name = None
        # 预设相关属性
        self.params = {}
        self.preset = None
        self.preset_json = {}
        self._init_client()

    def _init_client(self):
        """内部初始化：从数据库读取配置"""
        config = self.db.get_config()
        api_key = config.get("apikey", "").strip()
        base_url = config.get("baseurl", "").strip()
        self.model_name = config.get("model", "")
        print(f"base_url:{base_url}, model_name:{self.model_name}")

        # 预设解析
        self.base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.data_path = os.path.join(self.base_dir, "data")
        self.preset_path = os.path.join(self.data_path, "preset")
        self.preset_name = config.get("preset", {})
        self.preset_file_path = os.path.join(self.preset_path, self.preset_name)
        try:
            with open(self.preset_file_path, "r", encoding="utf-8") as f:
                self.preset_json = json.load(f)
                print(f"当前使用预设:{self.preset_name}")
        except Exception as e:
            print(f"加载 preset.json 失败: {e}")
            self.preset_json = {}

        # 读取新参数
        self.params = {
            "max_tokens": int(config.get("max_tokens", 2048)),
            "temperature": float(config.get("temperature", 1.0)),
            "top_p": float(config.get("top_p", 1.0)),
            "frequency_penalty": float(config.get("frequency_penalty", 0.0)),
            "presence_penalty": float(config.get("presence_penalty", 0.0)),
            "stream": bool(config.get("stream", True))
        }
        print(self.params)

        if api_key and base_url:
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        else:
            self.client = None

        # VLM 配置
        self.vlm_enabled = bool(config.get("vlm_enabled", False))
        vlm_api_key = config.get("vlm_apikey", "").strip()
        vlm_base_url = config.get("vlm_baseurl", "").strip()
        self.vlm_model_name = config.get("vlm_model", "")

        if self.vlm_enabled and vlm_api_key and vlm_base_url:
            self.vlm_client = AsyncOpenAI(api_key=vlm_api_key, base_url=vlm_base_url)
        else:
            self.vlm_client = None

    def reload_config(self):
        print("🔄 正在重新加载 LLM 配置...")
        self._init_client()

    def call_st_preset(self, messages, newest, char_data, scheduled_tasks):
        final_prompt = ST_preset(messages, newest, self.preset_json, char_data, scheduled_tasks)
        return final_prompt

    async def chat_completion(self, prompt_list, temperature=None):
        """
        统一接口：支持流式与非流式。
        """
        if not self.client:
            self._init_client()
            if not self.client:
                yield "status", "status_offline"
                return

        if temperature is not None:
            self.params["temperature"] = temperature
            print(f"[自定义温度]{temperature}")

        # 获取配置中的 stream 状态
        is_stream = self.params.get("stream", True)

        retry_count = 0
        while retry_count <= 3:
            try:
                if is_stream:
                    # 1. 流式路径
                    response_stream = await self.client.chat.completions.create(
                        model=self.model_name,
                        messages=prompt_list,
                        **self.params
                    )
                    async with response_stream as stream:
                        yield "status", "status_ok"
                        async for chunk in stream:
                            if chunk.choices and len(chunk.choices) > 0:
                                content = chunk.choices[0].delta.content
                                if content:
                                    yield "content", content
                    return

                else:
                    # 2. 非流式路径
                    response = await self.client.chat.completions.create(
                        model=self.model_name,
                        messages=prompt_list,
                        **self.params
                    )
                    print(response.model_dump_json(indent=2))

                    yield "status", "status_ok"

                    content = response.choices[0].message.content
                    if content:
                        yield "content", content
                    return

            except openai.APIStatusError as e:
                print(f"⚠️ API 报错: {e.status_code} - {e.message}")
                if e.status_code == 500:
                    yield "status", "status_offline"
                    return
                elif e.status_code in [402, 429]:
                    yield "status", "status_busy"
                    return
                else:
                    retry_count += 1
            except openai.APIConnectionError:
                print("网络连接失败，重试中...")
                retry_count += 1
            except asyncio.CancelledError:
                print("任务被取消")
                raise
            except Exception as e:
                print(f"未知错误: {e}")
                retry_count += 1

        yield "status", "status_offline"

    async def get_simple_completion(self, prompt_list):
        """专门用于路由决策的快速接口"""
        if not self.client:
            return ""
        try:
            params = self.params.copy()
            params["stream"] = False
            params["max_tokens"] = 4096
            params["temperature"] = 0.1

            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=prompt_list,
                **params
            )
            print(response.model_dump_json(indent=2))
            return response.choices[0].message.content or ""
        except Exception as e:
            print(f"失败: {e}")
            return ""

    async def describe_image(self, img_path: str) -> str:
        """
        使用 VLM 对本地图片进行自然语言描述。
        如果 vlm_enabled 为 False，或任何步骤出错，返回空字符串。
        """
        if not self.vlm_enabled:
            print("未激活多模态")
            return ""
        if not self.vlm_client:
            self._init_client()
            print("多模态无url")
            if not self.vlm_client:
                return ""
        try:
            # 1. 压缩图片并转 base64
            with Image.open(img_path) as img:
                img = img.convert('RGB')
                img.thumbnail((360, 360))
                buf = io.BytesIO()
                img.save(buf, format='JPEG', quality=80)
                img_bytes = buf.getvalue()
                img_base64 = base64.b64encode(img_bytes).decode('utf-8')

            # 2. 构造消息
            PROMPT = config_manager.get("vlm_prompt")

            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_base64}"}}
                    ]
                }
            ]
            # 3. 调用 VLM 模型（非流式）
            raw_response = await self.vlm_client.chat.completions.create(
                model=self.vlm_model_name,
                messages=messages,
                max_tokens=1024,
                temperature=0.1,
            )
            raw_text = raw_response.choices[0].message.content.strip()

            if raw_text:
                try:
                    data = json.loads(raw_text)
                    tags_list = data.get("tags", [])

                    if isinstance(tags_list, list) and len(tags_list) >= 3:
                        formatted_tags = "，".join(tags_list)
                        print(f"{formatted_tags}")
                        return formatted_tags
                    else:
                        print(f"返回的标签数量不足: {raw_text}")
                        return ""
                except json.JSONDecodeError:
                    print(f"无法解析为 JSON: {raw_text}")
                    return ""
            else:
                print(f"未产生有效回复")
                return ""

        except Exception as e:
            print(f"图片描述失败: {e}")
            return ""


llm_client = LLMClient()
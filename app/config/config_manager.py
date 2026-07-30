import os
import yaml
import logging


class ConfigManager:
    def __init__(self, config_path="config.yaml"):
        self.config_path = config_path
        self.prompts = {}
        self.server_config = {}
        self.load()

    def load(self):
        """加载或重新加载配置文件"""
        if not os.path.exists(self.config_path):
            logging.error(f"[ConfigManager] 找不到配置文件: {self.config_path}")
            return

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f)
                if config_data:
                    self.server_config = config_data.get("server", {})
                    self.prompts = config_data.get("prompts", {})
                    logging.info(f"[ConfigManager] 成功加载 {len(self.prompts)} 条提示词。")
        except Exception as e:
            logging.error(f"[ConfigManager] 解析 YAML 失败: {e}")

    def get(self, key, **kwargs):
        """
        获取提示词并格式化变量
        :param key: YAML 中 prompts 下的键名
        :param kwargs: 需要替换的变量，如 nickname="张三"
        """
        raw_prompt = self.prompts.get(key, "")

        if not raw_prompt:
            logging.warning(f"[ConfigManager] 提示词 Key '{key}' 不存在。")
            return ""

        if not kwargs:
            return raw_prompt

        try:
            return raw_prompt.format(**kwargs)
        except KeyError as e:
            logging.error(f"[ConfigManager] 提示词 '{key}' 缺少变量: {e}")
            return raw_prompt  # 返回原字符串，避免程序崩溃
        except Exception as e:
            logging.error(f"[ConfigManager] 格式化提示词 '{key}' 出错: {e}")
            return raw_prompt


# 实例化单例
config_manager = ConfigManager()
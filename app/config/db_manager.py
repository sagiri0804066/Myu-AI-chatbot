# app/config/db_manager.py
import sqlite3
import logging
import json
import os
from contextlib import contextmanager

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class DBManager:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    DATA_DIR = os.path.join(BASE_DIR, "data")
    PROFILES_DIR = os.path.join(DATA_DIR, "profiles")

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(PROFILES_DIR, exist_ok=True)

    _profiles_db_path = os.path.join(PROFILES_DIR, "profiles_data.db")

    @staticmethod
    @contextmanager
    def _get_conn(db_path: str):
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=DELETE;")
            conn.execute("PRAGMA busy_timeout=5000;")
            # 自动建表
            conn.execute('''CREATE TABLE IF NOT EXISTS profiles (type TEXT PRIMARY KEY, json_data TEXT)''')
            with conn:
                yield conn
        finally:
            conn.close()

    @staticmethod
    def _get_profiles_conn():
        return DBManager._get_conn(DBManager._profiles_db_path)

    @staticmethod
    def get_config() -> dict:
        try:
            with DBManager._get_profiles_conn() as conn:
                cur = conn.execute("SELECT json_data FROM profiles WHERE type='config'")
                row = cur.fetchone()
                if row:
                    return json.loads(row[0])
                return {}
        except Exception as e:
            logging.error(f"获取配置失败: {e}")
            return {}

    @staticmethod
    def update_config(config_dict: dict):
        try:
            with DBManager._get_profiles_conn() as conn:
                # 1. 先读出当前已有的旧配置
                cur = conn.execute("SELECT json_data FROM profiles WHERE type='config'")
                row = cur.fetchone()
                current_config = json.loads(row[0]) if row else {}

                # 2. 合并新传入的配置项
                current_config.update(config_dict)
                json_str = json.dumps(current_config, ensure_ascii=False)

                # 3. 写入
                conn.execute(
                    "INSERT OR REPLACE INTO profiles (type, json_data) VALUES ('config', ?)",
                    (json_str,)
                )
        except Exception as e:
            logging.error(f"更新配置失败: {e}")


config_db = DBManager()
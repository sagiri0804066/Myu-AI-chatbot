# app/character/db_manager.py
import sqlite3
import logging
import json
import os
import re
from contextlib import contextmanager
from typing import Optional

# 配置基础日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class DBManager:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    DATA_DIR = os.path.join(BASE_DIR, "data")  # 指定 data 文件夹
    CHAR_DIR = os.path.join(DATA_DIR, "character")
    CONTACTS_DIR = os.path.join(DATA_DIR, "contacts")

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CONTACTS_DIR, exist_ok=True)
    os.makedirs(CHAR_DIR, exist_ok=True)

    _char_db_path = os.path.join(CHAR_DIR, "char_data.db")

    @staticmethod
    @contextmanager
    def _get_conn(db_path: str):
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=DELETE;")
            conn.execute("PRAGMA busy_timeout=5000;")
            with conn:
                yield conn
        finally:
            conn.close()

    @staticmethod
    def _is_safe_uuid(uuid_str: str) -> bool:
        """
        安全校验：限制 UUID 只能包含字母、数字和横线，防止路径穿越攻击（如传递 ../ 等路径）
        """
        if not uuid_str:
            return False
        return bool(re.match(r"^[a-zA-Z0-9\-]+$", uuid_str)) and len(uuid_str) < 100

    # ==========================================================================
    # 认知画像缓存读写拓展
    # ==========================================================================
    @staticmethod
    def get_cognitive_profile(uuid_val: str) -> Optional[str]:
        """
        读取联系人的认知画像缓存 (JSON字符串)
        """
        if not DBManager._is_safe_uuid(uuid_val):
            return None

        db_path = os.path.join(DBManager.CONTACTS_DIR, f"{uuid_val}.db")
        if not os.path.exists(db_path):
            db_path = DBManager._char_db_path
            if not os.path.exists(db_path):
                return None
        try:
            with DBManager._get_conn(db_path) as conn:
                row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                if row and row['json_data']:
                    char_data = json.loads(row['json_data'])
                    return char_data.get("cognitive_profile")
        except Exception as e:
            logging.error(f"get_cognitive_profile 失败: {e}")
        return None

    @staticmethod
    def update_cognitive_profile(uuid_val: str, profile_json_str: str) -> bool:
        """
        更新联系人的认知画像缓存，将数据回写进 profiles 表 type='character' 的 json_data 中
        """
        if not DBManager._is_safe_uuid(uuid_val):
            return False

        db_paths = []

        # 1. 对应独立的 contact db 路径
        contact_db = os.path.join(DBManager.CONTACTS_DIR, f"{uuid_val}.db")
        if os.path.exists(contact_db):
            db_paths.append(contact_db)

        # 2. 如果当前活跃数据库正是该角色，也应同步更新
        active_db = DBManager._char_db_path
        if os.path.exists(active_db):
            try:
                with DBManager._get_conn(active_db) as conn:
                    row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                    if row and row['json_data']:
                        char_data = json.loads(row['json_data'])
                        if char_data.get("uuid") == uuid_val:
                            db_paths.append(active_db)
            except Exception:
                pass

        if not db_paths:
            return False

        success = False
        # 去重后依次更新
        for db_path in set(db_paths):
            try:
                with DBManager._get_conn(db_path) as conn:
                    row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                    if row and row['json_data']:
                        char_data = json.loads(row['json_data'])
                        char_data["cognitive_profile"] = profile_json_str
                        conn.execute("UPDATE profiles SET json_data=? WHERE type='character'",
                                     (json.dumps(char_data, ensure_ascii=False),))
                        success = True
            except Exception as e:
                logging.error(f"update_cognitive_profile 失败 ({db_path}): {e}")

        return success

profile_db = DBManager()
# app/chat/db_manager.py
import sqlite3
import logging
import json
import os
import uuid
import re
import shutil
import base64
import glob
from contextlib import contextmanager
from typing import Optional

# 配置基础日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class DBManager:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    DATA_DIR = os.path.join(BASE_DIR, "data")  # 指定 data 文件夹
    CONTACTS_DIR = os.path.join(DATA_DIR, "contacts")
    CHAR_DIR = os.path.join(DATA_DIR, "character")
    PROFILES_DIR = os.path.join(DATA_DIR, "profiles")

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(CONTACTS_DIR, exist_ok=True)
    os.makedirs(CHAR_DIR, exist_ok=True)
    os.makedirs(PROFILES_DIR, exist_ok=True)

    _char_db_path = os.path.join(CHAR_DIR, "char_data.db")
    _profiles_db_path = os.path.join(PROFILES_DIR, "profiles_data.db")

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
    def _get_char_conn():
        """获取当前活跃角色的数据库连接上下文"""
        return DBManager._get_conn(DBManager._char_db_path)

    @staticmethod
    def _get_contacts_conn(uuid):
        """获取任意角色的数据库连接上下文"""
        _path = os.path.join(DBManager.CONTACTS_DIR, f"{uuid}.db")
        return DBManager._get_conn(_path)

    @staticmethod
    def _get_profiles_conn():
        """获取全局公共配置数据库的连接上下文"""
        return DBManager._get_conn(DBManager._profiles_db_path)

    @staticmethod
    def _is_safe_uuid(uuid_str: str) -> bool:
        """
        安全校验：限制 UUID 只能包含字母、数字和横线，防止路径穿越攻击（如传递 ../ 等路径）
        """
        if not uuid_str:
            return False
        return bool(re.match(r"^[a-zA-Z0-9\-]+$", uuid_str)) and len(uuid_str) < 100

    @staticmethod
    def _save_base64(base64_str: str, file_prefix: str, output_dir: str) -> str:
        """
        将前端上传的 Base64 解析并保存为本地物理图片文件。
        """
        if not base64_str or not base64_str.startswith("data:image/"):
            return base64_str

        try:
            header, base64_data = base64_str.split(",", 1)
            ext = header.split(";")[0].split("/")[-1]  # 提取后缀，如 png / jpeg

            img_data = base64.b64decode(base64_data)
            os.makedirs(output_dir, exist_ok=True)

            # 保持一致的目标前缀
            if file_prefix.startswith("bg_") or file_prefix.startswith("avatar_") or file_prefix.startswith("moment_"):
                target_prefix = file_prefix
            else:
                target_prefix = f"avatar_{file_prefix}"

            # 遍历文件夹，提取纯文件名进行比对，删除所有同名不同格式的旧文件
            for existing_file in os.listdir(output_dir):
                name_without_ext, _ = os.path.splitext(existing_file)
                if name_without_ext == target_prefix:
                    try:
                        os.remove(os.path.join(output_dir, existing_file))
                    except Exception as clean_err:
                        logging.warning(f"清理旧格式文件 {existing_file} 失败: {clean_err}")

            filename = f"{target_prefix}.{ext}"
            file_path = os.path.join(output_dir, filename)
            with open(file_path, "wb") as f:
                f.write(img_data)

            dir_name = os.path.basename(output_dir)
            return f"/data/{dir_name}/{filename}"
        except Exception as e:
            logging.error(f"图片保存失败: {e}")
            return base64_str

    @staticmethod
    def _init_tables():
        """初始化表结构"""
        # 1. 活跃库迁移与初始化
        try:
            DBManager._ensure_sender_uuid_column(DBManager._char_db_path)
            with DBManager._get_char_conn() as conn:
                conn.execute('''CREATE TABLE IF NOT EXISTS messages 
                                        (id INTEGER PRIMARY KEY, role TEXT, text TEXT, time TEXT, sender_uuid TEXT)''')
                conn.execute('''CREATE TABLE IF NOT EXISTS profiles (type TEXT PRIMARY KEY, json_data TEXT)''')
                # 创建长期记忆表
                conn.execute('''CREATE TABLE IF NOT EXISTS episodic_memories 
                                        (first_id INTEGER PRIMARY KEY, last_id INTEGER, importance REAL, summary TEXT)''')
                conn.execute('''CREATE TABLE IF NOT EXISTS semantic_memories 
                                        (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT)''')
                default_character = json.dumps({
                    "uuid": None,
                    "nickname": "None",
                    "avatar": None,
                    "card_data": "",
                    "type": "P",
                    "members": [],
                    "background": None
                }, ensure_ascii=False)
                conn.execute("INSERT OR IGNORE INTO profiles (type, json_data) VALUES ('character', ?)",
                             (default_character,))
        except sqlite3.Error as e:
            logging.error(f"活跃库初始化失败: {e}")

        # 2. 公共配置库初始化
        try:
            with DBManager._get_profiles_conn() as conn:
                conn.execute('''CREATE TABLE IF NOT EXISTS profiles (type TEXT PRIMARY KEY, json_data TEXT)''')

                default_user = json.dumps({
                    "nickname": "User",
                    "avatar": None,
                    "org": "",
                    "gender": "",
                    "birthday": "",
                    "hobbies": "",
                    "background": ""
                }, ensure_ascii=False)
                default_config = json.dumps({
                    "baseurl": "",
                    "apikey": "",
                    "model": "",
                    "models": [],
                    "preset": "",
                    "presets": [],
                    "max_tokens": 32000,
                    "temperature": 1.0,
                    "top_p": 1.0,
                    "frequency_penalty": 0.0,
                    "presence_penalty": 0.0,
                    "stream": True
                }, ensure_ascii=False)
                conn.execute("INSERT OR IGNORE INTO profiles (type, json_data) VALUES ('user', ?)", (default_user,))
                conn.execute("INSERT OR IGNORE INTO profiles (type, json_data) VALUES ('config', ?)", (default_config,))
        except sqlite3.Error as e:
            logging.error(f"配置库初始化失败: {e}")

    @staticmethod
    def get_init_data():
        """获取初始化数据"""
        contacts = []
        try:
            if os.path.exists(DBManager.CONTACTS_DIR):
                for filename in os.listdir(DBManager.CONTACTS_DIR):
                    if filename.endswith(".db"):
                        db_path = os.path.join(DBManager.CONTACTS_DIR, filename)
                        DBManager._ensure_sender_uuid_column(db_path)
                        try:
                            with DBManager._get_conn(db_path) as conn:
                                row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                                if row and row['json_data']:
                                    character_data = json.loads(row['json_data'])
                                    contacts.append({
                                        "uuid": character_data.get("uuid"),
                                        "type": character_data.get("type", "P"),
                                        "nickname": character_data.get("nickname"),
                                        "avatar": character_data.get("avatar"),
                                        "card_data": character_data.get("card_data", ""),
                                        "members": character_data.get("members", []),
                                        "background": character_data.get("background", None)
                                    })
                        except Exception as file_err:
                            logging.error(f"读取数据库文件 {filename} 失败: {file_err}")

            with DBManager._get_char_conn() as conn:
                char_row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                contact_data = json.loads(char_row['json_data']) if char_row else {}
                msg_cursor = conn.execute(
                    "SELECT id, role, text, time, sender_uuid FROM messages ORDER BY id DESC LIMIT 20")
                messages = [dict(row) for row in reversed(msg_cursor.fetchall())]

            with DBManager._get_profiles_conn() as conn:
                user_row = conn.execute("SELECT json_data FROM profiles WHERE type='user'").fetchone()
                user_data = json.loads(user_row['json_data']) if user_row else {}

                return {"user": user_data, "contact": contact_data, "contacts": contacts, "messages": messages}
        except Exception as e:
            logging.error(f"get_init_data Error: {e}")
            return {"user": {}, "contact": {}, "contacts": [], "messages": []}

    @staticmethod
    def update_profile(profile_data: dict):
        """更新个人资料（物理化保存头像与背景图，返回静态文件相对路径）"""
        if not profile_data: return
        try:
            avatar_val = profile_data.get("avatar")
            if avatar_val:
                profile_data["avatar"] = DBManager._save_base64(
                    avatar_val, "user", DBManager.PROFILES_DIR
                )
            else:
                profile_data.pop("avatar", None)

            background_val = profile_data.get("background")
            if background_val is not None:
                profile_data["background"] = DBManager._save_base64(
                    background_val, "bg", DBManager.PROFILES_DIR
                )
            else:
                profile_data.pop("background", None)

            with DBManager._get_profiles_conn() as conn:
                row = conn.execute("SELECT json_data FROM profiles WHERE type='user'").fetchone()
                if row:
                    user_dict = json.loads(row['json_data'])
                    user_dict.update(profile_data)
                    conn.execute("UPDATE profiles SET json_data=? WHERE type='user'",
                                 (json.dumps(user_dict, ensure_ascii=False),))
        except Exception as e:
            logging.error(f"update_profile Error: {e}")

    @staticmethod
    def get_character_card() -> str:
        """从数据库提取用户信息和角色卡并替换变量"""
        try:
            with DBManager._get_char_conn() as conn:
                c_row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                char_card = json.loads(c_row['json_data']).get("card_data", "") if c_row else ""

            with DBManager._get_profiles_conn() as conn:
                u_row = conn.execute("SELECT json_data FROM profiles WHERE type='user'").fetchone()
                u_data = json.loads(u_row['json_data']) if u_row else {}

                nickname = u_data.get("nickname", "")
                header = f'nickname: "{nickname}", org: "{u_data.get("org", "")}", gender: "{u_data.get("gender", "")}", birthday: "{u_data.get("birthday", "")}", hobbies: "{u_data.get("hobbies", "")}"'
                char_card = char_card.replace("{{user}}", nickname)

                return f"[user:{header}\n{char_card}]"
        except Exception as e:
            logging.error(f"get_character_card Error: {e}")
            return ""

    @staticmethod
    def save_message(msg_dict: dict):
        """保存消息"""
        try:
            with DBManager._get_char_conn() as conn:
                conn.execute("INSERT INTO messages (id, role, text, time, sender_uuid) VALUES (?, ?, ?, ?, ?)",
                             (msg_dict.get("id"), msg_dict.get("role"), msg_dict.get("text"), msg_dict.get("time"),
                              msg_dict.get("sender_uuid")))
        except sqlite3.Error as e:
            logging.error(f"save_message Error: {e}")

    @staticmethod
    def get_history(cursor_id: int, direction: str = "older", limit: int = 20):
        try:
            with DBManager._get_char_conn() as conn:
                if direction == "older":
                    cursor = conn.execute(
                        """
                        SELECT id, role, text, time, sender_uuid 
                        FROM messages 
                        WHERE id < ? 
                        ORDER BY id DESC 
                        LIMIT ?
                        """,
                        (cursor_id, limit)
                    )
                    return [dict(row) for row in reversed(cursor.fetchall())]
                else:
                    cursor = conn.execute(
                        """
                        SELECT id, role, text, time, sender_uuid 
                        FROM messages 
                        WHERE id > ? 
                        ORDER BY id ASC 
                        LIMIT ?
                        """,
                        (cursor_id, limit)
                    )
                    return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logging.error(f"get_history Error: {e}")
            return []

    @staticmethod
    def get_latest_messages(limit: int = 30, uuid: Optional[str] = None):
        """
        获取最新的历史消息，按轮次
        """
        try:
            # 捞取一个安全的上限条数，确保在绝大多数场景下都能凑够指定的轮数
            batch_size = max(50, limit * 10)

            if uuid:
                with DBManager._get_contacts_conn(uuid) as conn:
                    cursor = conn.execute(
                        "SELECT id, role, text, time, sender_uuid FROM messages ORDER BY id DESC LIMIT ?",
                        (batch_size,)
                    )
                    rows = [dict(row) for row in cursor.fetchall()]
            else:
                with DBManager._get_char_conn() as conn:
                    cursor = conn.execute(
                        "SELECT id, role, text, time, sender_uuid FROM messages ORDER BY id DESC LIMIT ?",
                        (batch_size,)
                    )
                    rows = [dict(row) for row in cursor.fetchall()]

            if not rows:
                return []

            # 内存中按角色进行逆向轮次划分
            turns = []
            current_turn = []
            current_group_role = None

            for row in rows:
                role = row["role"]
                if not current_turn:
                    current_group_role = role
                    current_turn.append(row)
                elif current_group_role == role:
                    # 同角色，归为同一轮
                    current_turn.append(row)
                else:
                    # 角色发生切换，归档上一轮，启动新一轮
                    turns.append(current_turn)
                    current_group_role = role
                    current_turn = [row]

                # 收集满指定的轮数，提前终止循环
                if len(turns) == limit:
                    break

            # 放入最后一个未闭合的轮次
            if len(turns) < limit and current_turn:
                turns.append(current_turn)

            # 恢复为时间正序（旧 -> 新）并摊平列表
            flat_messages = []
            for turn in reversed(turns):
                flat_messages.extend(reversed(turn))

            return flat_messages

        except sqlite3.Error as e:
            logging.error(f"get_latest_messages Error: {e}")
            return []

    @staticmethod
    def get_new_messages(last_id: int, limit: int = None):
        try:
            with DBManager._get_char_conn() as conn:
                # 1. 如果没有传入 limit，执行原有的新消息轮询（只查更新的）
                if limit is None:
                    cursor = conn.execute(
                        """
                        SELECT id, role, text, time, sender_uuid 
                        FROM messages 
                        WHERE id > ? 
                        ORDER BY id ASC
                        """,
                        (last_id,)
                    )
                    return [dict(row) for row in cursor.fetchall()]

                # 2. 如果传入了 limit，返回 [上一条(-1)] + [当前(0)] + [后续(+n)]
                # 查询前一条消息 (-1)
                cursor_prev = conn.execute(
                    """
                    SELECT id, role, text, time, sender_uuid 
                    FROM messages 
                    WHERE id < ? 
                    ORDER BY id DESC 
                    LIMIT 1
                    """,
                    (last_id,)
                )
                older_msgs = [dict(row) for row in cursor_prev.fetchall()]

                # 查询当前定位消息 (0)
                cursor_curr = conn.execute(
                    """
                    SELECT id, role, text, time, sender_uuid 
                    FROM messages 
                    WHERE id = ?
                    """,
                    (last_id,)
                )
                current_msgs = [dict(row) for row in cursor_curr.fetchall()]

                # 查询后续消息 (+n)
                cursor_next = conn.execute(
                    """
                    SELECT id, role, text, time, sender_uuid 
                    FROM messages 
                    WHERE id > ? 
                    ORDER BY id ASC 
                    LIMIT ?
                    """,
                    (last_id, limit)
                )
                newer_msgs = [dict(row) for row in cursor_next.fetchall()]

                # 拼接后天然保持 ID 递增的时间正序
                return older_msgs + current_msgs + newer_msgs

        except sqlite3.Error as e:
            logging.error(f"get_new_messages Error: {e}")
            return []

    @staticmethod
    def get_grouped_turns_by_role():
        """
        获取按角色及发送者自适应合并的轮次内容
        """
        try:
            with DBManager._get_char_conn() as conn:
                # 1. 查找最新的一条消息，确定目标角色和发送者
                cursor = conn.execute(
                    "SELECT role, sender_uuid FROM messages ORDER BY id DESC LIMIT 1"
                )
                latest = cursor.fetchone()
                if not latest:
                    return {}

                latest_dict = dict(latest)
                target_role = latest_dict.get("role")
                target_sender_uuid = latest_dict.get("sender_uuid")

                # 判定是否存在有效的 sender_uuid
                has_sender_uuid = False
                if target_sender_uuid is not None:
                    val_str = str(target_sender_uuid).strip()
                    if val_str and val_str.lower() not in ("none", "null"):
                        has_sender_uuid = True
                        target_sender_uuid = val_str

                # 2. 根据自适应规则计算物理边界 ID
                if has_sender_uuid:
                    # 群聊场景：仅获取当前轮次，且发送者必须相符
                    # 计算当前轮次的起始边界：找到最新一条 [非目标角色] 或 [非目标发送者] 的消息 ID
                    boundary_cursor = conn.execute(
                        """
                        SELECT COALESCE(MAX(id), 0) AS boundary_id 
                        FROM messages 
                        WHERE role != ? 
                           OR sender_uuid != ? 
                           OR sender_uuid IS NULL
                        """,
                        (target_role, target_sender_uuid)
                    )
                    boundary_id = boundary_cursor.fetchone()["boundary_id"]

                    # 获取当前轮次的所有文本（时间正序）
                    curr_cursor = conn.execute(
                        "SELECT text FROM messages WHERE id > ? ORDER BY id ASC",
                        (boundary_id,)
                    )
                    current_texts = [row["text"] or "" for row in curr_cursor.fetchall()]
                    previous_texts = []

                else:
                    # 私聊场景：获取当前轮次 + 上一轮次
                    # (a) 计算当前轮次的起始边界：找到最新一条 [非目标角色] 的消息 ID
                    m2_cursor = conn.execute(
                        "SELECT COALESCE(MAX(id), 0) AS m2_id FROM messages WHERE role != ?",
                        (target_role,)
                    )
                    m2_id = m2_cursor.fetchone()["m2_id"]

                    # 获取当前轮次的所有文本（时间正序）
                    curr_cursor = conn.execute(
                        "SELECT text FROM messages WHERE id > ? ORDER BY id ASC",
                        (m2_id,)
                    )
                    current_texts = [row["text"] or "" for row in curr_cursor.fetchall()]

                    # (b) 计算上一轮次的结束边界：在 m2_id 之前，最新一条 [目标角色] 的消息 ID
                    prev_end_cursor = conn.execute(
                        "SELECT COALESCE(MAX(id), 0) AS prev_end_id FROM messages WHERE id < ? AND role = ?",
                        (m2_id, target_role)
                    )
                    prev_end_id = prev_end_cursor.fetchone()["prev_end_id"]

                    if prev_end_id > 0:
                        # 计算上一轮次的起始边界：在 prev_end_id 之前，最新一条 [非目标角色] 的消息 ID
                        prev_start_cursor = conn.execute(
                            "SELECT COALESCE(MAX(id), 0) AS prev_start_id FROM messages WHERE id < ? AND role != ?",
                            (prev_end_id, target_role)
                        )
                        prev_start_id = prev_start_cursor.fetchone()["prev_start_id"]

                        # 获取上一轮次的所有文本（时间正序）
                        prev_cursor = conn.execute(
                            "SELECT text FROM messages WHERE id > ? AND id <= ? ORDER BY id ASC",
                            (prev_start_id, prev_end_id)
                        )
                        previous_texts = [row["text"] or "" for row in prev_cursor.fetchall()]
                    else:
                        previous_texts = []

            # 3. 组装结果返回
            result = {}
            if previous_texts:
                result["previous"] = "\n".join(previous_texts)
            if current_texts:
                result["current"] = "\n".join(current_texts)

            return result

        except sqlite3.Error as e:
            logging.error(f"get_grouped_turns_by_role SQL Error: {e}")
            return {}
        except Exception as e:
            logging.error(f"get_grouped_turns_by_role Error: {e}")
            return {}

    @staticmethod
    def delete_messages(ids: list):
        """删除聊天记录"""
        if not ids: return
        try:
            with DBManager._get_char_conn() as conn:
                placeholders = ','.join('?' for _ in ids)
                conn.execute(f"DELETE FROM messages WHERE id IN ({placeholders})", ids)
        except sqlite3.Error as e:
            logging.error(f"delete_messages Error: {e}")

    @staticmethod
    def get_active_dates(year_month: str):
        """查找聊天记录日期"""
        try:
            # year_month 格式为 "YYYY/MM"，构建 LIKE 查询条件为 "YYYY/MM/%"
            query_pattern = f"{year_month}/%"

            with DBManager._get_char_conn() as conn:
                cursor = conn.execute(
                    """
                    SELECT DISTINCT substr(time, 1, 10) as active_date 
                    FROM messages 
                    WHERE time LIKE ? 
                    ORDER BY active_date ASC
                    """,
                    (query_pattern,)
                )
                return [row[0] for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logging.error(f"get_active_dates Error: {e}")
            return []

    @staticmethod
    def search(query: str):
        """查找聊天记录"""
        try:
            query_str = query.strip()
            if not query_str:
                return []

            # 在底层方法中校验是否为 YYYY/MM/DD 格式
            is_date_format = re.match(r"^\d{4}/\d{2}/\d{2}$", query_str)

            with DBManager._get_char_conn() as conn:
                if is_date_format:
                    # 匹配日期 YYYY/MM/DD
                    cursor = conn.execute(
                        """
                        SELECT id, role, text, time, sender_uuid 
                        FROM messages 
                        WHERE time LIKE ? 
                        ORDER BY id ASC
                        """,
                        (f"{query_str}%",)
                    )
                else:
                    # 匹配关键词
                    cursor = conn.execute(
                        """
                        SELECT id, role, text, time, sender_uuid 
                        FROM messages 
                        WHERE text LIKE ? 
                        ORDER BY id DESC
                        """,
                        (f"%{query_str}%",)
                    )
                return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logging.error(f"search Error: {e}")
            return []

    @staticmethod
    def edit_contact(contact_data: dict) -> str:
        uuid_val = contact_data["uuid"]
        type_val = contact_data.get("type", "P")
        nickname_val = contact_data["nickname"]
        avatar_val = contact_data["avatar"]
        card_data_val = contact_data["card_data"]
        members_val = contact_data.get("members", [])
        background_val = contact_data.get("background")

        if uuid_val == "new":
            new_uuid = str(uuid.uuid4())
            db_path = os.path.join(DBManager.CONTACTS_DIR, f"{new_uuid}.db")
            if avatar_val:
                avatar_val = DBManager._save_base64(avatar_val, new_uuid, DBManager.CONTACTS_DIR)
            try:
                with DBManager._get_conn(db_path) as conn:
                    # 确保新表结构完整创建
                    conn.execute(
                        "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT, text TEXT, time TEXT, sender_uuid TEXT)")
                    conn.execute("CREATE TABLE IF NOT EXISTS profiles (type TEXT PRIMARY KEY, json_data TEXT)")
                    conn.execute('''CREATE TABLE IF NOT EXISTS episodic_memories 
                                                 (first_id INTEGER PRIMARY KEY, last_id INTEGER, importance REAL, summary TEXT)''')
                    conn.execute('''CREATE TABLE IF NOT EXISTS semantic_memories 
                                                 (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT)''')
                    char_json = json.dumps({
                        "uuid": new_uuid,
                        "type": type_val,
                        "nickname": nickname_val,
                        "avatar": avatar_val,
                        "card_data": card_data_val,
                        "members": members_val,
                        "background": ""
                    }, ensure_ascii=False)
                    conn.execute("INSERT OR REPLACE INTO profiles (type, json_data) VALUES ('character', ?)",
                                 (char_json,))
                return new_uuid
            except sqlite3.Error as e:
                raise RuntimeError(f"Database creation failed: {e}")
        else:
            db_path = os.path.join(DBManager.CONTACTS_DIR, f"{uuid_val}.db")
            DBManager._ensure_sender_uuid_column(db_path)
            if avatar_val:
                avatar_val = DBManager._save_base64(avatar_val, uuid_val, DBManager.CONTACTS_DIR)
            if background_val:
                background_val = DBManager._save_base64(background_val, f"bg_{uuid_val}", DBManager.CONTACTS_DIR)
            with DBManager._get_conn(db_path) as conn:
                char_json = json.dumps({
                    "uuid": uuid_val,
                    "type": type_val,
                    "nickname": nickname_val,
                    "avatar": avatar_val,
                    "card_data": card_data_val,
                    "members": members_val,
                    "background": background_val
                }, ensure_ascii=False)
                conn.execute("UPDATE profiles SET json_data=? WHERE type='character'", (char_json,))
            return uuid_val

    @staticmethod
    def delete_contact(uuid_val: str) -> bool:
        if not isinstance(uuid_val, str) or not DBManager._is_safe_uuid(uuid_val):
            raise ValueError("Invalid or unsafe UUID format")

        db_avatar_path = os.path.join(DBManager.CONTACTS_DIR, f"avatar_{uuid_val}.*")
        avatar_files = glob.glob(db_avatar_path)

        db_bg_path = os.path.join(DBManager.CONTACTS_DIR, f"bg_{uuid_val}.*")
        bg_files = glob.glob(db_bg_path)

        db_path = os.path.join(DBManager.CONTACTS_DIR, f"{uuid_val}.db")

        if os.path.exists(db_path):
            try:
                if avatar_files:
                    os.remove(avatar_files[0])
                if bg_files:
                    os.remove(bg_files[0])
                os.remove(db_path)
                return True
            except OSError as e:
                logging.error(f"Failed to delete DB file {db_path}: {e}")
                raise RuntimeError(f"File deletion failed: {e}")
        return False

    @staticmethod
    def switch_contact(target_uuid: str) -> bool:
        if not isinstance(target_uuid, str) or not DBManager._is_safe_uuid(target_uuid):
            raise ValueError("Invalid or unsafe target UUID format")

        target_db_path = os.path.join(DBManager.CONTACTS_DIR, f"{target_uuid}.db")
        if not os.path.exists(target_db_path):
            raise FileNotFoundError(f"Target database for UUID {target_uuid} not found")

        current_uuid = None

        if os.path.exists(DBManager._char_db_path):
            try:
                with DBManager._get_conn(DBManager._char_db_path) as conn:
                    row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                    if row and row['json_data']:
                        char_data = json.loads(row['json_data'])
                        if isinstance(char_data, dict):
                            current_uuid = char_data.get("uuid")
            except sqlite3.Error as e:
                logging.warning(f"Could not read active DB uuid: {e}")

        if current_uuid and DBManager._is_safe_uuid(current_uuid):
            backup_db_path = os.path.join(DBManager.CONTACTS_DIR, f"{current_uuid}.db")
            try:
                if os.path.exists(backup_db_path):
                    # 确保备份目标数据库也是最新结构
                    DBManager._ensure_sender_uuid_column(backup_db_path)
                    with DBManager._get_conn(DBManager._char_db_path) as active_conn:
                        # 读取聊天记录
                        cursor = active_conn.execute("SELECT id, role, text, time, sender_uuid FROM messages")
                        messages_data = [dict(row) for row in cursor.fetchall()]
                        # 读取情境记忆
                        ep_cursor = active_conn.execute(
                            "SELECT first_id, last_id, importance, summary FROM episodic_memories")
                        episodic_data = [dict(row) for row in ep_cursor.fetchall()]
                        # 读取语义事实
                        sem_cursor = active_conn.execute(
                            "SELECT id, fact FROM semantic_memories")
                        semantic_data = [dict(row) for row in sem_cursor.fetchall()]
                    with DBManager._get_conn(backup_db_path) as backup_conn:
                        # 备份聊天记录
                        backup_conn.execute("DELETE FROM messages")
                        if messages_data:
                            backup_conn.executemany(
                                "INSERT INTO messages (id, role, text, time, sender_uuid) VALUES (:id, :role, :text, :time, :sender_uuid)",
                                messages_data
                            )
                        # 备份情境总结
                        backup_conn.execute("DELETE FROM episodic_memories")
                        if episodic_data:
                            backup_conn.executemany(
                                "INSERT INTO episodic_memories (first_id, last_id, importance, summary) VALUES (:first_id, :last_id, :importance, :summary)",
                                episodic_data
                            )
                        # 备份语义事实
                        backup_conn.execute("DELETE FROM semantic_memories")
                        if semantic_data:
                            backup_conn.executemany(
                                "INSERT INTO semantic_memories (id, fact) VALUES (:id, :fact)",
                                semantic_data
                            )

                    logging.info(f"Successfully synced messages and memories to {backup_db_path}")
            except Exception as e:
                logging.error(f"Failed to backup active DB messages and memories to {backup_db_path}: {e}")
                raise RuntimeError(f"Database sync failed: {e}")

        try:
            os.makedirs(os.path.dirname(DBManager._char_db_path), exist_ok=True)
            shutil.copy2(target_db_path, DBManager._char_db_path)
            logging.info(f"Successfully switched active DB to {target_uuid}")
            return True
        except Exception as e:
            logging.error(f"Failed to write target DB {target_db_path} to active path: {e}")
            raise RuntimeError(f"Database swap failed: {e}")

    @staticmethod
    def get_contact_info_by_uuid(uuid_val: str):
        if not DBManager._is_safe_uuid(uuid_val): return None
        db_path = os.path.join(DBManager.CONTACTS_DIR, f"{uuid_val}.db")
        if not os.path.exists(db_path): return None
        DBManager._ensure_sender_uuid_column(db_path)
        try:
            with DBManager._get_conn(db_path) as conn:
                row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                return json.loads(row['json_data']) if row else None
        except:
            return None

    @staticmethod
    def _ensure_sender_uuid_column(db_path: str):
        try:
            if not os.path.exists(db_path):
                return
            with DBManager._get_conn(db_path) as conn:
                # 1. 检查并迁移 sender_uuid 字段
                cursor = conn.execute("PRAGMA table_info(messages)")
                columns = [row[1] for row in cursor.fetchall()]
                if columns and "sender_uuid" not in columns:
                    conn.execute("ALTER TABLE messages ADD COLUMN sender_uuid TEXT")
                    logging.info(f"数据库迁移：已为 {os.path.basename(db_path)} 补全 sender_uuid 字段。")

                # 2. 自动为旧联系人升级补全长期记忆表
                conn.execute('''CREATE TABLE IF NOT EXISTS episodic_memories 
                                        (first_id INTEGER PRIMARY KEY, last_id INTEGER, importance REAL, summary TEXT)''')
                conn.execute('''CREATE TABLE IF NOT EXISTS semantic_memories 
                                        (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT)''')
        except Exception as e:
            logging.error(f"检查或添加数据库字段失败 ({db_path}): {e}")

    # ==========================================
    # 长期记忆专用方法
    # ==========================================
    @staticmethod
    def get_active_contact_uuid_for_memory() -> Optional[str]:
        """取当前活跃联系人的 UUID"""
        try:
            with DBManager._get_char_conn() as conn:
                row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                if row and row['json_data']:
                    char_data = json.loads(row['json_data'])
                    return char_data.get("uuid")
        except sqlite3.Error as e:
            logging.error(f"get_active_contact_uuid_for_memory Error: {e}")
        return None

    @staticmethod
    def get_all_episodic_memories(target_uuid: Optional[str] = None) -> list:
        """根据目标路由抓取其事件表内的全量事件总结"""
        try:
            # 自适应物理路径路由
            context = DBManager._get_char_conn() if target_uuid is None else DBManager._get_contacts_conn(target_uuid)
            with context as conn:
                cursor = conn.execute(
                    "SELECT first_id, last_id, importance, summary FROM episodic_memories ORDER BY first_id ASC"
                )
                return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logging.error(f"get_all_episodic_memories Error: {e}")
            return []

    @staticmethod
    def save_episodic_memory(first_id: int, last_id: int, importance: float, summary: str, target_uuid: Optional[str] = None):
        """存入该条事件"""
        try:
            context = DBManager._get_char_conn() if target_uuid is None else DBManager._get_contacts_conn(target_uuid)
            with context as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO episodic_memories (first_id, last_id, importance, summary) 
                    VALUES (?, ?, ?, ?)
                    """,
                    (first_id, last_id, importance, summary)
                )
        except sqlite3.Error as e:
            logging.error(f"save_episodic_memory Error: {e}")

    @staticmethod
    def get_last_summary_last_id() -> int:
        """抓取 summary 数据行最后一个的 last_id，若无记录则返回 0"""
        try:
            with DBManager._get_char_conn() as conn:
                row = conn.execute("SELECT COALESCE(MAX(last_id), 0) AS last_id FROM episodic_memories").fetchone()
                if row:
                    return int(row['last_id'])
        except sqlite3.Error as e:
            logging.error(f"get_last_summary_last_id Error: {e}")
        return 0

    @staticmethod
    def get_last_message_id_for_memory() -> int:
        """抓取 messages 数据行最后一个的 id，若无记录则返回 0"""
        try:
            with DBManager._get_char_conn() as conn:
                row = conn.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM messages").fetchone()
                if row:
                    return int(row['max_id'])
        except sqlite3.Error as e:
            logging.error(f"get_last_message_id_for_memory Error: {e}")
        return 0

    @staticmethod
    def get_messages_newer_than_id_for_memory(summary_last_id: int) -> list:
        """
        从旧到新（id 升序）抓取大于传入 ID 的所有未总结消息
        """
        try:
            with DBManager._get_char_conn() as conn:
                cursor = conn.execute(
                    """
                    SELECT id, role, text, time, sender_uuid 
                    FROM messages 
                    WHERE id > ? 
                    ORDER BY id ASC
                    """,
                    (summary_last_id,)
                )
                return [dict(row) for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logging.error(f"get_messages_newer_than_id_for_memory Error: {e}")
            return []

    @staticmethod
    def get_all_semantic_memories(target_uuid: Optional[str] = None) -> list:
        """根据目标路由抓取其事实表内的全量事实条目"""
        try:
            # 自适应连接上下文路由
            context = DBManager._get_char_conn() if target_uuid is None else DBManager._get_contacts_conn(target_uuid)
            with context as conn:
                cursor = conn.execute("SELECT id, fact FROM semantic_memories")
                return [{"id": row["id"], "fact": row["fact"]} for row in cursor.fetchall()]
        except sqlite3.Error as e:
            logging.error(f"get_all_semantic_memories Error: {e}")
            return []

    @staticmethod
    def execute_semantic_memory_operations(operations: list, target_uuid: Optional[str] = None):
        """物理执行事实条目的增、删、改批量操作"""
        try:
            context = DBManager._get_char_conn() if target_uuid is None else DBManager._get_contacts_conn(target_uuid)
            with context as conn:
                for op in operations:
                    action = str(op.get("action", "")).strip().upper()
                    op_id = op.get("id")
                    fact_text = str(op.get("fact", "")).strip()

                    if action == "ADD" and fact_text:
                        conn.execute(
                            "INSERT INTO semantic_memories (fact) VALUES (?)",
                            (fact_text,)
                        )
                    elif action == "UPDATE" and op_id and fact_text:
                        conn.execute(
                            "UPDATE semantic_memories SET fact = ? WHERE id = ?",
                            (fact_text, op_id)
                        )
                    elif action == "DELETE" and op_id:
                        conn.execute(
                            "DELETE FROM semantic_memories WHERE id = ?",
                            (op_id,)
                        )
                logging.info(f"Successfully executed {len(operations)} semantic memory operations.")
        except sqlite3.Error as e:
            logging.error(f"execute_semantic_memory_operations Error: {e}")


chat_db = DBManager()
DBManager._init_tables()


# 单元测试预留
if __name__ == "__main__":
    pass
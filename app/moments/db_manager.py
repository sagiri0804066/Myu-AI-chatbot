# app/moments/db_manager.py
import sqlite3
import logging
import json
import os
import uuid
import re
import time
import base64
from contextlib import contextmanager
from typing import Optional

# 配置基础日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class DBManager:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    DATA_DIR = os.path.join(BASE_DIR, "data")
    ACTIVE_DIR = os.path.join(DATA_DIR, "activeDB")
    MOMENTS_DIR = os.path.join(DATA_DIR, "moments")
    LIB_DIR = os.path.join(DATA_DIR, "lib")
    CONTACTS_DIR = os.path.join(DATA_DIR, "contacts")
    PROFILES_DIR = os.path.join(DATA_DIR, "profiles")

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(MOMENTS_DIR, exist_ok=True)
    os.makedirs(CONTACTS_DIR, exist_ok=True)
    os.makedirs(PROFILES_DIR, exist_ok=True)
    os.makedirs(ACTIVE_DIR, exist_ok=True)

    _char_db_path = os.path.join(ACTIVE_DIR, "char_data.db")
    _moments_db_path = os.path.join(MOMENTS_DIR, "moments_data.db")
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
    def _get_profiles_conn():
        """获取全局公共配置数据库的连接上下文"""
        return DBManager._get_conn(DBManager._profiles_db_path)

    @staticmethod
    def _get_moments_conn():
        """获取朋友圈数据库的连接上下文"""
        return DBManager._get_conn(DBManager._moments_db_path)

    @staticmethod
    def _is_safe_uuid(uuid_str: str) -> bool:
        """
        安全校验：限制 UUID 只能包含字母、数字和横线，防止路径穿越攻击（如传递 ../ 等路径）
        """
        if not uuid_str:
            return False
        return bool(re.match(r"^[a-zA-Z0-9\-]+$", uuid_str)) and len(uuid_str) < 100

    @staticmethod
    def _init_tables():
        """初始化表结构"""
        try:
            with DBManager._get_moments_conn() as conn:
                conn.execute('''CREATE TABLE IF NOT EXISTS moments (
                                    uuid TEXT PRIMARY KEY,
                                    id INTEGER,
                                    sender_uuid TEXT,
                                    text TEXT,
                                    appendix TEXT,
                                    praise TEXT,
                                    comments TEXT)''')
        except sqlite3.Error as e:
            logging.error(f"朋友圈数据库初始化失败: {e}")

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

    # ==========================================================================
    # 朋友圈专用底层数据交互
    # ==========================================================================
    @staticmethod
    def _get_contacts_map() -> dict:
        """读取所有联系人头像与昵称映射"""
        contacts_map = {}
        try:
            if os.path.exists(DBManager.CONTACTS_DIR):
                for filename in os.listdir(DBManager.CONTACTS_DIR):
                    if filename.endswith(".db"):
                        db_path = os.path.join(DBManager.CONTACTS_DIR, filename)
                        try:
                            with DBManager._get_conn(db_path) as conn:
                                row = conn.execute("SELECT json_data FROM profiles WHERE type='character'").fetchone()
                                if row and row['json_data']:
                                    c_data = json.loads(row['json_data'])
                                    uuid_key = c_data.get("uuid")
                                    if uuid_key:
                                        contacts_map[uuid_key] = {
                                            "nickname": c_data.get("nickname"),
                                            "avatar": c_data.get("avatar")
                                        }
                        except Exception:
                            pass
        except Exception as e:
            logging.error(f"获取联系人映射失败: {e}")
        return contacts_map

    @staticmethod
    def get_moments(limit: int = 20, before_id: int = None, sender_uuid: str = None, moment_uuid: str = None):
        """获取朋友圈列表，动态装配物理路径、昵称和头像。"""
        moments_list = []

        try:
            with DBManager._get_profiles_conn() as conn:
                user_row = conn.execute("SELECT json_data FROM profiles WHERE type='user'").fetchone()
                user_profile = json.loads(user_row['json_data']) if user_row else {}

            user_nickname = user_profile.get("nickname", "User")
            user_avatar = user_profile.get("avatar")

            contacts_map = DBManager._get_contacts_map()
            current_time = int(time.time())

            current_before_id = before_id
            target_limit = 1 if moment_uuid else limit

            while len(moments_list) < target_limit:
                needed = target_limit - len(moments_list)
                batch_size = max(needed * 2, 50) if not moment_uuid else 1

                conditions = []
                params = []

                if current_before_id is not None:
                    conditions.append("id < ?")
                    params.append(current_before_id)

                if sender_uuid is not None:
                    if sender_uuid == "user":
                        conditions.append("sender_uuid IS NULL")
                    else:
                        conditions.append("sender_uuid = ?")
                        params.append(sender_uuid)

                if moment_uuid is not None:
                    conditions.append("uuid = ?")
                    params.append(moment_uuid)

                where_clause = ""
                if conditions:
                    where_clause = "WHERE " + " AND ".join(conditions)

                params.append(batch_size)

                sql = (
                    f"SELECT uuid, id, sender_uuid, nickname, avatar, text, appendix, praise, comments "
                    f"FROM moments {where_clause} ORDER BY id DESC LIMIT ?"
                )

                with DBManager._get_moments_conn() as conn:
                    cursor = conn.execute(sql, tuple(params))
                    rows = cursor.fetchall()

                if not rows:
                    break

                for row in rows:
                    moment = dict(row)
                    current_before_id = moment["id"]

                    s_uuid = moment["sender_uuid"]

                    if s_uuid is not None and s_uuid != "user":
                        sender_info = contacts_map.get(s_uuid)
                        if not sender_info or not sender_info.get("nickname"):
                            continue
                        moment["nickname"] = sender_info.get("nickname") or moment["nickname"]
                        moment["avatar"] = sender_info.get("avatar") or moment["avatar"]
                    else:
                        moment["nickname"] = user_nickname
                        moment["avatar"] = user_avatar

                    moment["appendix"] = json.loads(moment["appendix"]) if moment["appendix"] else []

                    # --- 解析点赞 ---
                    db_praise_raw = json.loads(moment["praise"]) if moment["praise"] else []
                    hydrated_praise = []
                    hydrated_praise_details = []

                    for p_item in db_praise_raw:
                        p_uuid = p_item["uuid"] if isinstance(p_item, dict) else p_item
                        p_at = p_item["created_at"] if isinstance(p_item, dict) else 0

                        if p_at > current_time:
                            continue

                        if p_uuid is None or p_uuid == "user":
                            p_name = user_nickname
                            p_avatar = user_avatar
                        else:
                            sender_info = contacts_map.get(p_uuid)
                            if sender_info and sender_info.get("nickname"):
                                p_name = sender_info["nickname"]
                                p_avatar = sender_info.get("avatar") or ""
                            else:
                                continue

                        hydrated_praise.append(p_name)
                        hydrated_praise_details.append({
                            "name": p_name,
                            "sender_uuid": p_uuid if p_uuid != "user" else None,
                            "avatar": p_avatar,
                            "created_at": p_at
                        })

                    moment["praise"] = hydrated_praise
                    moment["_praise_details"] = hydrated_praise_details

                    # --- 解析评论 ---
                    db_comments = json.loads(moment["comments"]) if moment["comments"] else []
                    hydrated_comments = []

                    for comment in db_comments:
                        c_at = comment.get("created_at", 0)
                        if c_at > current_time:
                            continue

                        c_sender = comment.get("sender_uuid")
                        if c_sender is None or c_sender == "user":
                            c_name = user_nickname
                            c_avatar = user_avatar
                        else:
                            sender_info = contacts_map.get(c_sender)
                            if not sender_info or not sender_info.get("nickname"):
                                continue
                            c_name = sender_info["nickname"]
                            c_avatar = sender_info.get("avatar") or ""

                        reply_to_uuid = comment.get("reply_to")
                        reply_to_name = None

                        if reply_to_uuid:
                            if reply_to_uuid == "user":
                                reply_to_name = user_nickname
                            else:
                                reply_info = contacts_map.get(reply_to_uuid)
                                if not reply_info or not reply_info.get("nickname"):
                                    continue
                                reply_to_name = reply_info["nickname"]

                        if reply_to_uuid == "user":
                            reply_to_uuid = None

                        hydrated_comments.append({
                            "name": c_name,
                            "sender_uuid": c_sender if c_sender != "user" else None,
                            "avatar": c_avatar,
                            "created_at": c_at,
                            "text": comment.get("text", ""),
                            "reply_to": reply_to_uuid,
                            "reply_to_name": reply_to_name
                        })
                    moment["comments"] = hydrated_comments

                    moments_list.append(moment)

                    if len(moments_list) == target_limit:
                        break

                if moment_uuid:
                    break

        except Exception as e:
            logging.error(f"get_moments 错误: {e}")

        return moments_list

    @staticmethod
    def get_new_moments_messages() -> dict:
        """获取朋友圈新消息列表 (遍历近 50 条朋友圈中的新点赞与新评论)"""
        try:
            last_access_time = DBManager.get_last_access_time()
            current_time = int(time.time())

            # 调用 get_moments 获取近 50 条已装配的朋友圈
            moments = DBManager.get_moments(limit=50)
            new_messages = []

            for moment in moments:
                is_my_moment = (moment.get("sender_uuid") is None or moment.get("sender_uuid") == "user")

                # 检查我是否参与过（点过赞或评论过）
                my_praised = any(
                    (p.get("sender_uuid") is None or p.get("sender_uuid") == "user")
                    for p in moment.get("_praise_details", [])
                )
                my_commented = any(
                    (c.get("sender_uuid") is None or c.get("sender_uuid") == "user")
                    for c in moment.get("comments", [])
                )

                # 既不是我发的，我也没参与过，则跳过
                if not (is_my_moment or my_praised or my_commented):
                    continue

                # 构建动态图文/纯文本预览基础字段
                moment_preview = {}
                if moment.get("appendix") and len(moment["appendix"]) > 0:
                    moment_preview["appendix"] = moment["appendix"]
                else:
                    moment_preview["moment_text"] = moment.get("text", "")

                # 1. 检查新点赞 (仅在我发布的朋友圈中提醒别人的点赞)
                if is_my_moment:
                    for p_item in moment.get("_praise_details", []):
                        p_sender = p_item.get("sender_uuid")
                        p_time = p_item.get("created_at", 0)

                        # 过滤自己点赞，且满足时间间隔：last_access_time < p_time <= current_time
                        if (p_sender is not None and p_sender != "user") and (
                                last_access_time < p_time <= current_time):
                            msg_obj = {
                                "nickname": p_item.get("name", ""),
                                "avatar": p_item.get("avatar", ""),
                                "time": p_time,
                                "type": "praise",
                                "moment_uuid": moment["uuid"]
                            }
                            msg_obj.update(moment_preview)
                            new_messages.append(msg_obj)

                # 2. 检查新评论
                for c_item in moment.get("comments", []):
                    c_sender = c_item.get("sender_uuid")
                    c_time = c_item.get("created_at", 0)

                    # 过滤自己评论，且满足时间间隔：last_access_time < c_time <= current_time
                    if (c_sender is not None and c_sender != "user") and (last_access_time < c_time <= current_time):
                        msg_obj = {
                            "nickname": c_item.get("name", ""),
                            "avatar": c_item.get("avatar", ""),
                            "time": c_time,
                            "type": "comment",
                            "comment_text": c_item.get("text", ""),
                            "moment_uuid": moment["uuid"]
                        }
                        # 仅在有被回复人时才包含 reply_to 键
                        if c_item.get("reply_to_name"):
                            msg_obj["reply_to"] = c_item["reply_to_name"]

                        msg_obj.update(moment_preview)
                        new_messages.append(msg_obj)

            # 按时间倒序排列（最新的在最上面）
            new_messages.sort(key=lambda x: x["time"], reverse=True)

            return {
                "len": len(new_messages),
                "new_messages": new_messages
            }

        except Exception as e:
            logging.error(f"get_new_messages 失败: {e}")
            return {"len": 0, "new_messages": []}

    @staticmethod
    def _get_next_moment_img_index() -> int:
        """检测朋友圈图片输出目录，找到当前最大的 moment_N 编号，并返回下一个可用编号"""
        try:
            if not os.path.exists(DBManager.MOMENTS_DIR):
                return 1

            existing_files = os.listdir(DBManager.MOMENTS_DIR)
            max_idx = 0

            for f in existing_files:
                # 匹配 moment_数字.后缀 的格式（支持 jpg, jpeg, png 等常见图片格式）
                match = re.search(r'moment_(\d+)\.(jpg|jpeg|png|webp|gif)$', f, re.IGNORECASE)
                if match:
                    idx = int(match.group(1))
                    if idx > max_idx:
                        max_idx = idx
            return max_idx + 1
        except Exception as e:
            logging.error(f"获取朋友圈图片最大编号失败: {e}")
            return 1

    @staticmethod
    def add_moment(text: str, appendix_list: list, sender_uuid: str) -> Optional[str]:
        """ 发布朋友圈：解析 Base64 并保存图片，随后写入数据库记录 """
        try:
            saved_appendix = []

            # 获取当前图片的自增索引并保存物理文件
            next_img_idx = DBManager._get_next_moment_img_index()
            for idx, base64_str in enumerate(appendix_list):
                img_filename = f"moment_{next_img_idx}"
                file_path_url = DBManager._save_base64(base64_str, img_filename, DBManager.MOMENTS_DIR)
                saved_appendix.append(file_path_url)
                next_img_idx += 1

            moment_uuid = str(uuid.uuid4())
            current_time = int(time.time())

            # 规避同秒并发导致的 SQLite 主键 id 唯一约束冲突
            with DBManager._get_moments_conn() as conn:
                row = conn.execute("SELECT max(id) as max_id FROM moments").fetchone()
                if row and row["max_id"] is not None:
                    # 确保新 id 严格递增
                    current_time = max(current_time, int(row["max_id"]) + 1)

            # 标准化发帖人 UUID
            db_sender_uuid = None if sender_uuid == "user" or not sender_uuid else sender_uuid

            # 持久化写入数据库
            with DBManager._get_moments_conn() as conn:
                conn.execute(
                    "INSERT INTO moments (uuid, id, sender_uuid, nickname, avatar, text, appendix, praise, comments) "
                    "VALUES (?, ?, ?, NULL, NULL, ?, ?, '[]', '[]')",
                    (moment_uuid, current_time, db_sender_uuid, text, json.dumps(saved_appendix, ensure_ascii=False))
                )
            return moment_uuid
        except Exception as e:
            logging.error(f"发布朋友圈失败: {e}")
            return None

    @staticmethod
    def delete_moment_by_uuid(moment_uuid: str) -> bool:
        """删除一条朋友圈动态"""
        try:
            with DBManager._get_moments_conn() as conn:
                cursor = conn.execute("SELECT sender_uuid, appendix FROM moments WHERE uuid = ?", (moment_uuid,))
                row = cursor.fetchone()
                if not row:
                    return False

                # 拦截非本人动态的删除操作
                if row["sender_uuid"] is not None:
                    return False

                # 物理删除 data/moments/ 中的本地对应配图
                try:
                    appendix_paths = json.loads(row["appendix"]) if row["appendix"] else []
                    for path in appendix_paths:
                        if path.startswith("/data/"):
                            relative_path = path.lstrip("/")
                            full_path = os.path.join(os.getcwd(), relative_path)
                            if os.path.exists(full_path):
                                os.remove(full_path)
                except Exception as file_err:
                    logging.warning(f"清除朋友圈本地图片异常: {file_err}")

                conn.execute("DELETE FROM moments WHERE uuid = ?", (moment_uuid,))
            return True
        except Exception as e:
            logging.error(f"delete_moment 失败: {e}")
            return False

    @staticmethod
    def toggle_praise(moment_uuid: str, sender_uuid: str, created_at: int = None) -> bool:
        """点赞/取消点赞切换动作。支持传入虚拟时间戳实现延迟点赞。"""
        try:
            # 标准化操作人 UUID，存入数据库时统一用 "user" 或 AI 的 UUID
            db_sender_uuid = "user" if (sender_uuid == "user" or not sender_uuid) else sender_uuid

            # 如果没传时间（如真人点赞），则为当前时间
            if created_at is None:
                created_at = int(time.time())

            with DBManager._get_moments_conn() as conn:
                cursor = conn.execute("SELECT praise FROM moments WHERE uuid = ?", (moment_uuid,))
                row = cursor.fetchone()
                if not row:
                    return False

                raw_data = json.loads(row["praise"]) if row["praise"] else []

                # 兼容旧数据转化
                praise_list = []
                for item in raw_data:
                    if isinstance(item, str):
                        praise_list.append({"uuid": item, "created_at": 0})
                    else:
                        praise_list.append(item)

                # 检查是否已点赞
                existing_index = -1
                for i, item in enumerate(praise_list):
                    if item["uuid"] == db_sender_uuid:
                        existing_index = i
                        break

                if existing_index >= 0:
                    # 取消点赞
                    praise_list.pop(existing_index)
                else:
                    # 添加点赞
                    praise_list.append({
                        "uuid": db_sender_uuid,
                        "created_at": created_at
                    })

                conn.execute("UPDATE moments SET praise = ? WHERE uuid = ?",
                             (json.dumps(praise_list, ensure_ascii=False), moment_uuid))
            return True
        except Exception as e:
            logging.error(f"toggle_praise 失败: {e}")
            return False

    @staticmethod
    def add_comment(moment_uuid: str, sender_uuid: str, comment_dict: dict) -> bool:
        """追加新评论"""
        try:
            # 标准化评论人 UUID
            db_sender_uuid = None if sender_uuid == "user" or not sender_uuid else sender_uuid

            # 标准化被回复人 UUID
            reply_to_uuid = comment_dict.get("reply_to")

            # 组装存储专用的 comment 数据结构
            # 显式提取并存入 created_at 字段，若没有传入则默认取当前系统时间
            db_comment = {
                "sender_uuid": db_sender_uuid,
                "text": comment_dict.get("text", ""),
                "reply_to": reply_to_uuid,
                "created_at": comment_dict.get("created_at") or int(time.time())
            }

            with DBManager._get_moments_conn() as conn:
                cursor = conn.execute("SELECT comments FROM moments WHERE uuid = ?", (moment_uuid,))
                row = cursor.fetchone()
                if not row:
                    return False

                comments_list = json.loads(row["comments"]) if row["comments"] else []
                comments_list.append(db_comment)

                conn.execute("UPDATE moments SET comments = ? WHERE uuid = ?",
                             (json.dumps(comments_list, ensure_ascii=False), moment_uuid))
            return True
        except Exception as e:
            logging.error(f"add_comment 失败: {e}")
            return False

# ==========================================================================
# 朋友圈模板图片排重数据交互
# ==========================================================================
    @staticmethod
    def get_used_images() -> list:
        """获取所有已发送过的配图模板文件名"""
        try:
            with DBManager._get_moments_conn() as conn:
                conn.execute("CREATE TABLE IF NOT EXISTS used_assets (filename TEXT PRIMARY KEY)")
                cursor = conn.execute("SELECT filename FROM used_assets")
                return [row["filename"] for row in cursor.fetchall()]
        except Exception as e:
            logging.error(f"get_used_images 失败: {e}")
            return []

    @staticmethod
    def mark_image_as_used(filename: str) -> bool:
        """将配图模板文件名标记为已使用"""
        try:
            with DBManager._get_moments_conn() as conn:
                conn.execute("CREATE TABLE IF NOT EXISTS used_assets (filename TEXT PRIMARY KEY)")
                conn.execute("INSERT OR IGNORE INTO used_assets (filename) VALUES (?)", (filename,))
            return True
        except Exception as e:
            logging.error(f"mark_image_as_used 失败: {e}")
            return False

    @staticmethod
    def reset_used_images() -> bool:
        """清空已发送配图的历史记录表"""
        try:
            with DBManager._get_moments_conn() as conn:
                conn.execute("DELETE FROM used_assets")
            return True
        except Exception as e:
            logging.error(f"reset_used_images 失败: {e}")
            return False

    @staticmethod
    def get_last_interaction_time(user_uuid: str) -> int:
        """获取用户最后一次在朋友圈互动的时刻（点赞或评论），用于计算防冷落/防饥饿权重"""
        try:
            db_sender_uuid = None if user_uuid == "user" or not user_uuid else user_uuid
            with DBManager._get_moments_conn() as conn:
                # 扫描最近的 50 条朋友圈，解析看该用户是否有点赞或评论
                cursor = conn.execute("SELECT id, praise, comments FROM moments ORDER BY id DESC LIMIT 50")
                for row in cursor.fetchall():
                    # 检查点赞
                    praise_list = json.loads(row["praise"]) if row["praise"] else []
                    if db_sender_uuid in praise_list:
                        return int(row["id"])  # 返回当时朋友圈发布的时间戳作为近似互动时间

                    # 检查评论
                    comments_list = json.loads(row["comments"]) if row["comments"] else []
                    for c in comments_list:
                        if c.get("sender_uuid") == db_sender_uuid:
                            return int(row["id"])
        except Exception as e:
            logging.error(f"获取最后互动时间失败: {e}")
        # 如果从没互动过，默认返回 3 天前的时间戳，赋予其一个较为健康的初始活跃度
        return int(time.time()) - (3 * 24 * 3600)

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
            with sqlite3.connect(db_path) as conn:
                cursor = conn.execute("PRAGMA table_info(messages)")
                columns = [row[1] for row in cursor.fetchall()]
                if columns and "sender_uuid" not in columns:
                    conn.execute("ALTER TABLE messages ADD COLUMN sender_uuid TEXT")
                    logging.info(f"数据库迁移：已为 {os.path.basename(db_path)} 补全 sender_uuid 字段。")
        except Exception as e:
            logging.error(f"检查或添加数据库字段失败 ({db_path}): {e}")

    @staticmethod
    def get_last_post_time(sender_uuid: str = None):
        if sender_uuid:
            # 查询某个角色上一次在朋友圈发帖的时间戳
            try:
                with moments_db._get_moments_conn() as conn:
                    row = conn.execute(
                        "SELECT id FROM moments WHERE sender_uuid = ? ORDER BY id DESC LIMIT 1",
                        (sender_uuid,)
                    ).fetchone()
                    if row:
                        return int(row["id"])
            except Exception as e:
                logging.error(f"获取上一次发帖时间失败: {e}")
            return int(time.time()) - (7 * 24 * 3600)
        else:
            # 查询全网（所有人中）最后一次发朋友圈的时间戳
            try:
                with moments_db._get_moments_conn() as conn:
                    row = conn.execute("SELECT id FROM moments ORDER BY id DESC LIMIT 1").fetchone()
                    if row:
                        return int(row["id"])
            except Exception as e:
                logging.error(f"获取全网最后一次发帖时间失败: {e}")
            return 0

    @staticmethod
    def get_moment_by_uuid(moment_uuid: str) -> Optional[dict]:
        """查询单条朋友圈数据"""
        try:
            with moments_db._get_moments_conn() as conn:
                row = conn.execute(
                    "SELECT sender_uuid, text, appendix, praise, comments FROM moments WHERE uuid = ?",
                    (moment_uuid,)
                ).fetchone()
                if row:
                    return dict(row)
        except Exception as e:
            logging.error(f"get_moment_by_uuid error: {e}")
        return None

# ==========================================================================
# 用户朋友圈新消息访问时间控制
# ==========================================================================
    @staticmethod
    def get_last_access_time() -> int:
        """获取用户上次读取/查看朋友圈新消息的时间戳，不存在则返回 0"""
        try:
            with DBManager._get_moments_conn() as conn:
                conn.execute("CREATE TABLE IF NOT EXISTS user_access (key TEXT PRIMARY KEY, val INTEGER)")
                row = conn.execute("SELECT val FROM user_access WHERE key = 'last_access_time'").fetchone()
                if row and row["val"] is not None:
                    return int(row["val"])
        except Exception as e:
            logging.error(f"get_last_access_time 失败: {e}")
        return 0

    @staticmethod
    def update_last_access_time(timestamp: int = None) -> bool:
        """更新用户上次读取/查看朋友圈新消息的时间戳（不传默认取当前时间戳）"""
        if timestamp is None:
            timestamp = int(time.time())
        try:
            with DBManager._get_moments_conn() as conn:
                conn.execute("CREATE TABLE IF NOT EXISTS user_access (key TEXT PRIMARY KEY, val INTEGER)")
                conn.execute("INSERT OR REPLACE INTO user_access (key, val) VALUES ('last_access_time', ?)", (timestamp,))
            return True
        except Exception as e:
            logging.error(f"update_last_access_time 失败: {e}")
            return False


moments_db = DBManager()
DBManager._init_tables()
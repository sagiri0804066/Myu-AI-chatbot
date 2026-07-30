# app/moments/api_router.py
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks, Query
from pydantic import BaseModel
from typing import List, Optional
from .db_manager import moments_db
from ..chat.db_manager import chat_db

moments_router = APIRouter(prefix="/api/moments")


# --- 朋友圈特定请求模型 ---
class MomentSendReq(BaseModel):
    text: str
    appendix: List[str]  # 前端传入的 Base64 图片数组
    sender_uuid: Optional[str] = "user"


class CommentReq(BaseModel):
    moment_uuid: str
    sender_uuid: Optional[str] = "user"
    text: str
    reply_to: Optional[str] = ""


class MomentDelReq(BaseModel):
    uuid: str


# ==========================================
# 接口 1: 朋友圈初始化 (Moments Init)
# ==========================================
@moments_router.get("/init")
def get_moments_init(uuid: Optional[str] = Query(None, description="筛选指定发送者的朋友圈 UUID")):
    init_data = chat_db.get_init_data()

    # 如果没有 uuid，或者 uuid 为 "user"，返回当前登录用户的数据
    if not uuid or uuid == "user":
        return init_data.get("user", {})

    # 如果有特定联系人 uuid，则遍历并返回对应的联系人数据
    contacts = init_data.get("contacts", [])

    if isinstance(contacts, list):
        for contact in contacts:
            if contact.get("uuid") == uuid:
                return contact
    # 若在联系人列表中未找到匹配的数据，返回空对象
    return


# ==========================================
# 接口 2: 朋友圈历史纪录 (Moments History)
# ==========================================
@moments_router.get("/history")
def get_moments_history(
    cursor: Optional[int] = Query(None, description="时间戳 ID，传值则获取该时间戳之前的更早动态，不传则获取最新动态"),
    uuid: Optional[str] = Query(None, description="筛选指定发送者的朋友圈 UUID"),
    moment_uuid: Optional[str] = Query(None, description="筛选指定单条朋友圈 UUID")
):
    moments = moments_db.get_moments(limit=20, before_id=cursor, sender_uuid=uuid, moment_uuid=moment_uuid)
    return moments

# ==========================================
# 接口 3: 发送朋友圈 (Moments Send)
# ==========================================
@moments_router.post("/send")
async def send_moment(
        req: MomentSendReq,
        request: Request,  # 注入 Request 以获取 app.state
        background_tasks: BackgroundTasks  # 注入 BackgroundTasks 以执行异步任务
):
    if len(req.appendix) > 9:
        raise HTTPException(status_code=400, detail="Cannot send more than 9 images")

    # 传入 req.sender_uuid，支持用户和 AI 发送，并返回生成的 moment_uuid
    moment_uuid = moments_db.add_moment(req.text, req.appendix, req.sender_uuid)

    if moment_uuid:
        # 判断如果是真人（用户）发朋友圈，则触发 AI 角色的被动盖楼与点赞
        if req.sender_uuid == "user" or not req.sender_uuid:
            # 从 app.state 中获取朋友圈引擎实例
            engine = getattr(request.app.state, "moments_engine", None)

            if engine:
                print(f"[Debug] 用户发朋友圈成功，ID: '{moment_uuid}'，正在将 AI 盖楼与点赞任务丢入后台线程...")

                # 异步执行互动模拟。默认发送人为“用户”
                background_tasks.add_task(
                    engine._simulate_and_write_interactions,
                    moment_id=moment_uuid,
                    sender_uuid="user",
                    sender_name="用户",
                    post_text=req.text,
                    img_tags="无"
                )
            else:
                print("[Debug] 警告：未能从 app.state 获取到 moments_engine 实例，请检查 main.py 挂载是否成功！")

        return {"status": "success", "moment_uuid": moment_uuid}

    raise HTTPException(status_code=500, detail="Failed to send moment")


# ==========================================
# 接口 4: 点赞交互 (Toggle Praise)
# ==========================================
@moments_router.get("/praise")
def toggle_praise(uuid: str, sender_uuid: Optional[str] = "user"):
    # 直接将前端传入的 sender_uuid 传给底层
    success = moments_db.toggle_praise(uuid, sender_uuid)
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Moment not found")


# ==========================================
# 接口 5: 提交评论 (Submit Comment)
# ==========================================
@moments_router.post("/comments")
async def submit_comment(
        req: CommentReq,
        request: Request,  # 必须注入 Request
        background_tasks: BackgroundTasks  # 必须注入 BackgroundTasks
):
    print(f"[Debug] 收到用户评论请求: sender_uuid='{req.sender_uuid}', moment_uuid='{req.moment_uuid}'")
    reply_to_val = req.reply_to if req.reply_to else None

    # 构建字典
    comment_dict = {
        "text": req.text,
        "reply_to": reply_to_val
    }

    # 1. 写入数据库
    success = moments_db.add_comment(req.moment_uuid, req.sender_uuid, comment_dict)

    if success:
        print("[Debug] 评论成功写入数据库。")

        # 2. 判断是否为真人评论。如果是，才触发 AI 反应
        if req.sender_uuid == "user" or not req.sender_uuid:
            # 从刚才在 main.py 挂载好的 app.state 中获取朋友圈引擎实例 [1]
            engine = getattr(request.app.state, "moments_engine", None)

            if engine:
                print("[Debug] 成功找到朋友圈引擎，正在将 AI 盖楼任务丢入后台线程...")
                # 异步触发 AI 的被动盖楼
                background_tasks.add_task(
                    engine.on_user_comment_added,
                    moment_uuid=req.moment_uuid,
                    user_text=req.text,
                    reply_to_uuid=reply_to_val
                )
            else:
                print("[Debug] 警告：未能从 app.state 获取到 moments_engine 实例，请检查 main.py 挂载是否成功！")
        else:
            print(f"[Debug] 评论人是 AI 角色自己 ({req.sender_uuid})，无需重复触发盖楼。")

        return {"status": "success"}

    raise HTTPException(status_code=404, detail="Moment not found")


# ==========================================
# 接口 6: 删除朋友圈动态 (Delete Moment)
# ==========================================
@moments_router.post("/delete")
def delete_moment(req: MomentDelReq):
    success = moments_db.delete_moment_by_uuid(req.uuid)
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=400, detail="Delete failed. You can only delete your own moments.")


# ==========================================
# 接口 7: 查询新消息 (Moments New Messages)
# ==========================================
@moments_router.get("/new_messages")
def get_new_messages():
    return moments_db.get_new_moments_messages()


# ==========================================
# 接口 8: 标记新消息为已读 (Mark Messages as Read)
# ==========================================
@moments_router.post("/read_messages")
def mark_messages_as_read():
    success = moments_db.update_last_access_time()
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to update last access time")
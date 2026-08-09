# app/chat/api_router.py
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
import asyncio
import time
import os
from .db_manager import chat_db
from .buffer_heap import heap
from .ai_worker import engine_instance

# 定义预设文件存储目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.getcwd(), "data")

if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

chat_router = APIRouter(prefix="/api/message")


# --- Pydantic 模型定义 ---
class MsgReq(BaseModel):
    text: str
    time: int


class DelReq(BaseModel):
    ids: List[int]


class ProfileReq(BaseModel):
    nickname: str
    org: str
    birthday: str
    hobbies: str
    gender: str
    avatar: Optional[str] = None
    background: Optional[str] = None


class EditContactReq(BaseModel):
    uuid: str
    type: str = "P"
    nickname: str
    avatar: Optional[str] = None
    card_data: str
    members: List[str] = [],
    background: Optional[str] = None


class DeleteContactReq(BaseModel):
    uuid: str


class SwitchContactReq(BaseModel):
    uuid: str


# --- 延迟调度管理器 ---
class PipelineScheduler:
    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._pending_text: Optional[str] = None

    async def _run_delayed(self):
        try:
            # 等待 5 秒
            await asyncio.sleep(5.0)
            if self._pending_text is not None:
                text_to_process = self._pending_text
                self._pending_text = None
                # 激活 AI 流水线
                await engine_instance.on_new_message(text_to_process)
        except asyncio.CancelledError:
            # 任务被正常取消/打断，不进行任何操作
            pass

    def schedule(self, text: str):
        """发送新消息时，注册延迟执行任务"""
        self._pending_text = text
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = asyncio.create_task(self._run_delayed())

    def interrupt(self):
        """收到输入框变动等打断信号时，重新开始 10 秒倒计时"""
        if self._pending_text is not None:
            if self._task and not self._task.done():
                self._task.cancel()
            self._task = asyncio.create_task(self._run_delayed())


# ==========================================
# 接口 1: 初始化 (Init)
# ==========================================
@chat_router.get("/init")
def init_chat():
    data = chat_db.get_init_data()
    return {
        "user": data["user"],
        "contact": data["contact"],
        "statusIndex": heap.statusIndex,
        "contacts": data["contacts"],
        "messages": data["messages"]
    }


# ==========================================
# 接口 2: 长轮询推送端 (Poll)
# ==========================================
@chat_router.get("/poll")
async def poll_messages(cursor: int):
    start_status = heap.statusIndex

    for _ in range(30):
        new_msgs = await asyncio.to_thread(chat_db.get_new_messages, cursor)

        if new_msgs or heap.statusIndex != start_status:
            return {
                "statusIndex": heap.statusIndex,
                "messages": new_msgs
            }

        if await heap.wait_for_bell(timeout=1.0):
            fresh_msgs = await asyncio.to_thread(chat_db.get_new_messages, cursor)
            return {
                "statusIndex": heap.statusIndex,
                "messages": fresh_msgs
            }

    return {
        "statusIndex": heap.statusIndex,
        "messages": []
    }


# ==========================================
# 接口 3: 历史消息加载 (双向兼容)
# ==========================================
@chat_router.get("/history")
def get_history(
    cursor: int,
    direction: str = Query("older", pattern=r"^(older|newer)$"),
    limit: int = 10
):
    older_msgs = chat_db.get_history(cursor, direction, limit)
    return {"messages": older_msgs}


# ==========================================
# 接口 3.1: 获取有聊天记录的日期
# ==========================================
@chat_router.get("/active_dates")
def get_active_dates(year_month: str = Query(..., pattern=r"^\d{4}/\d{2}$")):
    active_days = chat_db.get_active_dates(year_month)
    return {"activeDays": active_days}


# ==========================================
# 接口 3.2: 混合搜索 (日期或关键词)
# ==========================================
@chat_router.get("/search")
def search_messages(query: str):
    query_str = query.strip()
    if not query_str:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    results = chat_db.search(query_str)
    return {"messages": results}


# ==========================================
# 接口 3.3: 获取选定消息上下文
# ==========================================
@chat_router.get("/context")
def get_message_context(message_id: int):
    context_msgs = chat_db.get_new_messages(message_id, limit = 10)
    return {"messages": context_msgs}


# ==========================================
# 接口 4: 保存资料 (Profile)
# ==========================================
@chat_router.post("/user/profile")
def save_profile(req: ProfileReq):
    chat_db.update_profile(req.dict())
    return {"status": "success"}


# ==========================================
# 接口 5: 发送消息 (Send)
# ==========================================
@chat_router.post("/send")
async def send_message(req: MsgReq):
    msg_id = time.time()
    readable_time = time.strftime("%Y/%m/%d %H:%M", time.localtime(req.time / 1000))

    final_msg = {
        "id": msg_id,
        "role": "user",
        "text": req.text,
        "time": readable_time,
        "sender_uuid": None
    }

    # 1. 消息只落库
    await asyncio.to_thread(chat_db.save_message, final_msg)

    # 2. 注册延迟任务，不立刻激活流水线
    pipeline_scheduler.schedule(req.text)

    return {"status": "ok", "time": readable_time}


# ==========================================
# 接口 5.1: 接收前端打断信号 (Interrupt)
# ==========================================
@chat_router.get("/interrupt")
async def interrupt_pipeline():
    pipeline_scheduler.interrupt()
    return {"status": "interrupted"}


# ==========================================
# 接口 6: 批量删除 (Delete)
# ==========================================
@chat_router.post("/delete")
def delete_messages(req: DelReq):
    chat_db.delete_messages(req.ids)
    return {"status": "success"}


# ==========================================
# 接口 7: 编辑联系人 (Edit Contact)
# ==========================================
@chat_router.post("/edit/contact")
def edit_contact(req: EditContactReq):
    try:
        contact_data = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        new_uuid = chat_db.edit_contact(contact_data)
        return {"status": "success", "uuid": new_uuid}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error")


# ==========================================
# 接口 8: 删除联系人 (Delete Contact)
# ==========================================
@chat_router.post("/delete/contact")
def delete_contact(req: DeleteContactReq):
    try:
        success = chat_db.delete_contact(req.uuid)
        if success:
            return {"status": "success"}
        else:
            raise HTTPException(status_code=404, detail="Contact database file not found")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ==========================================
# 接口 9: 切换联系人 (Switch Contact)
# ==========================================
@chat_router.post("/switch/contact")
def switch_contact(req: SwitchContactReq):
    try:
        chat_db.switch_contact(req.uuid)
        engine_instance.interrupt()
        return {"status": "success"}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# 初始化全局调度器实例
pipeline_scheduler = PipelineScheduler()
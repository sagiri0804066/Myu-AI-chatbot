import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# 导入业务路由
from app.chat.routers import chat_router
from app.config.routers import config_router
from app.moments.routers import moments_router

# 导入业务实例
from app.chat.ai_worker import engine_instance
from app.chat.db_manager import chat_db

# 导入朋友圈和 Prompt 任务
from app.moments.moments_runner import start_moments_daemon
from app.moments.moments_generator import MomentsGeneratorEngine
from app.config.config_manager import config_manager

import webbrowser
import uvicorn
import threading
import time
import urllib.request
import urllib.error


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[系统] 正在启动后台任务...")

    moments_engine = MomentsGeneratorEngine()
    app.state.moments_engine = moments_engine

    task = asyncio.create_task(engine_instance.auto_message_loop())
    moments_task = asyncio.create_task(start_moments_daemon())
    yield
    task.cancel()
    moments_task.cancel()
    print("[系统] 后台任务已关闭")


app = FastAPI(lifespan=lifespan)

# --- 2. 注册业务路由 ---
app.include_router(chat_router)
app.include_router(config_router)
app.include_router(moments_router)

base_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(base_dir, "static")


@app.get("/chat")
async def get_chat():
    return FileResponse(os.path.join(static_dir, "chat.html"))


@app.get("/settings")
async def get_settings():
    return FileResponse(os.path.join(static_dir, "settings.html"))


@app.get("/moments")
async def get_moments():
    return FileResponse(os.path.join(static_dir, "moments.html"))


# --- 3. 挂载数据静态目录 ---
app.mount("/data", StaticFiles(directory=chat_db.DATA_DIR), name="data_static")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    host = config_manager.server_config.get("host", "127.0.0.1")
    port = config_manager.server_config.get("port", 7000)

    browser_host = "127.0.0.1" if host == "0.0.0.0" else host
    chat_url = f"http://{browser_host}:{port}/chat"


    def open_browser():
        while True:
            try:
                with urllib.request.urlopen(chat_url, timeout=1) as resp:
                    if resp.status == 200:
                        webbrowser.open(chat_url)
                        return
            except Exception:
                pass
            time.sleep(0.2)

    threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(app, host=host, port=port)
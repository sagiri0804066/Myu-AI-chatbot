from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel, HttpUrl, Field
import asyncio
import httpx
import os
import shutil
from fastapi.responses import FileResponse
from .db_manager import config_db
from ..llm.llm_client import llm_client


# --- 安全工具函数 ---
def get_safe_path(filename: str):
    """
    通过 basename 强制提取文件名，彻底杜绝 ../ 路径穿越
    """
    safe_name = os.path.basename(filename)
    # 额外检查：防止直接传入绝对路径或非法空字符
    if not safe_name or safe_name in [".", ".."]:
        raise HTTPException(status_code=400, detail="非法的文件名")
    return os.path.join(PRESET_DIR, safe_name)


# 定义预设文件存储目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.getcwd(), "data")
PRESET_DIR = os.path.join(DATA_DIR, "preset")

if not os.path.exists(PRESET_DIR):
    os.makedirs(PRESET_DIR)

config_router = APIRouter(prefix="/api/settings")


# --- Pydantic 模型定义 (增加基础值校验) ---
class ConfigReq(BaseModel):
    baseurl: str
    apikey: str
    model: str
    models: list
    preset: str
    presets: list
    max_tokens: int = Field(gt=0)
    temperature: float = Field(ge=0, le=2.0)
    top_p: float = Field(ge=0, le=1.0)
    frequency_penalty: float = Field(ge=-2.0, le=2.0)
    presence_penalty: float = Field(ge=-2.0, le=2.0)
    stream: bool
    vlm_enabled: bool
    vlm_baseurl: str
    vlm_apikey: str
    vlm_model: str


class PresetDelReq(BaseModel):
    filename: str


# ==========================================
# 接口 1: 获取设置初始化
# ==========================================
@config_router.get("/init")
def get_settings():
    config = config_db.get_config()
    # 仅允许读取 json 和 txt，过滤敏感文件
    files = [f for f in os.listdir(PRESET_DIR) if f.endswith(".json") or f.endswith(".txt")]
    config["presets"] = files
    return config


# ==========================================
# 接口 2: 保存设置
# ==========================================
@config_router.post("/profile")
def update_settings(req: ConfigReq):
    # 增加基础的安全检查：base_url 必须是 http/https 开头，防止非法路径
    if not (req.baseurl.startswith("http://") or req.baseurl.startswith("https://")):
        raise HTTPException(status_code=400, detail="BaseURL 必须以 http:// 或 https:// 开头")

    config_db.update_config(req.dict())

    llm_client.reload_config()

    return {"status": "success"}


# ==========================================
# 接口 3: 获取模型列表
# ==========================================
@config_router.get("/get/models")
async def get_remote_models():
    config = await asyncio.to_thread(config_db.get_config)
    base_url = config.get("baseurl", "").strip("/")
    api_key = config.get("apikey", "")

    if not base_url or not api_key:
        return {"models": []}

    if not base_url.lower().startswith("http"):
        return {"models": [], "error": "URL 必须以 http 或 https 开头"}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0
            )
            res_data = response.json()
            model_list = [m["id"] for m in res_data.get("data", [])]
            return {"models": model_list}
    except Exception as e:
        return {"models": [], "error": "无法连接到远程服务，请检查网络或配置"}


# ==========================================
# 接口 4: 上传预设
# ==========================================
@config_router.post("/upload/preset")
def upload_preset(file: UploadFile = File(...)):
    safe_path = get_safe_path(file.filename)

    try:
        with open(safe_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"status": "success", "filename": os.path.basename(safe_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail="文件写入失败")


# ==========================================
# 接口 5: 下载预设
# ==========================================
@config_router.get("/download/preset")
def download_preset(filename: str):
    safe_path = get_safe_path(filename)

    if not os.path.exists(safe_path):
        raise HTTPException(status_code=404, detail="预设文件不存在")

    return FileResponse(
        path=safe_path,
        filename=os.path.basename(safe_path),
        media_type='application/octet-stream'
    )


# ==========================================
# 接口 6: 删除预设
# ==========================================
@config_router.post("/delete/preset")
def delete_preset(req: PresetDelReq):
    safe_path = get_safe_path(req.filename)

    if os.path.exists(safe_path):
        try:
            os.remove(safe_path)
            return {"status": "success"}
        except Exception as e:
            raise HTTPException(status_code=500, detail="删除操作失败")
    else:
        raise HTTPException(status_code=404, detail="文件不存在")
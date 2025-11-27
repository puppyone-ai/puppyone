"""
文件解析 API
用于处理有价值的二进制文件解析（支持 MinerU API 和本地 Python 库两种方式）
"""
import os
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import FileResponse
from typing import Optional
from app.schemas.response import ApiResponse
from app.utils.mineru import get_mineru_client, MinerUClient
from app.utils.local_file_parser import get_local_file_parser
from app.core.config import settings
from app.utils.logger import log_info, log_error

router = APIRouter(prefix="/file-parser", tags=["文件解析"])


def ensure_temp_storage():
    """确保临时存储目录存在"""
    settings.MINERU_TEMP_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload", response_model=ApiResponse[dict])
async def upload_file_for_parsing(
    file: UploadFile = File(...)
):
    """
    上传文件到临时存储，返回文件 URL
    
    注意：这个端点返回的是本地文件路径，实际使用时需要配置静态文件服务
    或者将文件上传到云存储（如 S3、OSS）后返回公开 URL
    """
    ensure_temp_storage()
    
    # 生成唯一文件名
    file_id = str(uuid.uuid4())
    file_extension = Path(file.filename).suffix if file.filename else ""
    stored_filename = f"{file_id}{file_extension}"
    file_path = settings.MINERU_TEMP_STORAGE_DIR / stored_filename
    
    try:
        # 保存文件
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        log_info(f"File uploaded: {stored_filename}, size: {len(content)} bytes")
        
        # 返回文件信息
        # 注意：这里返回的是相对路径，实际使用时需要根据部署环境配置完整 URL
        # 例如：如果配置了静态文件服务，可以返回完整的 URL
        return ApiResponse.success(
            data={
                "file_id": file_id,
                "filename": stored_filename,
                "original_filename": file.filename,
                "size": len(content),
                "url": f"/api/v1/file-parser/files/{stored_filename}"  # 相对路径，需要配置静态文件服务
            },
            message="文件上传成功"
        )
    except Exception as e:
        log_error(f"Failed to upload file: {e}")
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")


@router.get("/files/{filename}")
async def get_uploaded_file(filename: str):
    """
    获取上传的文件（用于 MinerU API 访问）
    
    注意：MinerU API 需要可公开访问的 URL，所以这个端点需要配置为可公开访问
    或者将文件上传到云存储后返回云存储的 URL
    """
    file_path = settings.MINERU_TEMP_STORAGE_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream"
    )


@router.post("/parse", response_model=ApiResponse[dict])
async def parse_file_with_mineru(
    file_url: str,
    model_version: str = "vlm"
):
    """
    使用 MinerU API 解析文件
    
    Args:
        file_url: 文件的公开访问 URL
        model_version: 模型版本，默认为 "vlm"
    
    Returns:
        解析后的文本内容
    """
    mineru_client = get_mineru_client()
    if not mineru_client:
        raise HTTPException(
            status_code=503,
            detail="MinerU API 未配置，请在环境变量中设置 MINERU_API_TOKEN"
        )
    
    try:
        # 创建解析任务并等待结果
        text_content = mineru_client.extract_text_from_file(file_url, model_version)
        
        return ApiResponse.success(
            data={
                "content": text_content,
                "file_url": file_url
            },
            message="文件解析成功"
        )
    except Exception as e:
        log_error(f"Failed to parse file with MinerU: {e}")
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")


@router.post("/parse-upload", response_model=ApiResponse[dict])
async def upload_and_parse_file(
    file: UploadFile = File(...),
    model_version: str = "vlm"
):
    """
    上传文件并解析（一步完成）
    
    根据 FILE_PARSER_MODE 配置选择解析方式：
    - 'mineru': 使用 MinerU API 解析（需要公网可访问的文件 URL）
    - 'local': 使用本地 Python 库解析（无需网络）
    
    流程：
    1. 上传文件到临时存储
    2. 根据配置选择解析方式
    3. 返回解析结果
    """
    ensure_temp_storage()
    
    # 生成唯一文件名
    file_id = str(uuid.uuid4())
    file_extension = Path(file.filename).suffix if file.filename else ""
    stored_filename = f"{file_id}{file_extension}"
    file_path = settings.MINERU_TEMP_STORAGE_DIR / stored_filename
    
    # 获取文件扩展名（不含点）
    file_ext = file_extension.lstrip('.').lower() if file_extension else ""
    
    try:
        # 保存文件
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        log_info(f"File uploaded for parsing: {stored_filename}, size: {len(content)} bytes")
        log_info(f"Parser mode: {settings.FILE_PARSER_MODE}")
        
        # 根据配置选择解析方式
        if settings.FILE_PARSER_MODE == "local":
            # 使用本地 Python 库解析
            text_content = await parse_with_local_library(file_path, file_ext)
        else:
            # 使用 MinerU API 解析
            text_content = await parse_with_mineru_api(file_path, stored_filename, model_version)
        
        return ApiResponse.success(
            data={
                "content": text_content,
                "file_id": file_id,
                "filename": stored_filename,
                "original_filename": file.filename,
                "parser_mode": settings.FILE_PARSER_MODE
            },
            message="文件解析成功"
        )
    except Exception as e:
        log_error(f"Failed to upload and parse file: {e}")
        # 清理已上传的文件
        if file_path.exists():
            try:
                file_path.unlink()
            except:
                pass
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")


async def parse_with_local_library(file_path: Path, file_extension: str) -> str:
    """
    使用本地 Python 库解析文件
    
    Args:
        file_path: 文件路径
        file_extension: 文件扩展名（小写，不含点）
    
    Returns:
        Markdown 格式的文本内容
    """
    try:
        local_parser = get_local_file_parser()
        text_content = local_parser.parse_file(file_path, file_extension)
        log_info(f"File parsed successfully with local library: {file_path.name}")
        return text_content
    except ImportError as e:
        log_error(f"Missing required library: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"本地解析库未安装: {str(e)}。请安装必要的依赖：pip install pdfplumber python-docx python-pptx Pillow"
        )
    except Exception as e:
        log_error(f"Local parsing failed: {e}")
        raise Exception(f"本地解析失败: {str(e)}")


async def parse_with_mineru_api(file_path: Path, stored_filename: str, model_version: str) -> str:
    """
    使用 MinerU API 解析文件
    
    Args:
        file_path: 文件路径
        stored_filename: 存储的文件名
        model_version: MinerU 模型版本
    
    Returns:
        Markdown 格式的文本内容
    """
    mineru_client = get_mineru_client()
    if not mineru_client:
        raise HTTPException(
            status_code=503,
            detail="MinerU API 未配置，请在环境变量中设置 MINERU_API_TOKEN，或设置 FILE_PARSER_MODE=local 使用本地解析"
        )
    
    # 构建文件 URL
    if settings.MINERU_FILE_BASE_URL:
        base_url = settings.MINERU_FILE_BASE_URL.rstrip('/')
    else:
        base_url = os.getenv("NEXT_PUBLIC_API_URL", "http://localhost:9090")
    
    # 使用 API 端点而不是静态文件服务，避免 ngrok 免费版的浏览器验证问题
    file_url = f"{base_url}/api/v1/file-parser/files/{stored_filename}"
    
    log_info(f"File URL for MinerU: {file_url}")
    log_info(f"MinerU API URL: {mineru_client.base_url}")
    log_info(f"MinerU API Token configured: {bool(mineru_client.api_key)}")
    
    # 检查文件 URL 是否可被 MinerU 访问（localhost 无法被外部服务访问）
    if "localhost" in file_url or "127.0.0.1" in file_url:
        log_error("WARNING: File URL contains localhost. MinerU API may not be able to access it.")
        log_error("For local development, consider using ngrok or a public IP address.")
        log_error("You can set MINERU_FILE_BASE_URL in .env to use a public URL.")
        log_error("Alternatively, set FILE_PARSER_MODE=local to use local parsing.")
    
    # 调用 MinerU API 解析
    try:
        text_content = mineru_client.extract_text_from_file(file_url, model_version)
        return text_content
    except Exception as parse_error:
        log_error(f"MinerU parsing error details: {parse_error}")
        log_error(f"Error type: {type(parse_error).__name__}")
        raise Exception(f"MinerU API 解析失败: {str(parse_error)}")


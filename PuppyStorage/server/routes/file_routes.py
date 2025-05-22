"""
Storage Strategy Design Notes:

This module implements a dual-mode storage strategy based on the STORAGE_TYPE configuration:
- When STORAGE_TYPE=Remote: Uses S3 (Cloudflare R2) with presigned URLs
- When STORAGE_TYPE=Local: Uses local filesystem with direct server routes

Implementation Considerations:
1. Performance: Direct presigned URLs eliminate extra HTTP redirects
2. Architecture: Simpler server-side code without proxy/redirect logic
3. Native Design: Follows the intended S3/R2 usage pattern

Client Integration Notes:
- Clients must check URL types returned by /file/generate_urls endpoint
- When using S3 storage, clients should upload directly to the presigned URL
- When using local storage, clients should use the /storage/upload endpoint

API Structure:
1. /file routes: Handle metadata and URL generation
   - /file/generate_urls: Creates upload/download URLs for both storage types
   
2. /storage routes: Handle direct file operations
   - /storage/upload/{key}: Uploads file to local storage (not used with S3)
   - /storage/download/{key}: Downloads file from storage
   - /storage/delete/{key}: Deletes file from either storage type

File Path Convention:
- Files are identified using a "{user_id}/{content_id}/{content_name}" pattern
- content_id is auto-generated as a short random string
- This creates a hierarchical structure that supports multi-user environments

Client Workflow:
1. Call /file/generate_urls to get upload/download URLs and content_id
2. For S3: Use the presigned upload_url directly to upload the file
   For Local: Use the /storage/upload/{key} endpoint with the provided key
3. Store the download_url for future access
4. Use /storage/delete/{key} to remove files when needed

This design prioritizes performance and architectural simplicity over client API
consistency. Storage backends can be switched by changing the STORAGE_TYPE
environment variable, but client code must handle both workflows.
"""

import os
import sys
import uuid
import time
import logging
import random
import string
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse
from tools.puppy_utils import PuppyException, global_exception_handler
from tools.puppy_utils import log_info, log_error, log_warning
from tools.puppy_utils.config import config
from storage import S3StorageAdapter, LocalStorageAdapter
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, Literal

# 获取特定服务的日志器
from tools.puppy_utils.logger import get_logger
storage_logger = get_logger("puppystorage")
log_info = storage_logger.info
log_error = storage_logger.error

# Create router
file_router = APIRouter(prefix="/file", tags=["file"])
storage_router = APIRouter(prefix="/storage", tags=["storage"])

# 获取存储适配器
storage_adapter = S3StorageAdapter() if config.get("STORAGE_TYPE") == "Remote" else LocalStorageAdapter()

type_header_mapping = {
    "md": "text/markdown", 
    "markdown": "text/markdown", 
    "text": "text/plain",
    "html": "text/html",
    "css": "text/css",
    "js": "text/javascript",
    "json": "application/json",
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "svg": "image/svg+xml",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "pdf": "application/pdf",
    "zip": "application/zip",
    "application": "application/octet-stream",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    "xlsb": "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    "ods": "application/vnd.oasis.opendocument.spreadsheet"
}

def generate_short_id(length: int = 8) -> str:
    """生成指定长度的随机字符串作为短ID"""
    characters = string.ascii_lowercase + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

class FileUrlRequest(BaseModel):
    user_id: str = Field(default="public")
    content_name: str
    content_type: Optional[str] = Field(default=None)

    @validator('content_type')
    def validate_content_type(cls, v, values, **kwargs):
        # 检查是否缺少content_type
        if not v and 'content_type' not in kwargs.get('path_params', {}):
            raise ValueError("缺少必要参数: content_type")
        
        # 检查content_type是否有效
        if v and v not in type_header_mapping:
            raise ValueError(f"不支持的内容类型: {v}")
            
        return v

class FileUrlResponse(BaseModel):
    upload_url: str
    download_url: str
    content_id: str
    content_type_header: str
    expires_at: Dict[str, int]

class FileDeleteRequest(BaseModel):
    user_id: str
    content_id: str
    content_name: str

class FileDeleteResponse(BaseModel):
    message: str
    user_id: str
    content_id: str
    deleted_at: int

class FileUploadResponse(BaseModel):
    message: str
    key: str

def _get_path_key(user_id: str, content_id: str, content_name: str) -> str:
    return f"{user_id}/{content_id}/{content_name}"

@global_exception_handler(error_code=4001, error_message="Failed to generate file URLs")
@file_router.post("/generate_urls/{content_type}")
@file_router.get("/generate_urls")
async def generate_file_urls(request: Request, content_type: str = None):
    try:
        data = await request.json()
        file_request = FileUrlRequest(**data, path_params={'content_type': content_type})
        
        content_type_header = type_header_mapping.get(content_type, "application/octet-stream") if content_type else file_request.content_type or "application/octet-stream"
        
        content_id = generate_short_id()

        key = _get_path_key(
            file_request.user_id, 
            content_id, 
            file_request.content_name)
        
        upload_url = storage_adapter.generate_upload_url(key, content_type_header)
        download_url = storage_adapter.generate_download_url(key)
        
        log_info(f"Generated file URLs for user {file_request.user_id}: {key}")
        return FileUrlResponse(
            upload_url=upload_url,
            download_url=download_url,
            content_id=content_id,
            content_type_header=content_type_header,
            expires_at={
                "upload": int(time.time()) + 300,
                "download": int(time.time()) + 86400
            }
        )
    except Exception as e:
        log_error(f"Error generating file URLs: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4002, error_message="Failed to delete file")
@storage_router.delete("/delete/{key:path}")
async def delete_file(key: str):
    try:
        # 先检查路径格式
        parts = key.split('/')
        if len(parts) < 3:
            log_error(f"无效的文件路径格式: {key}")
            return JSONResponse(
                content={"error": "无效的文件路径格式"},
                status_code=400
            )
        
        # 再检查文件是否存在
        if not storage_adapter.check_file_exists(key):
            log_error(f"文件不存在: {key}")
            return JSONResponse(
                content={"error": f"文件 {os.path.basename(key)} 不存在"},
                status_code=404
            )
        
        try: 
            # 从路径中提取用户ID、内容ID和内容名称
            user_id = parts[0]
            content_id = parts[1]
            content_name = parts[2]
            
            storage_adapter.delete_file(key)
            log_info(f"已删除用户 {user_id} 的文件: {key}")
            return FileDeleteResponse(
                message=f"已成功删除文件: {content_name}",
                user_id=user_id,
                content_id=content_id,
                deleted_at=int(time.time())
            )
        except Exception as e:
            log_error(f"删除文件时发生错误: {str(e)}")
            return JSONResponse(
                content={"error": str(e)},
                status_code=500
            )
    except Exception as e:
        log_error(f"删除文件时发生错误: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4003, error_message="Failed to upload file")
@storage_router.put("/upload/{key:path}")
async def upload_file(
    request: Request,
    key: str,  # 从路径参数获取
    content_type: str = Query(...)
):
    try:
        file_data = await request.body()
        if storage_adapter.save_file(key, file_data, content_type):
            return FileUploadResponse(
                message="文件上传成功",
                key=key
            )
        else:
            return JSONResponse(
                content={"error": "文件上传失败"},
                status_code=500
            )
    except Exception as e:
        log_error(f"上传文件时发生错误: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

@global_exception_handler(error_code=4004, error_message="Failed to download file")
@storage_router.get("/download/{key:path}")
async def download_file(key: str):
    try:
        file_data, content_type = storage_adapter.get_file(key)
        if file_data is None:
            return JSONResponse(
                content={"error": "文件不存在"},
                status_code=404
            )
        
        return StreamingResponse(
            iter([file_data]),
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename={os.path.basename(key)}"
            }
        )
    except Exception as e:
        log_error(f"下载文件时发生错误: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

"""
Storage Strategy Design Notes:

This module implements a dual-mode storage strategy using the StorageManager:
- When storage type is Remote: Uses S3 (Cloudflare R2) with presigned URLs
- When storage type is Local: Uses local filesystem with direct server routes

Implementation Considerations:
1. Performance: Direct presigned URLs eliminate extra HTTP redirects
2. Architecture: Simpler server-side code without proxy/redirect logic
3. Native Design: Follows the intended S3/R2 usage pattern
4. Unified Management: Uses StorageManager for consistent storage type selection

Client Integration Notes:
- Clients must check URL types returned by /file/generate_urls endpoint
- When using S3 storage, clients should upload directly to the presigned URL
- When using local storage, clients should use the /storage/upload endpoint

API Structure:
1. /file routes: Handle metadata and URL generation
   - /file/generate_urls: Creates upload/download/delete URLs for both storage types
   
2. /storage routes: Handle direct file operations
   - /storage/upload/{key}: Uploads file to local storage (not used with S3)
   - /storage/download/{key}: Downloads file from storage
   - /storage/delete/{key}: Deletes file from either storage type

File Path Convention:
- Files are identified using a "{user_id}/{content_id}/{content_name}" pattern
- content_id is auto-generated as a short random string
- This creates a hierarchical structure that supports multi-user environments

Client Workflow:
1. Call /file/generate_urls to get upload/download/delete URLs and content_id
2. For S3: Use the presigned upload_url directly to upload the file
   For Local: Use the /storage/upload/{key} endpoint with the provided key
3. Store the download_url for future access
4. For deletion:
   - S3: Use the presigned delete_url directly to delete the file
   - Local: Use the delete_url which points to /storage/delete/{key} endpoint
5. Use /storage/delete/{key} as an alternative server-side deletion method

Storage Management:
- Storage type is automatically selected by the StorageManager based on DEPLOYMENT_TYPE
- The StorageManager handles configuration priority and fallback logic
- Client code remains the same regardless of the storage backend
- Storage type can be queried via get_storage_info() from the storage module

URL Generation:
- upload_url: Direct presigned URL for S3, server endpoint for local storage
- download_url: Direct presigned URL for S3, server endpoint for local storage  
- delete_url: Direct presigned URL for S3, server endpoint for local storage
- All URLs have appropriate expiration times (upload/delete: 5min, download: 24h)

This design prioritizes performance and architectural simplicity while providing
unified storage management. The StorageManager abstracts away configuration
complexity, ensuring consistent behavior across all components.
"""

import os
import sys
import uuid
import time
import logging
import random
import string
from urllib.parse import quote  # 添加URL编码支持
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse, StreamingResponse
from utils.puppy_exception import PuppyException, global_exception_handler
from utils.logger import log_info, log_error
from utils.config import config
from utils.file_utils import build_content_disposition_header, extract_filename_from_key, validate_filename
from storage import get_storage
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, Literal

# Create management router (for file metadata and management operations)
management_router = APIRouter(prefix="/files", tags=["files"])

# 获取存储适配器 - 使用统一的存储管理器
storage_adapter = get_storage()

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
    "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "csv": "text/csv",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

def generate_short_id(length: int = 8) -> str:
    """生成指定长度的随机字符串作为短ID"""
    characters = string.ascii_lowercase + string.digits
    return ''.join(random.choice(characters) for _ in range(length))

class FileUrlRequest(BaseModel):
    user_id: str = Field(default="public")
    content_name: str
    content_type: Optional[str] = Field(default=None)

class FileUrlResponse(BaseModel):
    upload_url: str
    download_url: str
    delete_url: str
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
@management_router.post("/generate_urls/{content_type}")
@management_router.get("/generate_urls")
async def generate_file_urls(request: Request, content_type: str = None):
    try:
        data = await request.json()
        file_request = FileUrlRequest(**data, path_params={'content_type': content_type})
        
        # 严格验证内容类型
        final_content_type = content_type or file_request.content_type
        
        if not final_content_type:
            log_error("缺少必要参数: content_type")
            return JSONResponse(
                content={"error": "缺少必要参数: content_type"},
                status_code=400
            )
        
        if final_content_type not in type_header_mapping:
            log_error(f"不支持的内容类型: {final_content_type}")
            return JSONResponse(
                content={
                    "error": f"不支持的内容类型: {final_content_type}",
                    "supported_types": list(type_header_mapping.keys()),
                    "hint": "请使用支持的内容类型之一"
                },
                status_code=400
            )
        
        content_type_header = type_header_mapping[final_content_type]
        
        content_id = generate_short_id()

        key = _get_path_key(
            file_request.user_id, 
            content_id, 
            file_request.content_name)
        
        upload_url = storage_adapter.generate_upload_url(key, content_type_header)
        download_url = storage_adapter.generate_download_url(key)
        delete_url = storage_adapter.generate_delete_url(key)
        
        log_info(f"Generated file URLs for user {file_request.user_id}: {key}")
        return FileUrlResponse(
            upload_url=upload_url,
            download_url=download_url,
            delete_url=delete_url,
            content_id=content_id,
            content_type_header=content_type_header,
            expires_at={
                "upload": int(time.time()) + 300,
                "download": int(time.time()) + 86400,
                "delete": int(time.time()) + 300
            }
        )
    except Exception as e:
        log_error(f"Error generating file URLs: {str(e)}")
        return JSONResponse(content={"error": str(e)}, status_code=500)


@global_exception_handler(error_code=4006, error_message="Missing file key parameter")
@management_router.delete("/delete")
async def delete_file_without_key():
    """处理不带key参数的删除请求 - 提供明确的错误信息"""
    log_error("删除文件请求缺少必要的key参数")
    return JSONResponse(
        content={
            "error": "缺少必要的文件路径参数",
            "message": "请使用正确的格式：/storage/delete/{user_id}/{content_id}/{content_name}",
            "example": "/storage/delete/public/abc123/document.pdf",
            "hint": "如果您从前端调用此API，请确保URL包含完整的文件路径"
        },
        status_code=400
    )

@global_exception_handler(error_code=4002, error_message="Failed to delete file")
@management_router.delete("/delete/{key:path}")
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
            log_info(f"Deleted file for user {user_id}: {key}")
            return FileDeleteResponse(
                message=f"File deleted successfully: {content_name}",
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



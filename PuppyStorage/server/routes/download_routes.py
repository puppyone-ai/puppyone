"""
Download Coordinator API routes for PuppyStorage
提供文件下载协调的API接口，实现"地址分发器"模式
"""

import os
import mimetypes
import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from utils.logger import log_info, log_error, log_debug
from storage import get_storage
from storage.local import LocalStorageAdapter
# 导入认证模块
from server.auth import verify_user_and_resource_access, User, get_auth_provider

download_router = APIRouter(prefix="/download", tags=["download"])

# 获取存储适配器
storage_adapter = get_storage()

# === Request and Response Models ===

class DownloadUrlResponse(BaseModel):
    download_url: str = Field(..., description="下载URL")
    key: str = Field(..., description="文件路径标识符")
    expires_at: int = Field(..., description="URL过期时间戳")
    message: str = Field(default="下载URL生成成功")

# === Helper Functions ===

def validate_key_format(key: str) -> bool:
    """验证key格式是否正确"""
    # 验证格式：user_id/content_id/content_name
    parts = key.split('/')
    return len(parts) >= 3 and all(part.strip() for part in parts)

async def verify_download_auth(
    key: str = Query(..., description="文件的完整路径标识符"),
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
) -> User:
    """验证下载的认证和权限"""
    return await verify_user_and_resource_access(
        resource_key=key,
        authorization=authorization,
        auth_provider=auth_provider
    )

# === API Endpoints ===

@download_router.get("/url", response_model=DownloadUrlResponse)
async def get_download_url(
    key: str = Query(..., description="文件的完整路径标识符"),
    expires_in: int = Query(3600, description="URL有效期（秒）", ge=60, le=86400),
    current_user: User = Depends(verify_download_auth)
):
    """
    获取文件的下载URL
    
    根据存储后端类型返回不同的URL：
    - 对于S3/MinIO后端：返回一个有时效的预签名URL
    - 对于本地存储后端：返回一个指向 /download/stream/{key} 的本地URL
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    try:
        log_info(f"用户 {current_user.user_id} 请求下载文件: {key}")
        
        # 验证key格式
        if not validate_key_format(key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key format. Expected: user_id/content_id/content_name"
            )
        
        # 检查存储适配器是否支持生成下载URL
        if not hasattr(storage_adapter, 'get_download_url'):
            raise HTTPException(
                status_code=501, 
                detail="当前存储后端不支持生成下载URL"
            )
        
        # 调用存储适配器生成下载URL
        result = storage_adapter.get_download_url(key=key, expires_in=expires_in)
        
        log_info(f"为用户 {current_user.user_id} 生成下载URL成功: {key}")
        
        return DownloadUrlResponse(
            download_url=result["download_url"],
            key=result["key"],
            expires_at=result["expires_at"],
            message="下载URL生成成功"
        )
        
    except HTTPException:
        raise
    except FileNotFoundError:
        log_error(f"文件未找到: {key}")
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        log_error(f"生成下载URL失败: {str(e)}")
        raise HTTPException(status_code=500, detail="Could not generate download URL")


@download_router.get("/stream/{key:path}")
async def stream_local_file(
    key: str,
    request: Request
):
    """
    (仅限本地开发) 从本地文件系统流式传输文件
    
    支持 HTTP Range 请求，用于实现分段下载和流式传输。
    此端点不需要额外认证，因为URL的获取已经通过了认证。
    """
    # 检查是否为本地存储适配器
    if not isinstance(storage_adapter, LocalStorageAdapter):
        raise HTTPException(
            status_code=404, 
            detail="此端点仅适用于本地存储环境"
        )
    
    try:
        log_info(f"开始流式传输本地文件: {key}")
        
        # 验证key格式
        if not validate_key_format(key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key format. Expected: user_id/content_id/content_name"
            )
        
        # 获取Range请求头
        range_header = request.headers.get('Range')
        
        # 检查存储适配器是否支持流式传输
        if not hasattr(storage_adapter, 'stream_from_disk'):
            raise HTTPException(
                status_code=501,
                detail="当前存储适配器不支持流式传输"
            )
        
        # 调用适配器的流式传输方法
        file_iterator, status_code, content_range, file_size = await storage_adapter.stream_from_disk(key, range_header)
        
        # 推断文件的MIME类型
        content_type, _ = mimetypes.guess_type(key)
        if content_type is None:
            content_type = "application/octet-stream"
        
        # 创建流式响应
        response = StreamingResponse(
            file_iterator, 
            status_code=status_code,
            media_type=content_type
        )
        
        # 设置响应头
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Content-Disposition"] = f'attachment; filename="{os.path.basename(key)}"'
        
        if content_range:
            response.headers["Content-Range"] = content_range
        if file_size is not None:
            response.headers["Content-Length"] = str(file_size if status_code == 200 else len(content_range.split('/')[-1]) if content_range else file_size)
        
        log_info(f"本地文件流式传输成功: key='{key}', range='{range_header or 'full_file'}', status_code={status_code}")
        
        return response
        
    except HTTPException:
        raise
    except FileNotFoundError:
        log_error(f"本地文件不存在: {key}")
        raise HTTPException(status_code=404, detail="File not found")
    except PermissionError as e:
        log_error(f"路径遍历攻击尝试被阻止: key={key}")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"流式传输失败: {str(e)}")
        raise HTTPException(status_code=500, detail="Stream transmission failed")
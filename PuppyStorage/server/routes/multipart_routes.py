"""
Multipart Upload Coordinator API routes for PuppyStorage
提供S3分块上传协调的API接口，实现"地址分发器"模式
"""

import os
import sys
import time
import uuid
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
# 移除PuppyException，使用FastAPI原生异常处理
from utils.logger import log_info, log_error, log_debug
from storage import get_storage
# 导入认证模块
from server.auth import verify_user_and_resource_access, User, get_auth_provider
from fastapi import Header

# Create multipart router
multipart_router = APIRouter(prefix="/multipart", tags=["multipart"])

# 获取存储适配器
storage_adapter = get_storage()

# === Request and Response Models ===

class MultipartInitRequest(BaseModel):
    key: str = Field(..., description="文件的完整路径标识符", min_length=1)
    content_type: Optional[str] = Field(None, description="可选的内容类型")
    
    @validator('key')
    def validate_key_format(cls, v):
        """验证key格式：user_id/content_id/content_name"""
        if not v or not isinstance(v, str):
            raise ValueError('Key must be a non-empty string')
        parts = v.split('/')
        if len(parts) < 3:
            raise ValueError('Key must follow format: user_id/content_id/content_name')
        if any(not part.strip() for part in parts):
            raise ValueError('Key parts cannot be empty')
        return v

class MultipartInitResponse(BaseModel):
    upload_id: str = Field(..., description="上传会话ID")
    key: str = Field(..., description="文件路径标识符")
    expires_at: int = Field(..., description="会话过期时间戳")
    max_parts: int = Field(..., description="最大分块数量")
    min_part_size: int = Field(..., description="最小分块大小（字节）")
    message: str = Field(default="分块上传初始化成功")

class MultipartUrlRequest(BaseModel):
    key: str = Field(..., description="文件的完整路径标识符")
    upload_id: str = Field(..., description="上传会话ID")
    part_number: int = Field(..., description="分块序号（从1开始）", ge=1, le=10000)
    expires_in: Optional[int] = Field(300, description="URL有效期（秒）", ge=60, le=3600)

class MultipartUrlResponse(BaseModel):
    upload_url: str = Field(..., description="分块上传的预签名URL")
    part_number: int = Field(..., description="分块序号")
    expires_at: int = Field(..., description="URL过期时间戳")
    message: str = Field(default="分块上传URL生成成功")

class MultipartPart(BaseModel):
    ETag: str = Field(..., description="分块的ETag")
    PartNumber: int = Field(..., description="分块序号", ge=1, le=10000)

class MultipartCompleteRequest(BaseModel):
    key: str = Field(..., description="文件的完整路径标识符")
    upload_id: str = Field(..., description="上传会话ID")
    parts: List[MultipartPart] = Field(..., description="已上传的分块列表", min_items=1)
    
    @validator('parts')
    def validate_parts_unique(cls, v):
        """验证分块序号唯一性"""
        part_numbers = [part.PartNumber for part in v]
        if len(part_numbers) != len(set(part_numbers)):
            raise ValueError('Part numbers must be unique')
        return v

class MultipartCompleteResponse(BaseModel):
    success: bool = Field(..., description="操作是否成功")
    key: str = Field(..., description="文件路径标识符")
    size: int = Field(..., description="文件总大小")
    etag: str = Field(..., description="文件的ETag")
    message: str = Field(default="分块上传完成")

class MultipartAbortRequest(BaseModel):
    key: str = Field(..., description="文件的完整路径标识符")
    upload_id: str = Field(..., description="上传会话ID")

class MultipartAbortResponse(BaseModel):
    success: bool = Field(..., description="操作是否成功")
    upload_id: str = Field(..., description="已中止的上传会话ID")
    message: str = Field(default="分块上传已中止")

class MultipartListResponse(BaseModel):
    uploads: List[Dict[str, Any]] = Field(..., description="进行中的上传列表")
    count: int = Field(..., description="上传数量")
    message: str = Field(default="查询成功")

# === Helper Functions ===

def generate_request_id() -> str:
    """生成用于追踪的请求ID"""
    return f"req_{uuid.uuid4().hex[:12]}"

def validate_key_format(key: str) -> bool:
    """验证key格式是否正确"""
    # 验证格式：user_id/content_id/content_name
    parts = key.split('/')
    return len(parts) >= 3 and all(part.strip() for part in parts)

# === API Endpoints ===

async def verify_init_auth(
    request_data: MultipartInitRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
) -> User:
    """验证初始化上传的认证和权限"""
    return await verify_user_and_resource_access(
        resource_key=request_data.key,
        authorization=authorization,
        auth_provider=auth_provider
    )


@multipart_router.post("/init", response_model=MultipartInitResponse)
async def init_multipart_upload(
    request_data: MultipartInitRequest,
    current_user: User = Depends(verify_init_auth)
):
    """
    初始化分块上传
    
    为指定的key创建一个新的分块上传会话。
    返回upload_id和上传参数，客户端后续使用upload_id获取分块上传URL。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        log_info(f"[{request_id}] 初始化分块上传: user={current_user.user_id}, key={request_data.key}, content_type={request_data.content_type}")
        
        # 验证key格式（认证和权限已由依赖验证完成）
        if not validate_key_format(request_data.key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key format. Expected: user_id/content_id/content_name"
            )
        
        # 调用存储适配器初始化分块上传
        result = storage_adapter.init_multipart_upload(
            key=request_data.key,
            content_type=request_data.content_type
        )
        
        log_info(f"[{request_id}] 分块上传初始化成功: upload_id={result['upload_id']}")
        
        return MultipartInitResponse(
            upload_id=result["upload_id"],
            key=result["key"],
            expires_at=result["expires_at"],
            max_parts=result["max_parts"],
            min_part_size=result["min_part_size"],
            message="分块上传初始化成功"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] 初始化分块上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def verify_url_auth(
    request_data: MultipartUrlRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
) -> User:
    """验证获取上传URL的认证和权限"""
    return await verify_user_and_resource_access(
        resource_key=request_data.key,
        authorization=authorization,
        auth_provider=auth_provider
    )


@multipart_router.post("/get_upload_url", response_model=MultipartUrlResponse)
async def get_multipart_upload_url(
    request_data: MultipartUrlRequest,
    current_user: User = Depends(verify_url_auth)
):
    """
    获取分块上传URL
    
    为指定的upload_id和part_number生成一个预签名的上传URL。
    客户端使用这个URL直接向存储服务上传分块数据。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        log_debug(f"[{request_id}] 获取分块上传URL: user={current_user.user_id}, upload_id={request_data.upload_id}, part_number={request_data.part_number}")
        
        # 验证key格式（认证和权限已由依赖验证完成）
        if not validate_key_format(request_data.key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key format. Expected: user_id/content_id/content_name"
            )
        
        # 调用存储适配器获取上传URL
        result = storage_adapter.get_multipart_upload_url(
            key=request_data.key,
            upload_id=request_data.upload_id,
            part_number=request_data.part_number,
            expires_in=request_data.expires_in
        )
        
        log_debug(f"[{request_id}] 分块上传URL生成成功: part_number={result['part_number']}")
        
        return MultipartUrlResponse(
            upload_url=result["upload_url"],
            part_number=result["part_number"],
            expires_at=result["expires_at"],
            message="分块上传URL生成成功"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] 获取分块上传URL失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def verify_complete_auth(
    request_data: MultipartCompleteRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
) -> User:
    """验证完成上传的认证和权限"""
    return await verify_user_and_resource_access(
        resource_key=request_data.key,
        authorization=authorization,
        auth_provider=auth_provider
    )


@multipart_router.post("/complete", response_model=MultipartCompleteResponse)
async def complete_multipart_upload(
    request_data: MultipartCompleteRequest,
    current_user: User = Depends(verify_complete_auth)
):
    """
    完成分块上传
    
    将所有已上传的分块合并为最终文件。
    客户端必须提供所有分块的ETag和PartNumber信息。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        log_info(f"[{request_id}] 完成分块上传: user={current_user.user_id}, upload_id={request_data.upload_id}, parts_count={len(request_data.parts)}")
        
        # 验证key格式（认证和权限已由依赖验证完成）
        if not validate_key_format(request_data.key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key format. Expected: user_id/content_id/content_name"
            )
        
        # 转换parts格式
        parts_list = [
            {"ETag": part.ETag, "PartNumber": part.PartNumber}
            for part in request_data.parts
        ]
        
        # 调用存储适配器完成上传
        result = storage_adapter.complete_multipart_upload(
            key=request_data.key,
            upload_id=request_data.upload_id,
            parts=parts_list
        )
        
        log_info(f"[{request_id}] 分块上传完成: key={result['key']}, size={result['size']}")
        
        return MultipartCompleteResponse(
            success=result["success"],
            key=result["key"],
            size=result["size"],
            etag=result["etag"],
            message="分块上传完成"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] 完成分块上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def verify_abort_auth(
    request_data: MultipartAbortRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
) -> User:
    """验证中止上传的认证和权限"""
    return await verify_user_and_resource_access(
        resource_key=request_data.key,
        authorization=authorization,
        auth_provider=auth_provider
    )


@multipart_router.post("/abort", response_model=MultipartAbortResponse)
async def abort_multipart_upload(
    request_data: MultipartAbortRequest,
    current_user: User = Depends(verify_abort_auth)
):
    """
    中止分块上传
    
    取消指定的分块上传会话，清理所有相关资源。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        log_info(f"[{request_id}] 中止分块上传: user={current_user.user_id}, upload_id={request_data.upload_id}")
        
        # 验证key格式（认证和权限已由依赖验证完成）
        if not validate_key_format(request_data.key):
            raise HTTPException(
                status_code=400,
                detail="Invalid key format. Expected: user_id/content_id/content_name"
            )
        
        # 调用存储适配器中止上传
        result = storage_adapter.abort_multipart_upload(
            key=request_data.key,
            upload_id=request_data.upload_id
        )
        
        log_info(f"[{request_id}] 分块上传中止成功: upload_id={result['upload_id']}")
        
        return MultipartAbortResponse(
            success=result["success"],
            upload_id=result["upload_id"],
            message="分块上传已中止"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] 中止分块上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@multipart_router.get("/list", response_model=MultipartListResponse)
async def list_multipart_uploads(prefix: Optional[str] = None):
    """
    列出进行中的分块上传
    
    返回所有进行中的分块上传会话列表。
    可选的prefix参数用于过滤特定前缀的上传。
    """
    request_id = generate_request_id()
    
    try:
        log_info(f"[{request_id}] 列出分块上传: prefix={prefix}")
        
        # 调用存储适配器列出上传
        uploads = storage_adapter.list_multipart_uploads(prefix=prefix)
        
        log_info(f"[{request_id}] 分块上传列表查询成功: 找到{len(uploads)}个上传")
        
        return MultipartListResponse(
            uploads=uploads,
            count=len(uploads),
            message="查询成功"
        )
        
    except Exception as e:
        log_error(f"[{request_id}] 列出分块上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# === Special endpoint for local storage chunk upload ===

@multipart_router.put("/upload/{upload_id}/{part_number}")
async def upload_chunk_to_local(upload_id: str, part_number: int, request: Request):
    """
    本地存储分块上传端点
    
    这个端点专门用于本地存储的分块上传。
    当存储适配器是LocalStorageAdapter时，生成的upload_url会指向这个端点。
    """
    request_id = generate_request_id()
    
    try:
        # 验证参数
        if part_number < 1 or part_number > 10000:
            raise HTTPException(
                status_code=400,
                detail="Part number must be between 1 and 10000"
            )
        
        # 读取请求体数据
        chunk_data = await request.body()
        if not chunk_data:
            raise HTTPException(
                status_code=400,
                detail="No data provided in request body"
            )
        
        log_debug(f"[{request_id}] 本地存储分块上传: upload_id={upload_id}, part_number={part_number}, size={len(chunk_data)}")
        
        # 检查存储适配器类型
        if not hasattr(storage_adapter, 'save_multipart_chunk'):
            raise HTTPException(
                status_code=400,
                detail="This endpoint is only available for local storage"
            )
        
        # 调用本地存储适配器保存分块
        result = storage_adapter.save_multipart_chunk(
            upload_id=upload_id,
            part_number=part_number,
            chunk_data=chunk_data
        )
        
        log_debug(f"[{request_id}] 本地存储分块上传成功: part_number={part_number}, etag={result['etag']}")
        
        # 返回ETag等信息（模拟S3的响应格式）
        return JSONResponse(
            content={
                "success": True,
                "part_number": result["part_number"],
                "etag": result["etag"],
                "size": result["size"]
            },
            headers={
                "ETag": result["etag"]
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] 本地存储分块上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# === Health check ===

@multipart_router.get("/health")
async def multipart_health():
    """分块上传服务健康检查"""
    try:
        # 简单检查存储适配器是否正常
        uploads = storage_adapter.list_multipart_uploads()
        
        return JSONResponse(
            content={
                "status": "healthy",
                "service": "multipart",
                "active_uploads": len(uploads),
                "timestamp": int(time.time())
            }
        )
    except Exception as e:
        log_error(f"分块上传服务健康检查失败: {str(e)}")
        return JSONResponse(
            content={
                "status": "unhealthy",
                "error": str(e),
                "timestamp": int(time.time())
            },
            status_code=500
        ) 
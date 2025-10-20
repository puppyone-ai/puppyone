"""
Multipart Upload Coordinator API routes for PuppyStorage
提供S3分块上传协调的API接口，实现"地址分发器"模式
"""

import os
import sys
import time
import uuid
import json
import re
from datetime import datetime
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
# 移除PuppyException，使用FastAPI原生异常处理
from utils.logger import log_info, log_error, log_debug
from storage import get_storage_adapter
from storage.base import StorageAdapter
# 导入认证模块
from server.auth import verify_user_and_resource_access, User, get_auth_provider
from fastapi import Header

# Create upload router
upload_router = APIRouter(prefix="/upload", tags=["upload"])

# === Request and Response Models ===

class MultipartInitRequest(BaseModel):
    block_id: str = Field(..., description="业务数据块ID", min_length=1)
    file_name: str = Field(..., description="原始文件名，用于展示和后续处理", min_length=1)
    content_type: str = Field("application/octet-stream", description="文件的MIME类型")
    file_size: Optional[int] = Field(None, description="可选，文件总大小（字节），用于校验", ge=0)
    
    @validator('block_id')
    def validate_block_id(cls, v):
        """验证block_id格式，确保不包含路径分隔符等特殊字符"""
        if not v or not isinstance(v, str):
            raise ValueError('block_id must be a non-empty string')
        # 禁止的字符：路径分隔符、控制字符等
        if re.search(r'[/\\<>:|?*\x00-\x1f]', v):
            raise ValueError('block_id contains invalid characters')
        # 限制长度
        if len(v) > 255:
            raise ValueError('block_id is too long (max 255 characters)')
        return v
    
    @validator('file_name')
    def validate_file_name(cls, v):
        """验证文件名，确保基本的安全性"""
        if not v or not isinstance(v, str):
            raise ValueError('file_name must be a non-empty string')
        # 禁止路径遍历
        if '..' in v or v.startswith('/') or v.startswith('\\'):
            raise ValueError('file_name contains invalid path traversal patterns')
        # 限制长度
        if len(v) > 255:
            raise ValueError('file_name is too long (max 255 characters)')
        return v

class MultipartInitResponse(BaseModel):
    upload_id: str = Field(..., description="上传会话ID")
    key: str = Field(..., description="文件路径标识符")
    version_id: str = Field(..., description="生成的版本ID")
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

class ManifestUpdateRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    block_id: str = Field(..., description="数据块ID")
    version_id: str = Field(..., description="版本ID")
    expected_etag: Optional[str] = Field(None, description="期望的ETag值，用于乐观锁")
    new_chunk: Dict[str, Any] = Field(..., description="新增的数据块信息")
    status: Optional[str] = Field(None, description="可选的状态更新")

class ManifestUpdateResponse(BaseModel):
    success: bool = Field(..., description="操作是否成功")
    etag: str = Field(..., description="更新后的ETag")
    message: str = Field(default="清单更新成功")

class ManifestRemoveChunkRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    block_id: str = Field(..., description="数据块ID")
    version_id: str = Field(..., description="版本ID")
    expected_etag: Optional[str] = Field(None, description="期望的ETag值，用于乐观锁")
    chunk_to_remove: Dict[str, Any] = Field(..., description="要删除的数据块信息")

class ManifestRemoveChunkResponse(BaseModel):
    success: bool = Field(..., description="操作是否成功")
    etag: str = Field(..., description="更新后的ETag")
    message: str = Field(default="Chunk删除成功")

class DirectChunkUploadRequest(BaseModel):
    block_id: str = Field(..., description="业务数据块ID")
    file_name: str = Field(..., description="原始文件名")
    content_type: str = Field(default="application/octet-stream", description="内容类型")

class DirectChunkUploadResponse(BaseModel):
    success: bool = Field(..., description="上传是否成功")
    key: str = Field(..., description="文件存储键")
    version_id: str = Field(..., description="生成的版本ID")
    etag: str = Field(..., description="文件ETag")
    size: int = Field(..., description="文件大小（字节）")
    uploaded_at: int = Field(..., description="上传时间戳")

# === Helper Functions ===

def generate_request_id() -> str:
    """生成用于追踪的请求ID"""
    return f"req_{uuid.uuid4().hex[:12]}"

def generate_version_id() -> str:
    """生成可排序的版本ID
    格式: YYYYMMDD-HHMMSSFFFFF-XXXXXXXX
    其中XXXXXXXX是8位随机字符，确保在同一微秒内的唯一性
    """
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S%f')
    random_suffix = uuid.uuid4().hex[:8]
    return f"{timestamp}-{random_suffix}"

def sanitize_file_name(file_name: str) -> str:
    """清理文件名，确保存储安全
    - 移除或替换危险字符
    - 保留文件扩展名
    - 确保结果是有效的文件名
    """
    # 提取文件名和扩展名
    base_name, ext = os.path.splitext(file_name)
    
    # 替换危险字符为下划线
    # 保留字母、数字、点、破折号、下划线
    safe_base = re.sub(r'[^a-zA-Z0-9._-]', '_', base_name)
    
    # 移除连续的下划线
    safe_base = re.sub(r'_+', '_', safe_base)
    
    # 确保不以点开头（避免隐藏文件）
    if safe_base.startswith('.'):
        safe_base = '_' + safe_base[1:]
    
    # 如果清理后为空，使用默认名称
    if not safe_base:
        safe_base = 'file'
    
    # 重新组合文件名和扩展名
    # 扩展名也需要清理
    if ext:
        safe_ext = re.sub(r'[^a-zA-Z0-9]', '', ext)
        if safe_ext:
            return f"{safe_base}.{safe_ext}"
    
    return safe_base

def validate_key_format(key: str) -> bool:
    """验证key格式是否正确"""
    # 验证格式：user_id/block_id/version_id/file_name
    parts = key.split('/')
    return len(parts) >= 4 and all(part.strip() for part in parts)

# === API Endpoints ===

async def verify_init_auth(
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
) -> User:
    """验证初始化上传的用户认证
    
    在init阶段，我们只验证用户身份的合法性。
    资源的所有权将通过在后端使用其user_id构建key来确立。
    """
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization header is missing")
        
        # 从token中解析用户信息
        user = await auth_provider.verify_user_token(authorization)
        
        if not user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
            
        return user
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"Token verification failed during init: {e}")
        raise HTTPException(status_code=401, detail="Token verification failed")


@upload_router.post("/init", response_model=MultipartInitResponse)
async def init_multipart_upload(
    request_data: MultipartInitRequest,
    storage: StorageAdapter = Depends(get_storage_adapter),
    current_user: User = Depends(verify_init_auth)
):
    """
    初始化分块上传
    
    为指定的block_id创建一个新的分块上传会话。
    服务器端会生成唯一的version_id和安全的存储路径。
    返回upload_id和生成的key，客户端后续使用这些信息进行分块上传。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        # 1. 生成版本ID
        version_id = generate_version_id()
        
        # 2. 清理文件名，确保安全
        safe_file_name = sanitize_file_name(request_data.file_name)
        
        # 3. 在服务器端组装完整的key
        # 格式: user_id/block_id/version_id/file_name
        key = f"{current_user.user_id}/{request_data.block_id}/{version_id}/{safe_file_name}"
        
        log_info(f"[{request_id}] 初始化分块上传: user={current_user.user_id}, block_id={request_data.block_id}, "
                f"version_id={version_id}, file_name={request_data.file_name} -> {safe_file_name}, "
                f"generated_key={key}")
        
        # 4. 调用存储适配器初始化分块上传
        result = storage.init_multipart_upload(
            key=key,
            content_type=request_data.content_type
        )
        
        # 5. 如果提供了文件大小，可以记录用于后续校验
        if request_data.file_size is not None:
            log_debug(f"[{request_id}] 预期文件大小: {request_data.file_size} bytes")
        
        log_info(f"[{request_id}] 分块上传初始化成功: upload_id={result['upload_id']}")
        
        return MultipartInitResponse(
            upload_id=result["upload_id"],
            key=key,
            version_id=version_id,
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


@upload_router.post("/get_upload_url", response_model=MultipartUrlResponse)
async def get_multipart_upload_url(
    request_data: MultipartUrlRequest,
    storage: StorageAdapter = Depends(get_storage_adapter),
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
        result = storage.get_multipart_upload_url(
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


@upload_router.post("/complete", response_model=MultipartCompleteResponse)
async def complete_multipart_upload(
    request_data: MultipartCompleteRequest,
    storage: StorageAdapter = Depends(get_storage_adapter),
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
        result = storage.complete_multipart_upload(
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


@upload_router.post("/abort", response_model=MultipartAbortResponse)
async def abort_multipart_upload(
    request_data: MultipartAbortRequest,
    storage: StorageAdapter = Depends(get_storage_adapter),
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
        result = storage.abort_multipart_upload(
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


@upload_router.get("/list", response_model=MultipartListResponse)
async def list_multipart_uploads(
    prefix: Optional[str] = None,
    storage: StorageAdapter = Depends(get_storage_adapter)
):
    """
    列出进行中的分块上传
    
    返回所有进行中的分块上传会话列表。
    可选的prefix参数用于过滤特定前缀的上传。
    """
    request_id = generate_request_id()
    
    try:
        log_info(f"[{request_id}] 列出分块上传: prefix={prefix}")
        
        # 调用存储适配器列出上传
        uploads = storage.list_multipart_uploads(prefix=prefix)
        
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

@upload_router.put("/chunk/{upload_id}/{part_number}")
async def upload_chunk_to_local(
    upload_id: str, 
    part_number: int, 
    request: Request,
    storage: StorageAdapter = Depends(get_storage_adapter)
):
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
        if not hasattr(storage, 'save_multipart_chunk'):
            raise HTTPException(
                status_code=400,
                detail="This endpoint is only available for local storage"
            )
        
        # 调用本地存储适配器保存分块
        result = storage.save_multipart_chunk(
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


# === Manifest Management Endpoint ===

@upload_router.put("/manifest", response_model=ManifestUpdateResponse)
async def update_manifest(
    request_data: ManifestUpdateRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
):
    """
    创建或增量更新manifest文件
    
    这个端点支持流式更新manifest.json文件，允许生产者在数据块创建时
    实时更新清单，消费者可以通过轮询该文件来获取最新的数据块列表。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        # 构建manifest文件的key
        manifest_key = f"{request_data.user_id}/{request_data.block_id}/{request_data.version_id}/manifest.json"
        
        # 验证用户权限
        current_user = await verify_user_and_resource_access(
            resource_key=manifest_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
        
        log_info(f"[{request_id}] 更新manifest: user={current_user.user_id}, manifest_key={manifest_key}")
        
        # 尝试读取现有的manifest
        try:
            current_content, content_type, current_etag = storage.get_file_with_metadata(manifest_key)
            current_manifest = json.loads(current_content.decode('utf-8'))
            log_debug(f"[{request_id}] 读取现有manifest: etag={current_etag}")
        except Exception:
            # 文件不存在，创建新的manifest
            current_manifest = {
                "version": "1.0",
                "block_id": request_data.block_id,
                "version_id": request_data.version_id,
                "created_at": datetime.utcnow().isoformat(),
                "status": "generating",
                "chunks": []
            }
            current_etag = None
            log_debug(f"[{request_id}] 创建新manifest")
        
        # 检查乐观锁
        if request_data.expected_etag is not None and current_etag != request_data.expected_etag:
            log_error(f"[{request_id}] ETag不匹配: expected={request_data.expected_etag}, current={current_etag}")
            raise HTTPException(
                status_code=409,
                detail=f"ETag mismatch. Expected: {request_data.expected_etag}, Current: {current_etag}"
            )
        
        # 更新manifest
        current_manifest["updated_at"] = datetime.utcnow().isoformat()
        
        # 检查是否已存在相同文件的chunk，如果存在则替换，否则添加
        new_chunk = request_data.new_chunk
        new_chunk_name = new_chunk.get("name", "")
        new_chunk_file_name = new_chunk.get("file_name", "")
        
        # 查找并替换现有的chunk，或添加新chunk
        existing_chunk_index = -1
        for i, chunk in enumerate(current_manifest["chunks"]):
            if (new_chunk_name and chunk.get("name") == new_chunk_name) or \
               (new_chunk_file_name and chunk.get("file_name") == new_chunk_file_name):
                existing_chunk_index = i
                break
        
        if existing_chunk_index >= 0:
            current_manifest["chunks"][existing_chunk_index] = new_chunk
        else:
            current_manifest["chunks"].append(new_chunk)
        
        # 更新状态（如果提供）
        if request_data.status:
            current_manifest["status"] = request_data.status
        
        # 保存更新后的manifest
        updated_content = json.dumps(current_manifest, indent=2).encode('utf-8')
        
        try:
            success = storage.save_file(
                key=manifest_key,
                file_data=updated_content,
                content_type="application/json",
                match_etag=current_etag
            )
            
            if not success:
                raise HTTPException(status_code=500, detail="Failed to save manifest")
            
        except Exception as e:
            if "ConditionFailedError" in str(type(e).__name__):
                log_error(f"[{request_id}] 并发冲突: {str(e)}")
                raise HTTPException(status_code=409, detail="Concurrent modification detected")
            raise
        
        # 获取新的ETag
        _, _, new_etag = storage.get_file_with_metadata(manifest_key)
        
        log_info(f"[{request_id}] Manifest更新成功: new_etag={new_etag}")
        
        return ManifestUpdateResponse(
            success=True,
            etag=new_etag,
            message="清单更新成功"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] Manifest更新失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@upload_router.post("/chunk/direct", response_model=DirectChunkUploadResponse)
async def upload_chunk_direct(
    block_id: str,
    file_name: str,
    request: Request,
    content_type: str = "application/octet-stream",
    version_id: Optional[str] = None,  # 可选的版本ID，如果提供则使用，否则生成新的
    current_user: User = Depends(verify_init_auth)  # 使用相同的认证函数
):
    """
    直接上传chunk到最终存储位置
    
    这是简化后的上传API，适用于小文件的快速上传。
    服务器端会生成唯一的version_id和安全的存储路径。
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    request_id = generate_request_id()
    
    try:
        # 1. 使用提供的版本ID或生成新的
        if version_id is None:
            version_id = generate_version_id()
        
        # 2. 清理文件名，确保安全
        safe_file_name = sanitize_file_name(file_name)
        
        # 3. 在服务器端组装完整的key
        key = f"{current_user.user_id}/{block_id}/{version_id}/{safe_file_name}"
        
        log_info(f"[{request_id}] 开始直接chunk上传: user={current_user.user_id}, block_id={block_id}, "
                f"version_id={version_id}, file_name={file_name} -> {safe_file_name}, "
                f"generated_key={key}")
        
        # 4. 读取请求体的chunk数据
        chunk_data = await request.body()
        if not chunk_data:
            raise HTTPException(status_code=400, detail="No chunk data provided")
        
        log_info(f"[{request_id}] 开始保存chunk: size={len(chunk_data)}")
        
        # 5. 检查存储适配器是否支持直接保存
        if hasattr(storage, 'save_chunk_direct'):
            # 使用专门的直接保存方法
            result = storage.save_chunk_direct(
                key=key,
                chunk_data=chunk_data,
                content_type=content_type
            )
        else:
            # 回退到普通的文件保存方法
            success = storage.save_file(
                key=key,
                file_data=chunk_data,
                content_type=content_type
            )
            
            # 获取实际的 ETag
            if success:
                try:
                    _, _, actual_etag = storage.get_file_with_metadata(key)
                except:
                    # 如果获取失败，使用生成的 ETag
                    actual_etag = uuid.uuid4().hex
            else:
                actual_etag = uuid.uuid4().hex
                
            result = {
                "success": success,
                "key": key,
                "etag": actual_etag,
                "size": len(chunk_data),
                "uploaded_at": int(time.time())
            }
        
        response = DirectChunkUploadResponse(
            success=result["success"],
            key=key,
            version_id=version_id,
            etag=result["etag"],
            size=result["size"],
            uploaded_at=result["uploaded_at"]
        )
        
        log_info(f"[{request_id}] 直接chunk上传成功: key={key}, size={len(chunk_data)}")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[{request_id}] 直接chunk上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@upload_router.put("/manifest/remove", response_model=ManifestRemoveChunkResponse)
async def remove_chunk_from_manifest(
    request_data: ManifestRemoveChunkRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
):
    """从manifest文件中删除指定的chunk记录"""
    try:
        manifest_key = f"{request_data.user_id}/{request_data.block_id}/{request_data.version_id}/manifest.json"
        
        # 验证用户权限
        await verify_user_and_resource_access(
            resource_key=manifest_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
        
        # 读取现有的manifest
        try:
            current_content, _, current_etag = storage.get_file_with_metadata(manifest_key)
            current_manifest = json.loads(current_content.decode('utf-8'))
        except Exception:
            return ManifestRemoveChunkResponse(success=True, etag="", message="Manifest不存在")
        
        # 检查乐观锁
        if request_data.expected_etag is not None and current_etag != request_data.expected_etag:
            raise HTTPException(status_code=409, detail="ETag mismatch")
        
        # 删除匹配的chunk
        chunk_to_remove = request_data.chunk_to_remove
        target_name = chunk_to_remove.get("name")
        target_file_name = chunk_to_remove.get("file_name")
        
        filtered_chunks = []
        for chunk in current_manifest.get("chunks", []):
            chunk_name = chunk.get("name", "")
            chunk_file_name = chunk.get("file_name", "")
            
            # 如果匹配则跳过（删除）
            if (target_name and chunk_name == target_name) or \
               (target_file_name and chunk_file_name == target_file_name):
                continue
            filtered_chunks.append(chunk)
        
        # 更新manifest
        current_manifest["chunks"] = filtered_chunks
        current_manifest["updated_at"] = datetime.utcnow().isoformat()
        
        # 保存更新后的manifest
        updated_content = json.dumps(current_manifest, indent=2).encode('utf-8')
        success = storage.save_file(
            key=manifest_key,
            file_data=updated_content,
            content_type="application/json",
            match_etag=current_etag
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save manifest")
        
        # 获取新的ETag
        _, _, new_etag = storage.get_file_with_metadata(manifest_key)
        
        return ManifestRemoveChunkResponse(success=True, etag=new_etag, message="Chunk删除成功")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


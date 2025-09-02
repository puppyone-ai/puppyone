"""
File Management API routes for PuppyStorage
提供文件版本管理、删除等操作的API接口
"""

import os
import sys
import json
import time
from datetime import datetime
from typing import Optional, List, Dict, Any
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
from utils.logger import log_info, log_error, log_debug
from storage import get_storage
from server.auth import verify_user_and_resource_access, User, get_auth_provider

# Create management router
management_router = APIRouter(prefix="/files", tags=["files"])

# 获取存储适配器
storage_adapter = get_storage()

# === Request and Response Models ===

class VersionListRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    block_id: str = Field(..., description="数据块ID")

class VersionInfo(BaseModel):
    version_id: str = Field(..., description="版本ID")
    created_at: Optional[str] = Field(None, description="创建时间")
    status: Optional[str] = Field(None, description="版本状态")
    chunk_count: Optional[int] = Field(None, description="数据块数量")

class VersionListResponse(BaseModel):
    versions: List[VersionInfo] = Field(..., description="版本列表")
    count: int = Field(..., description="版本数量")
    message: str = Field(default="查询成功")

class LatestVersionRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    block_id: str = Field(..., description="数据块ID")

class LatestVersionResponse(BaseModel):
    version_id: Optional[str] = Field(None, description="最新版本ID")
    manifest: Optional[Dict[str, Any]] = Field(None, description="清单内容")
    message: str = Field(default="查询成功")

class PublishVersionRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    block_id: str = Field(..., description="数据块ID") 
    version_id: str = Field(..., description="版本ID")

class PublishVersionResponse(BaseModel):
    success: bool = Field(..., description="操作是否成功")
    version_id: str = Field(..., description="已发布的版本ID")
    message: str = Field(default="版本发布成功")

class DeleteFileRequest(BaseModel):
    user_id: str = Field(..., description="用户ID")
    resource_key: str = Field(..., description="文件的完整路径标识符")

class DeleteFileResponse(BaseModel):
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(default="文件删除成功")

# === Helper Functions ===

def validate_key_format(key: str) -> bool:
    """验证key格式：user_id/block_id/version_id/chunk_name"""
    parts = key.split('/')
    return len(parts) >= 4 and all(part.strip() for part in parts)

def extract_user_id_from_key(key: str) -> str:
    """从resource_key中提取user_id"""
    parts = key.split('/')
    if len(parts) >= 4:
        return parts[0]
    raise ValueError("Invalid key format")

# === API Endpoints ===

@management_router.get("/versions", response_model=VersionListResponse)
async def list_versions(
    user_id: str,
    block_id: str,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
):
    """
    列出指定block_id的所有版本
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    try:
        # 构建用于权限验证的资源键
        resource_key = f"{user_id}/{block_id}/dummy/dummy"
        
        # 验证用户权限
        current_user = await verify_user_and_resource_access(
            resource_key=resource_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
        
        log_info(f"列出版本: user={current_user.user_id}, block_id={block_id}")
        
        # 构建搜索前缀
        prefix = f"{user_id}/{block_id}/"
        
        # 使用delimiter="/"来获取版本目录列表
        objects = storage_adapter.list_objects(prefix=prefix, delimiter="/")
        
        versions = []
        for obj in objects:
            if obj.get("Prefix"):  # 这是一个目录（版本）
                version_path = obj["Prefix"].rstrip("/")
                version_id = version_path.split("/")[-1]
                
                # 尝试获取该版本的manifest信息
                manifest_key = f"{version_path}/manifest.json"
                try:
                    manifest_content, _, _ = storage_adapter.get_file_with_metadata(manifest_key)
                    manifest = json.loads(manifest_content.decode('utf-8'))
                    
                    versions.append(VersionInfo(
                        version_id=version_id,
                        created_at=manifest.get("created_at"),
                        status=manifest.get("status", "unknown"),
                        chunk_count=len(manifest.get("chunks", []))
                    ))
                except Exception:
                    # manifest不存在或无法读取，只添加基本信息
                    versions.append(VersionInfo(
                        version_id=version_id,
                        status="unknown"
                    ))
        
        # 按版本ID排序（通常是时间戳）
        versions.sort(key=lambda x: x.version_id, reverse=True)
        
        log_info(f"找到 {len(versions)} 个版本")
        
        return VersionListResponse(
            versions=versions,
            count=len(versions),
            message="查询成功"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"列出版本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@management_router.get("/latest_version", response_model=LatestVersionResponse)
async def get_latest_version(
    user_id: str,
    block_id: str,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
):
    """
    获取指定block_id的最新版本信息和manifest
    
    需要提供 Authorization: Bearer <jwt_token> header
    """
    try:
        # 构建用于权限验证的资源键
        resource_key = f"{user_id}/{block_id}/dummy/dummy"
        
        # 验证用户权限
        current_user = await verify_user_and_resource_access(
            resource_key=resource_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
        
        log_info(f"获取最新版本: user={current_user.user_id}, block_id={block_id}")
        
        # 构建搜索前缀
        prefix = f"{user_id}/{block_id}/"
        
        # 列出所有版本
        objects = storage_adapter.list_objects(prefix=prefix, delimiter="/")
        
        version_ids = []
        for obj in objects:
            if obj.get("Prefix"):  # 这是一个目录（版本）
                version_path = obj["Prefix"].rstrip("/")
                version_id = version_path.split("/")[-1]
                version_ids.append(version_id)
        
        if not version_ids:
            return LatestVersionResponse(
                version_id=None,
                manifest=None,
                message="未找到任何版本"
            )
        
        # 获取最新版本（假设版本ID是时间戳，较大的是较新的）
        latest_version_id = max(version_ids)
        manifest_key = f"{user_id}/{block_id}/{latest_version_id}/manifest.json"
        
        try:
            manifest_content, _, _ = storage_adapter.get_file_with_metadata(manifest_key)
            manifest = json.loads(manifest_content.decode('utf-8'))
            
            log_info(f"找到最新版本: {latest_version_id}")
            
            return LatestVersionResponse(
                version_id=latest_version_id,
                manifest=manifest,
                message="查询成功"
            )
        except Exception as e:
            log_error(f"读取最新版本manifest失败: {str(e)}")
            return LatestVersionResponse(
                version_id=latest_version_id,
                manifest=None,
                message=f"版本存在但manifest不可读: {str(e)}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"获取最新版本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@management_router.post("/publish_version", response_model=PublishVersionResponse)
async def publish_version(
    request_data: PublishVersionRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
):
    """
    将指定版本标记为已完成/已发布
    
    这会更新该版本的manifest.json，将状态设置为"completed"
    需要提供 Authorization: Bearer <jwt_token> header
    """
    try:
        # 构建manifest文件的key
        manifest_key = f"{request_data.user_id}/{request_data.block_id}/{request_data.version_id}/manifest.json"
        
        # 验证用户权限
        current_user = await verify_user_and_resource_access(
            resource_key=manifest_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
        
        log_info(f"发布版本: user={current_user.user_id}, version={request_data.version_id}")
        
        # 读取现有manifest
        try:
            manifest_content, _, current_etag = storage_adapter.get_file_with_metadata(manifest_key)
            manifest = json.loads(manifest_content.decode('utf-8'))
        except Exception as e:
            log_error(f"无法读取manifest: {str(e)}")
            raise HTTPException(status_code=404, detail="Manifest file not found")
        
        # 更新状态
        manifest["status"] = "completed"
        manifest["published_at"] = datetime.utcnow().isoformat()
        manifest["updated_at"] = datetime.utcnow().isoformat()
        
        # 保存更新后的manifest
        updated_content = json.dumps(manifest, indent=2).encode('utf-8')
        
        try:
            success = storage_adapter.save_file(
                key=manifest_key,
                file_data=updated_content,
                content_type="application/json",
                match_etag=current_etag
            )
            
            if not success:
                raise HTTPException(status_code=500, detail="Failed to update manifest")
                
        except Exception as e:
            if "ConditionFailedError" in str(type(e).__name__):
                log_error(f"并发冲突: {str(e)}")
                raise HTTPException(status_code=409, detail="Concurrent modification detected")
            raise
        
        log_info(f"版本发布成功: {request_data.version_id}")
        
        return PublishVersionResponse(
            success=True,
            version_id=request_data.version_id,
            message="版本发布成功"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"发布版本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@management_router.delete("/delete", response_model=DeleteFileResponse)
async def delete_file(
    request_data: DeleteFileRequest,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider = Depends(get_auth_provider)
):
    """
    删除指定的文件
    
    支持删除单个文件或整个版本目录
    需要提供 Authorization: Bearer <jwt_token> header
    """
    try:
        # 验证用户权限
        current_user = await verify_user_and_resource_access(
            resource_key=request_data.resource_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
        
        log_info(f"删除文件: user={current_user.user_id}, key={request_data.resource_key}")
        
        # 检查文件是否存在
        if not storage_adapter.check_file_exists(request_data.resource_key):
            raise HTTPException(status_code=404, detail="File not found")
        
        # 执行删除
        success = storage_adapter.delete_file(request_data.resource_key)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete file")
        
        log_info(f"文件删除成功: {request_data.resource_key}")
        
        return DeleteFileResponse(
            success=True,
            message="文件删除成功"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"删除文件失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
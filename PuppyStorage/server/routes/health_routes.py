"""
Health Check Routes for PuppyStorage
提供统一的健康检查端点
"""

import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from utils.logger import log_info, log_error
from storage import get_storage

health_router = APIRouter(tags=["health"])

# 获取存储适配器
storage_adapter = get_storage()

@health_router.get("/health")
async def health_check():
    """
    服务健康检查
    
    检查PuppyStorage服务和存储后端的健康状态
    """
    try:
        log_info("Health Check Accessed!")
        
        # 简单检查存储适配器是否正常
        # 不同的存储适配器可能有不同的健康检查方式
        try:
            # 尝试列出存储，检查存储后端是否可用
            if hasattr(storage_adapter, 'list_multipart_uploads'):
                uploads = storage_adapter.list_multipart_uploads()
                active_uploads = len(uploads) if uploads else 0
            else:
                active_uploads = 0
                
            return JSONResponse(
                content={
                    "status": "healthy",
                    "service": "PuppyStorage",
                    "storage_backend": type(storage_adapter).__name__,
                    "active_uploads": active_uploads,
                    "timestamp": int(time.time())
                },
                status_code=200
            )
        except Exception as storage_error:
            log_error(f"Storage backend health check failed: {str(storage_error)}")
            return JSONResponse(
                content={
                    "status": "degraded",
                    "service": "PuppyStorage", 
                    "storage_backend": type(storage_adapter).__name__,
                    "error": "Storage backend unavailable",
                    "details": str(storage_error),
                    "timestamp": int(time.time())
                },
                status_code=503
            )
            
    except Exception as e:
        log_error(f"Health Check Error: {str(e)}")
        return JSONResponse(
            content={
                "status": "unhealthy",
                "service": "PuppyStorage",
                "error": str(e),
                "timestamp": int(time.time())
            },
            status_code=500
        )
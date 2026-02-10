"""
Health Check Routes for PuppyStorage
提供统一的健康检查端点
"""

import time
import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from utils.logger import log_info, log_error
from storage import get_storage

health_router = APIRouter(tags=["health"])

@health_router.get("/health")
async def health_check():
    """
    服务健康检查
    
    检查PuppyStorage服务和存储后端的健康状态
    """
    try:
        log_info("Health Check Accessed!")
        
        # 轻量健康检查（避免阻塞/重操作）：每次请求动态获取适配器并执行 ping
        try:
            adapter = get_storage()
            # 将同步 ping 放入线程，避免阻塞事件循环；如未实现则标记通过
            if hasattr(adapter, 'ping'):
                ping_result = await asyncio.to_thread(adapter.ping)
            else:
                ping_result = {"ok": True, "note": "no ping implemented"}

            status_text = "healthy" if ping_result.get("ok", False) else "degraded"
            return JSONResponse(
                content={
                    "status": status_text,
                    "service": "PuppyStorage",
                    "storage_backend": type(adapter).__name__,
                    "storage": ping_result,
                    "timestamp": int(time.time())
                },
                status_code=200
            )
        except Exception as storage_error:
            log_error(f"Storage backend health check failed: {str(storage_error)}")
            # 仍返回200，避免探针误判为实例宕机；状态体标注 unhealthy
            return JSONResponse(
                content={
                    "status": "unhealthy",
                    "service": "PuppyStorage",
                    "error": "Storage backend check failed",
                    "details": str(storage_error),
                    "timestamp": int(time.time())
                },
                status_code=200
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
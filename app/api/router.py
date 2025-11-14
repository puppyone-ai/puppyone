"""
API路由主入口
"""
from fastapi import APIRouter
from app.api.v1.router import router as v1_router

# 创建主API路由器
# 注意：不在中间层路由设置 tags，只在 endpoint 级别设置
api_router = APIRouter(prefix="/api")

# 包含v1版本的路由
api_router.include_router(v1_router)


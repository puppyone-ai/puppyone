"""
Turbopuffer 搜索模块（内部封装）

本模块仅提供 Python 侧的封装与依赖注入入口，不提供任何 FastAPI 路由。
"""

from .config import TurbopufferConfig, turbopuffer_config
from .exceptions import (
    TurbopufferAuthError,
    TurbopufferConfigError,
    TurbopufferError,
    TurbopufferNotFound,
    TurbopufferRequestError,
)
from .service import TurbopufferSearchService

__all__ = [
    "TurbopufferAuthError",
    "TurbopufferConfig",
    "TurbopufferConfigError",
    "TurbopufferError",
    "TurbopufferNotFound",
    "TurbopufferRequestError",
    "TurbopufferSearchService",
    "turbopuffer_config",
]

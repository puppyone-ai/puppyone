"""
Turbopuffer 模块依赖注入入口

遵循项目现有模式：使用模块级全局变量存储单例，避免 reload 时的 lru_cache 行为不一致。
"""

from __future__ import annotations

import threading

from src.turbopuffer.config import TurbopufferConfig, turbopuffer_config
from src.turbopuffer.service import TurbopufferSearchService

_service: TurbopufferSearchService | None = None
_service_lock = threading.Lock()


def get_turbopuffer_config() -> TurbopufferConfig:
    return turbopuffer_config


def get_turbopuffer_search_service() -> TurbopufferSearchService:
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = TurbopufferSearchService(config=turbopuffer_config)
    return _service

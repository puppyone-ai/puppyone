"""
Turbopuffer module dependency injection entry point.

Follows existing project pattern: uses module-level global variables to store singletons, avoiding inconsistent lru_cache behavior during reload.
"""

from __future__ import annotations

import threading

from src.infra.turbopuffer.config import TurbopufferConfig, turbopuffer_config
from src.infra.turbopuffer.service import TurbopufferSearchService

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

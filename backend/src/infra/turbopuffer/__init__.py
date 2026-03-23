"""
Turbopuffer search module (internal wrapper).

This module only provides Python-side wrappers and dependency injection entry points; no FastAPI routes.
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

"""
Utils Package

Utility modules for PuppyEngine including configuration, logging, 
file type handling, and exception management.
"""

from .config import AppConfig, ConfigValidationError, config
from .file_type import (
    decide_file_type,
    infer_from_ext,
    is_supported_type,
    map_mime,
    normalize_type,
    register_type,
)
from .logger import Logger, log_debug, log_error, log_info, log_warning
from .puppy_exception import PuppyException, global_exception_handler

__all__ = [
    # Config
    "AppConfig",
    "config",
    "ConfigValidationError",
    # File Type
    "decide_file_type",
    "infer_from_ext",
    "is_supported_type",
    "map_mime",
    "normalize_type",
    "register_type",
    # Logger
    "Logger",
    "log_debug",
    "log_error",
    "log_info",
    "log_warning",
    # Exception
    "PuppyException",
    "global_exception_handler",
]


"""
兼容层：保留原有 `log_info/log_error/log_warning/log_debug` API，
底层切换为 Loguru（并由 `src.utils.logging_setup.setup_logging()` 统一配置）。

注意：业务代码无需改动。
"""

from __future__ import annotations

from loguru import logger


class Logger:
    """
    Backward-compatible wrapper.
    """

    def __init__(self, mode: str = "local", use_color: bool | None = None):
        self.mode = mode
        self.use_color = use_color

    def info(self, message: str) -> None:
        logger.info(message)

    def error(self, message: str) -> None:
        logger.error(message)

    def warning(self, message: str) -> None:
        logger.warning(message)

    def debug(self, message: str) -> None:
        logger.debug(message)


# Create default instance (backward compatibility)
default_logger = Logger("local")
log_info = default_logger.info
log_error = default_logger.error
log_warning = default_logger.warning
log_debug = default_logger.debug

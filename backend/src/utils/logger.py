"""
Compatibility layer: preserves the original `log_info/log_error/log_warning/log_debug` API,
with the underlying implementation switched to Loguru (configured uniformly by `src.utils.logging_setup.setup_logging()`).

Note: No changes needed in business code.
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

"""
这是一个重定向文件，用于向后兼容。
推荐直接使用 tools.puppy_utils 包中的日志记录功能。
"""

import warnings

# 导入新工具包中的日志功能
from tools.puppy_utils.logger import get_logger

# 显示弃用警告
warnings.warn(
    "PuppyStorage.utils.logger 已弃用，请使用 tools.puppy_utils 中的日志模块",
    DeprecationWarning,
    stacklevel=2
)

# 为了向后兼容，创建默认的 PuppyStorage 日志器
storage_logger = get_logger("puppystorage")
log_info = storage_logger.info
log_error = storage_logger.error
log_warning = storage_logger.warning
log_debug = storage_logger.debug

# 向后兼容的 Logger 类
class Logger:
    """向后兼容的日志类，内部使用新的工具包实现"""
    
    logger_name = "puppystorage"
    
    def __init__(self, mode="default"):
        """初始化 Logger 实例，但使用新工具包中的实现"""
        self._logger = get_logger("puppystorage", mode)
    
    def info(self, message):
        """记录 info 级别日志"""
        self._logger.info(message)
    
    def error(self, message):
        """记录 error 级别日志"""
        self._logger.error(message)
    
    def warning(self, message):
        """记录 warning 级别日志"""
        self._logger.warning(message)
    
    def debug(self, message):
        """记录 debug 级别日志"""
        self._logger.debug(message)

# 创建默认实例，兼容旧代码
default_logger = Logger("default")
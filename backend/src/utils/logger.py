import logging
import inspect
import os
import sys

# Configure basic logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logging.getLogger("httpx").setLevel(logging.ERROR)


# ANSI 颜色代码
class Colors:
    """ANSI 颜色代码"""

    # 重置
    RESET = "\033[0m"

    # 文本颜色
    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # 亮色
    BRIGHT_BLACK = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"

    # 样式
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # 级别颜色映射
    LEVEL_COLORS = {
        "DEBUG": CYAN,
        "INFO": GREEN,
        "WARNING": YELLOW,
        "ERROR": RED,
        "CRITICAL": BRIGHT_RED,
    }

    # 调用者信息颜色
    CALLER_COLOR = BRIGHT_CYAN
    CALLER_DIM = DIM


# 自定义格式化器，支持颜色（需要在 Colors 类之后定义）
class ColoredFormatter(logging.Formatter):
    """支持颜色的日志格式化器"""

    def __init__(self, use_color=True):
        super().__init__()
        self.use_color = use_color

    def format(self, record):
        """格式化日志记录"""
        if self.use_color:
            # 获取级别颜色
            level_color = Colors.LEVEL_COLORS.get(record.levelname, Colors.RESET)
            colored_level = (
                f"{level_color}{Colors.BOLD}{record.levelname}{Colors.RESET}"
            )
            # 替换默认的级别显示
            record.levelname = colored_level

        # 调用父类格式化
        return super().format(record)


def supports_color():
    """
    检测终端是否支持颜色

    Returns:
        bool: 是否支持颜色
    """
    # 检查是否是终端
    if not hasattr(sys.stdout, "isatty") or not sys.stdout.isatty():
        return False

    # 检查环境变量
    if os.getenv("NO_COLOR"):
        return False

    # Windows 可能需要特殊处理，但 ANSI 代码在 Windows 10+ 也支持
    # 这里简化处理，假设都支持
    return True


class Logger:
    """
    Optimized logging class supporting two modes:
    - default: logs to both Axiom and terminal
    - local: logs only to terminal

    Automatically includes caller information (function name, file name, line number) in log messages.
    """

    logger_name = "puppy-contextbase"

    def __init__(self, mode="default", use_color=None):
        """
        Initialize Logger instance

        Args:
            mode: 日志模式
            use_color: 是否使用颜色，None 表示自动检测
        """
        self.mode = mode
        self.logger = logging.getLogger(self.__class__.logger_name)
        self.use_color = use_color if use_color is not None else supports_color()

        # 禁用传播到 root logger，避免重复输出
        self.logger.propagate = False

        # 设置 logger 级别为 INFO，确保 INFO、WARNING、ERROR 等级别的日志都能输出
        # handler 的级别会在创建时设置
        self.logger.setLevel(logging.INFO)

        # 设置自定义格式化器
        if self.use_color:
            # 如果已经有 handler，使用现有的；否则创建新的
            if not self.logger.handlers:
                handler = logging.StreamHandler()
                handler.setLevel(logging.INFO)  # 设置 handler 级别
                self.logger.addHandler(handler)
            else:
                handler = self.logger.handlers[0]
                handler.setLevel(logging.INFO)  # 确保 handler 级别正确
            handler.setFormatter(ColoredFormatter(use_color=True))
        else:
            # 如果不使用颜色，确保至少有一个 handler
            if not self.logger.handlers:
                handler = logging.StreamHandler()
                handler.setLevel(logging.INFO)  # 设置 handler 级别
                handler.setFormatter(
                    logging.Formatter("%(levelname)s:%(name)s:%(message)s")
                )
                self.logger.addHandler(handler)
            else:
                handler = self.logger.handlers[0]
                handler.setLevel(logging.INFO)  # 确保 handler 级别正确

        self._log_handler = self._log_local

    def _get_caller_info(self):
        """
        获取调用者信息（函数名、文件名、行号）

        Returns:
            tuple: (function_name, file_name, line_number)
        """
        stack = inspect.stack()
        # 跳过 logger.py 本身的调用栈帧，找到真正的调用者
        # stack[0] 是 _get_caller_info 本身
        # stack[1] 是 _format_message
        # stack[2] 是 _log_local
        # stack[3] 是 info/error/warning/debug
        # stack[4] 是真正的调用者（如果直接调用 log_info）
        # 或者 stack[3] 就是调用者（如果通过 Logger 实例调用）

        for i, frame_info in enumerate(stack):
            if i < 2:  # 跳过 _get_caller_info 和 _format_message
                continue
            filename = frame_info.filename
            # 跳过 logger.py 本身的调用
            if "logger.py" not in filename:
                func_name = frame_info.function
                line_no = frame_info.lineno
                # 获取文件名（不含路径）
                file_name = os.path.basename(filename)
                return func_name, file_name, line_no

        # 如果找不到，返回默认值
        return "unknown", "unknown", 0

    def _format_message(self, message, level="INFO"):
        """
        格式化日志消息，添加调用者信息

        Args:
            message: 原始日志消息
            level: 日志级别

        Returns:
            str: 格式化后的日志消息
        """
        func_name, file_name, line_no = self._get_caller_info()

        if self.use_color:
            # 调用者信息使用青色，带点暗色效果
            caller_info = f"{Colors.CALLER_DIM}{Colors.CALLER_COLOR}[{file_name}:{func_name}:{line_no}]{Colors.RESET}"
            return f"{caller_info} {message}"
        else:
            return f"[{file_name}:{func_name}:{line_no}] {message}"

    def _log_local(self, level, message):
        """Only record local logs"""
        log_method = getattr(self.logger, level.lower())
        formatted_message = self._format_message(message, level)
        log_method(formatted_message)

    def info(self, message):
        """Record info level logs"""
        self._log_handler("INFO", message)

    def error(self, message):
        """Record error level logs"""
        self._log_handler("ERROR", message)

    def warning(self, message):
        """Record warning level logs"""
        self._log_handler("WARNING", message)

    def debug(self, message):
        """Record debug level logs"""
        self._log_handler("DEBUG", message)


# Create default instance (backward compatibility)
default_logger = Logger("local")
log_info = default_logger.info
log_error = default_logger.error
log_warning = default_logger.warning
log_debug = default_logger.debug

"""
这是一个重定向文件，用于向后兼容。
推荐直接使用 tools.puppy_utils 包中的异常类和处理函数。
"""

import warnings

# 导入新工具包中的异常类和处理器
from tools.puppy_utils.puppy_exception import PuppyStorageException as NewPuppyException
from tools.puppy_utils.puppy_exception import global_exception_handler

# 显示弃用警告
warnings.warn(
    "PuppyStorage.utils.puppy_exception 已弃用，请使用 tools.puppy_utils 中的异常处理模块",
    DeprecationWarning,
    stacklevel=2
)

# 为了向后兼容，使用别名
PuppyException = NewPuppyException

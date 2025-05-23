"""
这是一个重定向文件，用于向后兼容。
推荐直接使用 tools.puppy_utils 包中的配置管理功能。
"""

import warnings

# 导入新工具包中的配置功能
from tools.puppy_utils.config import config, AppConfig, paths

# 显示弃用警告
warnings.warn(
    "PuppyStorage.utils.config 已弃用，请使用 tools.puppy_utils 中的配置模块",
    DeprecationWarning,
    stacklevel=2
)

# 为了保持向后兼容，将 paths 对象重新导出
PathManager = type(paths)  # 获取 paths 的类型，用于向后兼容
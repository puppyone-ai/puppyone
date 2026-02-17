"""
向后兼容：VersionService 已迁移到 src.collaboration.version_service

保留此文件以兼容任何尚未更新的 import。
"""

# Re-export from the new location
from src.collaboration.version_service import VersionService  # noqa: F401

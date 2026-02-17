"""
向后兼容：Repository 已迁移到 src.collaboration.version_repository

保留此文件以兼容任何尚未更新的 import。
"""

# Re-export from the new location
from src.collaboration.version_repository import (  # noqa: F401
    FileVersionRepository,
    FolderSnapshotRepository,
)

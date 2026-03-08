"""
向后兼容：所有 schema 已迁移到 src.collaboration.schemas

保留此文件以兼容任何尚未更新的 import。
"""

# Re-export everything from the new location
from src.collaboration.schemas import (  # noqa: F401
    FileVersion,
    FolderSnapshot,
    FileVersionInfo,
    FileVersionDetail,
    VersionHistoryResponse,
    FolderSnapshotInfo,
    FolderSnapshotHistoryResponse,
    RollbackResponse,
    FolderRollbackResponse,
    DiffItem,
    DiffResponse,
)

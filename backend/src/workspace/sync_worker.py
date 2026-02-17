"""
向后兼容：SyncWorker 已迁移到 src.sync.sync_worker

保留此文件以兼容任何尚未更新的 import。
"""

# Re-export from the new location
from src.sync.sync_worker import SyncWorker  # noqa: F401

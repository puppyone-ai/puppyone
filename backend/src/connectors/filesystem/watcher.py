"""
Sync Handler — FolderSourceService (stub)

In the new architecture, local folder watching and sync is entirely
handled by the client-side daemon using the MUT HTTP protocol.

This module is retained for backward compatibility with the connection
management system and datasource dependency injection.
"""

from typing import Optional

from src.connectors.datasource.repository import SyncRepository
from src.utils.logger import log_info


class FolderSourceService:
    """
    Stub for the former folder-as-source sync service.

    All folder watch/sync is now client-side via MUT protocol.
    """

    def __init__(self, sync_repo: Optional[SyncRepository] = None, **kwargs):
        self.sync_repo = sync_repo

    async def bootstrap_sync(self, *args, **kwargs) -> dict:
        log_info("[FolderSource] Filesystem sync is now client-side via MUT protocol")
        return {"status": "client_side"}

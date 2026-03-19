"""
L2.5 Sync — SyncWorker (stub)

In the new architecture, syncing data to local directories is entirely
handled by the client-side daemon using the MUT HTTP protocol.

This module is retained as a stub for backward compatibility.
"""

from src.utils.logger import log_info


class SyncWorker:
    """
    Stub for the former sync worker.

    All local directory sync is now client-side via MUT protocol.
    """

    def __init__(self, **kwargs):
        pass

    async def sync(self, *args, **kwargs) -> dict:
        log_info("[SyncWorker] Filesystem sync is now client-side via MUT protocol")
        return {"status": "client_side"}

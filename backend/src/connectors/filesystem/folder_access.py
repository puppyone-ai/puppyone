"""
OpenClaw Provider — FolderAccessService (stub)

In the new architecture, all filesystem sync is handled by the client-side
daemon using the MUT HTTP protocol (clone/push/pull/negotiate).

This module is retained only for backward compatibility with the connection
management lifecycle. All actual sync logic lives in the client CLI.
"""


from src.utils.logger import log_info


class FolderAccessService:
    """
    Stub for the former bidirectional folder sync service.

    All sync functionality is now client-side via MUT protocol.
    This class is retained for connection lifecycle management only.
    """

    def __init__(self, **kwargs):
        pass

    async def start(self, sync_id: str) -> None:
        log_info(f"[FolderAccess] Sync {sync_id}: client-side via MUT protocol")

    async def stop(self, sync_id: str) -> None:
        log_info(f"[FolderAccess] Sync {sync_id}: stopped")

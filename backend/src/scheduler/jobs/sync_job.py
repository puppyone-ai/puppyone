"""
Sync execution job for scheduled sync tasks.

APScheduler calls execute_sync_pull when a scheduled sync needs to refresh.
Now uses SyncEngine (unified execution engine) instead of the legacy
SyncService.pull_sync() path.
"""

import asyncio
from datetime import datetime, timezone

from src.utils.logger import log_info, log_error


async def _execute_sync_pull_async(sync_id: str) -> dict:
    """
    Pull fresh data for a scheduled sync binding via SyncEngine.
    All writes go through CollaborationService (version management).
    """
    from src.connectors.datasource.dependencies import create_sync_engine

    started_at = datetime.now(timezone.utc)
    log_info(f"[sync-scheduler] Starting pull for sync {sync_id}")

    try:
        engine = create_sync_engine()
        result = await engine.execute(sync_id)
        elapsed_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)

        if result:
            log_info(f"[sync-scheduler] Pull completed for sync {sync_id} in {elapsed_ms}ms")
            return {"status": "success", "sync_id": sync_id, "elapsed_ms": elapsed_ms, **result}
        else:
            log_info(f"[sync-scheduler] No changes for sync {sync_id} ({elapsed_ms}ms)")
            return {"status": "no_change", "sync_id": sync_id, "elapsed_ms": elapsed_ms}

    except Exception as e:
        log_error(f"[sync-scheduler] Pull failed for sync {sync_id}: {e}")
        import traceback
        log_error(f"Traceback: {traceback.format_exc()}")

        try:
            from src.supabase.client import SupabaseClient
            from src.connectors.datasource.repository import SyncRepository
            SyncRepository(SupabaseClient()).update_error(sync_id, str(e))
        except Exception:
            pass

        return {"status": "failed", "sync_id": sync_id, "error": str(e)}


def execute_sync_pull(sync_id: str):
    """
    Synchronous wrapper for APScheduler (runs in ThreadPoolExecutor).
    """
    log_info(f"[sync-scheduler] Scheduler triggered for sync {sync_id}")

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_execute_sync_pull_async(sync_id))
        finally:
            loop.close()
    except Exception as e:
        log_error(f"[sync-scheduler] Failed: {e}")
        return {"status": "failed", "error": str(e)}

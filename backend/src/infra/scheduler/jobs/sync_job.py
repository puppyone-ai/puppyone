"""
Sync execution job for scheduled sync tasks.

APScheduler calls execute_sync_pull when a scheduled sync needs to refresh.
Now uses IntegrationEngine instead of the legacy scope-bound sync path.
"""

import asyncio
from datetime import datetime, timezone

from src.utils.logger import log_info, log_error


async def _execute_sync_pull_async(sync_id: str, trigger_type: str = "scheduled") -> dict:
    """
    Pull fresh data for a scheduled Integration binding.
    """
    from src.platform.integrations.dependencies import create_integration_engine

    started_at = datetime.now(timezone.utc)
    log_info(f"[sync-scheduler] Starting pull for sync {sync_id}")

    try:
        engine = create_integration_engine()
        result = await engine.execute(sync_id, trigger_type=trigger_type)
        elapsed_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)

        if result:
            log_info(f"[sync-scheduler] Pull completed for sync {sync_id} in {elapsed_ms}ms")
            return {"status": "success", "access_point_id": sync_id, "elapsed_ms": elapsed_ms, **result}
        else:
            log_info(f"[sync-scheduler] No changes for sync {sync_id} ({elapsed_ms}ms)")
            return {"status": "no_change", "access_point_id": sync_id, "elapsed_ms": elapsed_ms}

    except Exception as e:
        log_error(f"[sync-scheduler] Pull failed for sync {sync_id}: {e}")
        import traceback
        log_error(f"Traceback: {traceback.format_exc()}")

        try:
            from src.infra.supabase.client import SupabaseClient
            from src.platform.integrations.repository import IntegrationRepository
            IntegrationRepository(SupabaseClient()).update_error(sync_id, str(e))
        except Exception:
            pass

        return {"status": "failed", "access_point_id": sync_id, "error": str(e)}


def execute_sync_pull(sync_id: str, trigger_type: str = "scheduled"):
    """
    Synchronous wrapper for APScheduler (runs in ThreadPoolExecutor).
    """
    log_info(f"[sync-scheduler] Scheduler triggered for sync {sync_id}")

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_execute_sync_pull_async(sync_id, trigger_type))
        finally:
            loop.close()
    except Exception as e:
        log_error(f"[sync-scheduler] Failed: {e}")
        return {"status": "failed", "error": str(e)}

"""Scheduled shadow-snapshot TTL reaper job (GAP-10).

Shadow snapshots are an ephemeral projection of a teammate's un-pushed
working tree. Without a reaper their DB rows + S3 manifests accumulate
forever. This job deletes snapshots not refreshed within the configured
TTL. Referenced blobs live in the shared object store and are reclaimed
by the object GC, so the reaper only removes the row + manifest.
"""

from __future__ import annotations

from src.config import settings
from src.utils.logger import log_error


async def process_shadow_snapshot_reaper() -> dict:
    try:
        from src.version_engine.entrypoints.http.shadow_snapshot import (
            reap_stale_shadow_snapshots,
        )

        result = await reap_stale_shadow_snapshots(
            ttl_seconds=settings.SHADOW_SNAPSHOT_TTL_SECONDS,
            max_per_run=settings.SHADOW_SNAPSHOT_REAPER_MAX_PER_RUN,
        )
        return {"status": "ok", **result}
    except Exception as exc:  # noqa: BLE001
        log_error(f"[shadow-snapshot-reaper] scheduler job failed: {exc}")
        return {"status": "failed", "error": str(exc)}

"""L5 write audit and timing helpers.

These helpers are deliberately small and side-effect-light. The write engine
owns the publish decision; this module only prepares audit metadata and log
shape that every L5 publish path shares.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from src.version_engine.domain.intents import TransactionResult
from src.utils.logger import log_info


def audit_detail_with_pusher(intent) -> dict:
    """Copy intent audit details and include a pusher client id when present."""

    base: dict = {}
    pusher_client_id = getattr(intent, "pusher_client_id", "") or ""
    if pusher_client_id:
        base["pusher_client_id"] = pusher_client_id
    base.update(dict(intent.audit_detail or {}))
    return base


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def log_done(
    op_type: str,
    project_id: str,
    scope_path: str,
    result: TransactionResult,
    started_ms: int,
) -> None:
    elapsed = int(time.time() * 1000) - started_ms
    log_info(
        f"[version_engine][{op_type}] done commit={result.commit_id[:12]} "
        f"project={project_id} scope={scope_path!r} "
        f"changes={len(result.paths)} elapsed={elapsed}ms",
    )

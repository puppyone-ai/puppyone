"""Scheduled repair job for version projection outbox rows."""

from __future__ import annotations

from src.mut_engine.services.version_outbox import process_version_outbox_batch
from src.utils.logger import log_error


def process_version_outbox() -> dict:
    try:
        processed = process_version_outbox_batch()
        return {"status": "ok", "processed": processed}
    except Exception as exc:
        log_error(f"[version-outbox] scheduler job failed: {exc}")
        return {"status": "failed", "error": str(exc)}

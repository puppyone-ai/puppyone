"""Project-level protocol admission for Git and legacy MUT adapters."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import HTTPException

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data
from src.utils.logger import log_error, log_warning


ProtocolName = Literal["git", "mut"]
_ALLOWED = frozenset({"git", "mut", "both"})


class ProtocolModeUnavailable(RuntimeError):
    """Raised when protocol admission cannot safely read project policy."""


async def ensure_protocol_enabled(project_id: str, protocol: ProtocolName) -> None:
    """Reject adapter requests that the project's protocol mode disables.

    The flag is intentionally resolved at adapter admission only. Once a
    request becomes a transaction intent, the engine sees the same canonical
    version model regardless of whether the caller came from Git or MUT.
    """

    try:
        mode = await asyncio.to_thread(get_project_protocol_mode, project_id)
    except ProtocolModeUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if mode == "both" or mode == protocol:
        return
    raise HTTPException(
        status_code=403,
        detail=(
            f"{protocol.upper()} protocol is disabled for this project "
            f"(protocol_mode={mode})"
        ),
    )


def get_project_protocol_mode(project_id: str) -> str:
    """Return ``git``, ``mut``, or ``both``.

    Development/test defaults to fail-open ``both`` when the column is
    unavailable so older local fixtures and partially migrated dev DBs do not
    strand existing projects. Staging/production defaults to fail-closed.
    ``MUT_PROTOCOL_MODE_FAIL_OPEN`` can override this explicitly.
    """

    try:
        resp = (
            SupabaseClient().client.table("projects")
            .select("protocol_mode")
            .eq("id", project_id)
            .maybe_single()
            .execute()
        )
        data = safe_data(resp) or {}
        if not data:
            return _fallback_or_raise(
                project_id,
                "project protocol_mode row was not found",
            )
        mode = (data.get("protocol_mode") or "both").lower()
        if mode in _ALLOWED:
            return mode
        return _fallback_or_raise(
            project_id,
            f"invalid protocol_mode value {mode!r}",
        )
    except Exception as exc:  # noqa: BLE001 - compatibility with old DBs/tests
        if isinstance(exc, ProtocolModeUnavailable):
            raise
        return _fallback_or_raise(project_id, str(exc))


def _protocol_mode_fail_open() -> bool:
    if settings.MUT_PROTOCOL_MODE_FAIL_OPEN is not None:
        return settings.MUT_PROTOCOL_MODE_FAIL_OPEN
    return settings.APP_ENV in {"development", "test"}


def _fallback_or_raise(project_id: str, reason: str) -> str:
    if _protocol_mode_fail_open():
        log_warning(
            f"[protocol_mode] falling back to both for project={project_id}: {reason}"
        )
        return "both"
    message = (
        "project protocol mode is unavailable; refusing protocol admission "
        f"for project={project_id}"
    )
    log_error(f"[protocol_mode] {message}: {reason}")
    raise ProtocolModeUnavailable(message)

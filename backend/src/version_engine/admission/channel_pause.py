"""Channel-level permission gate for admitted scope credentials."""

from __future__ import annotations

import threading
import time

from fastapi import HTTPException

from src.repo.connector_repository import ConnectorRepository
from src.utils.logger import log_error, log_warning


# Recognised channel headers. Anything else is silently ignored so that
# unknown / future client kinds don't break authentication. The worst case is
# that pause becomes informational for that client kind, not that a legitimate
# request gets rejected.
_KNOWN_CHANNELS = frozenset({"cli", "filesystem"})
_CHANNEL_PAUSE_CACHE_TTL_SECONDS = 2.0
_channel_pause_cache: dict[tuple[str, str], tuple[float, str | None, str | None]] = {}
_channel_pause_cache_lock = threading.Lock()


def _get_cached_channel_pause(scope_id: str, channel: str) -> tuple[str | None, str | None] | None:
    now = time.monotonic()
    key = (scope_id, channel)
    with _channel_pause_cache_lock:
        cached = _channel_pause_cache.get(key)
        if cached is None:
            return None
        expires_at, connector_id, status = cached
        if expires_at <= now:
            _channel_pause_cache.pop(key, None)
            return None
        return connector_id, status


def _set_cached_channel_pause(
    scope_id: str,
    channel: str,
    connector_id: str | None,
    status: str | None,
) -> None:
    key = (scope_id, channel)
    with _channel_pause_cache_lock:
        _channel_pause_cache[key] = (
            time.monotonic() + _CHANNEL_PAUSE_CACHE_TTL_SECONDS,
            connector_id,
            status,
        )


def enforce_channel_pause(
    auth: dict,
    channel: str | None,
    *,
    log_prefix: str = "[Auth]",
) -> None:
    """Reject requests for paused built-in connectors.

    Access keys resolve to a repo scope, while pause/resume is represented on
    the scope-bound connector row. Keeping this gate in admission makes Git
    smart HTTP, version WebSocket, and scoped AP-FS routes enforce the same
    policy.
    """

    normalized_channel = (channel or "").strip().lower()
    scope = auth.get("_scope") or {}
    scope_id = scope.get("id")
    if normalized_channel in _KNOWN_CHANNELS and scope_id and scope_id != "_root":
        cached = _get_cached_channel_pause(scope_id, normalized_channel)
        if cached is None:
            try:
                connector = ConnectorRepository().get_by_scope_provider(
                    scope_id,
                    normalized_channel,
                )
            except Exception as e:
                log_error(
                    f"{log_prefix} Channel-pause lookup failed for scope={scope_id} "
                    f"channel={normalized_channel}: {e}; failing open"
                )
                connector_id = None
                connector_status = None
            else:
                connector_id = connector.id if connector is not None else None
                connector_status = connector.status if connector is not None else None
                _set_cached_channel_pause(
                    scope_id,
                    normalized_channel,
                    connector_id,
                    connector_status,
                )
        else:
            connector_id, connector_status = cached

        if connector_status == "paused":
            log_warning(
                f"{log_prefix} Rejected {normalized_channel} request to scope={scope_id}: "
                f"connector {connector_id} is paused"
            )
            raise HTTPException(
                status_code=403,
                detail=(
                    f"The '{normalized_channel}' connector for this scope is paused. "
                    "Resume it from the Access page to re-enable this channel."
                ),
            )

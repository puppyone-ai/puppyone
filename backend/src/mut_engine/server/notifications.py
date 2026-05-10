"""Server-side WebSocket notification manager for the MUT protocol.

Implements the producer side of ``mut listen`` (see
``mut/foundation/ws_client.py`` on branch ``feat/git-format-storage``).
After every successful push the hook in
``src.mut_engine.services.hooks.run_post_push_hook`` calls
:meth:`NotificationManager.broadcast_commit_update` to fan out a
``commit_update`` JSON frame to every WebSocket client subscribed to
the affected scope.

Persistence
-----------
The on-disk message persistence (``.mut/messages/`` on the client)
is the *client's* job. This server-side manager only keeps a small
per-client queue for clients that disconnect mid-frame; the queue is
flushed when the client reconnects. Pre-existing missed events are
caught up by ``mut pull`` (see
``mut.ops.pull_op._persist_incoming_notifications``).

Concurrency
-----------
The manager is process-wide singleton-style. Connections register
via :meth:`register` and unregister on disconnect. All public methods
are async-safe. We don't try to be cluster-aware — running multiple
backend replicas means each only fans out to its own connections, and
``mut pull`` covers the rest.
"""
from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket

from src.utils.logger import log_debug, log_info, log_warning


@dataclass
class _ClientConn:
    websocket: WebSocket
    project_id: str
    scope_path: str  # normalised, no leading/trailing /
    agent: str
    client_id: str = field(default_factory=lambda: uuid.uuid4().hex)


class NotificationManager:
    """Process-wide WebSocket notification manager.

    Use :meth:`get` for the singleton; the FastAPI app initialises one
    on startup and tears it down on shutdown.
    """

    # Bound size of the per-client offline queue — a runaway producer
    # shouldn't grow memory unbounded for a slow consumer. 500 events
    # is enough to hold ~30 minutes of busy work; clients that fall
    # further behind are expected to reconcile via ``mut pull``.
    MAX_OFFLINE_PER_CLIENT = 500

    _instance: "NotificationManager | None" = None

    def __init__(self):
        # (project_id, scope_path) → list of active connections.
        self._conns: dict[tuple[str, str], list[_ClientConn]] = defaultdict(list)
        # client_id → list of pending events for offline clients.
        self._offline: dict[str, list[dict]] = defaultdict(list)
        # Single asyncio.Lock guarding both maps. Coarse but writes are
        # cheap — connect/disconnect/broadcast — and this serialises
        # against the iteration in broadcast which would otherwise
        # race a concurrent unregister.
        self._lock = asyncio.Lock()

    @classmethod
    def get(cls) -> "NotificationManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_for_tests(cls):
        cls._instance = None

    # ── connection lifecycle ───────────────────────────

    async def register(
        self, websocket: WebSocket, project_id: str,
        scope_path: str, agent: str,
    ) -> _ClientConn:
        scope_norm = (scope_path or "").strip("/")
        conn = _ClientConn(
            websocket=websocket, project_id=project_id,
            scope_path=scope_norm, agent=agent,
        )
        async with self._lock:
            self._conns[(project_id, scope_norm)].append(conn)
        # Per-client lifecycle is debug-only — there can be many of
        # these per session. Broadcast events stay at info so
        # ``commit_update`` fan-out is still visible at default level.
        log_debug(
            f"[NotificationManager] registered client_id={conn.client_id} "
            f"project={project_id} scope={scope_norm!r} agent={agent}"
        )
        return conn

    async def unregister(self, conn: _ClientConn):
        async with self._lock:
            bucket = self._conns.get((conn.project_id, conn.scope_path))
            if bucket is not None:
                try:
                    bucket.remove(conn)
                except ValueError:
                    pass
                if not bucket:
                    self._conns.pop((conn.project_id, conn.scope_path), None)
        log_debug(
            f"[NotificationManager] unregistered client_id={conn.client_id}"
        )

    # ── broadcast ──────────────────────────────────────

    async def broadcast_commit_update(
        self, project_id: str, scope_path: str, *,
        commit_id: str, pushed_by: str, changes: list[dict],
        message: str = "", scope_hash: str = "",
    ):
        """Send a ``commit_update`` frame to every client subscribed to
        the affected scope (or any ancestor scope, since pushing into
        ``docs/sub`` is also visible to a listener on ``docs``).
        """
        scope_norm = (scope_path or "").strip("/")
        payload = {
            "type": "commit_update",
            "notification_id": commit_id,
            "scope": scope_norm,
            "commit_id": commit_id,
            "pushed_by": pushed_by,
            "message": message,
            "scope_hash": scope_hash,
            "changed_files": [c.get("path", "") for c in (changes or [])],
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

        # Targets: every connection on the same project whose scope
        # contains the affected path. ``''`` (root scope) is the
        # ancestor of everything.
        targets: list[_ClientConn] = []
        async with self._lock:
            for (proj, conn_scope), bucket in self._conns.items():
                if proj != project_id:
                    continue
                if conn_scope == "" or _is_ancestor(conn_scope, scope_norm):
                    targets.extend(bucket)

        sent = 0
        dropped = 0
        for conn in targets:
            # Don't echo the event back to the agent that produced it
            # (mirrors mut/server/server.py:_post_push_hook ``exclude=pushed_by``).
            if conn.agent == pushed_by:
                continue
            try:
                await conn.websocket.send_json(payload)
                sent += 1
            except Exception as e:
                log_warning(
                    f"[NotificationManager] send failed to "
                    f"client_id={conn.client_id}: {e} — queueing offline"
                )
                self._enqueue_offline(conn.client_id, payload)
                dropped += 1

        if sent or dropped:
            log_info(
                f"[NotificationManager] broadcast commit_update "
                f"project={project_id} scope={scope_norm!r} "
                f"sent={sent} dropped={dropped}"
            )

    def _enqueue_offline(self, client_id: str, payload: dict):
        q = self._offline[client_id]
        if len(q) >= self.MAX_OFFLINE_PER_CLIENT:
            q.pop(0)
        q.append(payload)

    async def flush_offline(self, conn: _ClientConn):
        """Drain queued events for a freshly-reconnected client."""
        pending = self._offline.pop(conn.client_id, [])
        delivered = 0
        for payload in pending:
            try:
                await conn.websocket.send_json(payload)
                delivered += 1
            except Exception as e:  # noqa: BLE001 — drop noisy disconnects
                log_warning(f"[NotificationManager] flush failed: {e}")
                # Re-queue the rest in case the client reconnects again.
                self._offline[conn.client_id].extend(
                    pending[pending.index(payload):]
                )
                break
        if delivered:
            log_info(
                f"[NotificationManager] flushed {delivered} offline "
                f"event(s) to client_id={conn.client_id}"
            )


def _is_ancestor(maybe_ancestor: str, descendant: str) -> bool:
    """Return True if *maybe_ancestor* contains *descendant* as a path
    prefix. Empty string is the root scope and an ancestor of everything.
    """
    if not maybe_ancestor:
        return True
    if maybe_ancestor == descendant:
        return True
    return descendant.startswith(maybe_ancestor + "/")

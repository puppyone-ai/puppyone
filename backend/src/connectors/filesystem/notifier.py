"""
L2.5 Sync — ChangeNotifier

In-process notification hub for content changes.
Enables Long Poll: HTTP request hangs until a change occurs or timeout.

Architecture:
    Producers:  VersionService._emit_changelog() → notify()
    Consumers:  Long Poll endpoint → wait_for_changes()

    This is the "trigger" layer. Different access points have different
    trigger sources, but they all converge here:
      - OpenClaw CLI:  cursor-based changelog → Long Poll
      - Webhook:       changelog → HTTP callback (future)
      - Chat Agent:    user message → SSE (separate channel, not here)

    Single-process: uses asyncio.Event (zero overhead when idle).
    Multi-process:  upgrade to Redis Pub/Sub by swapping _notify_local
                    with a Redis PUBLISH, and wait_for_changes with SUBSCRIBE.

Usage:
    notifier = ChangeNotifier.get_instance()

    # Producer side (after changelog write):
    notifier.notify("project-123")

    # Consumer side (Long Poll endpoint):
    changed = await notifier.wait_for_changes("project-123", timeout=30)
"""

import asyncio
import threading
from typing import Optional


class ChangeNotifier:
    """Lightweight per-project change notification via waiter futures."""

    _instance: Optional["ChangeNotifier"] = None

    def __init__(self):
        self._waiters: dict[str, set[asyncio.Future[bool]]] = {}
        self._pending_signal: set[str] = set()
        self._lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> "ChangeNotifier":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def notify(self, project_id: str) -> None:
        """
        Signal that project data has changed.
        Wakes up all Long Poll waiters for this project.
        """
        with self._lock:
            waiters = list(self._waiters.pop(project_id, set()))
            if not waiters:
                self._pending_signal.add(project_id)
                return

        for fut in waiters:
            if fut.done():
                continue
            loop = fut.get_loop()
            loop.call_soon_threadsafe(self._resolve_waiter, fut)

    async def wait_for_changes(self, project_id: str, timeout: float = 30.0) -> bool:
        """
        Block until a change notification arrives or timeout expires.

        Returns True if a change was detected, False on timeout.
        """
        with self._lock:
            if project_id in self._pending_signal:
                self._pending_signal.remove(project_id)
                return True

            loop = asyncio.get_running_loop()
            fut: asyncio.Future[bool] = loop.create_future()
            self._waiters.setdefault(project_id, set()).add(fut)

        try:
            await asyncio.wait_for(fut, timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            with self._lock:
                waiters = self._waiters.get(project_id)
                if waiters and fut in waiters:
                    waiters.remove(fut)
                    if not waiters:
                        self._waiters.pop(project_id, None)

    def _cleanup_idle(self, project_id: str) -> None:
        """Remove event for a project with no active waiters (memory hygiene)."""
        with self._lock:
            self._waiters.pop(project_id, None)
            self._pending_signal.discard(project_id)

    @staticmethod
    def _resolve_waiter(fut: asyncio.Future[bool]) -> None:
        if not fut.done():
            fut.set_result(True)

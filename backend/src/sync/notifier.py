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
from typing import Optional


class ChangeNotifier:
    """Lightweight per-project change notification via asyncio.Event."""

    _instance: Optional["ChangeNotifier"] = None

    def __init__(self):
        self._events: dict[str, asyncio.Event] = {}

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
        ev = self._events.get(project_id)
        if ev:
            ev.set()

    async def wait_for_changes(self, project_id: str, timeout: float = 30.0) -> bool:
        """
        Block until a change notification arrives or timeout expires.

        Returns True if a change was detected, False on timeout.
        """
        ev = self._events.get(project_id)
        if ev is None:
            ev = asyncio.Event()
            self._events[project_id] = ev

        ev.clear()
        try:
            await asyncio.wait_for(ev.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            if project_id in self._events and not self._events[project_id].is_set():
                pass

    def _cleanup_idle(self, project_id: str) -> None:
        """Remove event for a project with no active waiters (memory hygiene)."""
        self._events.pop(project_id, None)

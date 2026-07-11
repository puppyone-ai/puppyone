"""
MCP session 注册表
用于记录 api_key -> session，并在工具列表变更时通知客户端刷新
"""

from __future__ import annotations

import weakref

import anyio
from mcp.server.session import ServerSession


class SessionRegistry:
    """Session 注册表：跟踪活跃 ServerSession，用于通知工具变更"""

    def __init__(self) -> None:
        self._lock = anyio.Lock()
        self._by_api_key: dict[str, weakref.WeakSet[ServerSession]] = {}
        self._by_surface: dict[str, weakref.WeakSet[ServerSession]] = {}

    async def bind(self, api_key: str, session: ServerSession) -> None:
        """绑定 api_key 和 session"""
        async with self._lock:
            bucket = self._by_api_key.get(api_key)
            if bucket is None:
                bucket = weakref.WeakSet()
                self._by_api_key[api_key] = bucket
            bucket.add(session)

    async def bind_surface(self, access_surface_id: str, session: ServerSession) -> None:
        async with self._lock:
            bucket = self._by_surface.get(access_surface_id)
            if bucket is None:
                bucket = weakref.WeakSet()
                self._by_surface[access_surface_id] = bucket
            bucket.add(session)

    async def notify_tools_list_changed(self, api_key: str) -> int:
        """通知指定 api_key 的所有 session：工具列表已变更"""
        async with self._lock:
            bucket = self._by_api_key.get(api_key)
            sessions = list(bucket) if bucket is not None else []

        sent = 0
        for s in sessions:
            try:
                await s.send_tool_list_changed()
                sent += 1
            except Exception:
                continue

        return sent

    async def notify_surface_changed(self, access_surface_id: str) -> int:
        async with self._lock:
            bucket = self._by_surface.get(access_surface_id)
            sessions = list(bucket) if bucket is not None else []

        sent = 0
        for session in sessions:
            try:
                await session.send_tool_list_changed()
                sent += 1
            except Exception:
                continue
        return sent

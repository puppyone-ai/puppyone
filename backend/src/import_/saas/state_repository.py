"""
SaaS Import Runtime State Repository (Redis)

Store runtime state as JSON in Redis.
Follows the same pattern as ETL state repository for consistency.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, UTC
from typing import Any, Optional

from arq.connections import ArqRedis

from .config import sync_config
from .models import SyncRuntimeState

logger = logging.getLogger(__name__)


class SyncStateRepositoryRedis:
    """
    Redis repository for sync runtime state.
    
    This handles the real-time state during task execution.
    The source of truth during active processing.
    """

    def __init__(
        self,
        redis: ArqRedis,
        *,
        key_prefix: str | None = None,
        ttl_seconds: int | None = None,
        terminal_ttl_seconds: int | None = None,
    ):
        self.redis = redis
        self.key_prefix = (
            key_prefix if key_prefix is not None else sync_config.sync_redis_prefix
        )
        self.ttl_seconds = (
            ttl_seconds if ttl_seconds is not None else sync_config.sync_state_ttl_seconds
        )
        self.terminal_ttl_seconds = (
            terminal_ttl_seconds
            if terminal_ttl_seconds is not None
            else sync_config.sync_state_terminal_ttl_seconds
        )

    def _key(self, task_id: int) -> str:
        """Generate Redis key for a task."""
        prefix = self.key_prefix
        if prefix and not prefix.endswith(":"):
            prefix = f"{prefix}:"
        return f"{prefix}task:{task_id}"

    async def get(self, task_id: int) -> Optional[SyncRuntimeState]:
        """Get runtime state for a task."""
        raw = await self.redis.get(self._key(task_id))
        if not raw:
            return None
        try:
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode("utf-8")
            data = json.loads(raw)
            return SyncRuntimeState.model_validate(data)
        except Exception as e:
            logger.warning(f"Failed to decode sync runtime state for task_id={task_id}: {e}")
            return None

    async def set(
        self, state: SyncRuntimeState, *, ttl_seconds: int | None = None
    ) -> None:
        """Save runtime state for a task."""
        state.updated_at = datetime.now(UTC)
        ttl = ttl_seconds if ttl_seconds is not None else self.ttl_seconds
        await self.redis.set(self._key(state.task_id), state.model_dump_json(), ex=ttl)

    async def merge(
        self, task_id: int, patch: dict[str, Any], *, ttl_seconds: int | None = None
    ) -> Optional[SyncRuntimeState]:
        """Merge patch into existing state."""
        current = await self.get(task_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(patch)
        data["updated_at"] = datetime.now(UTC)
        next_state = SyncRuntimeState.model_validate(data)
        ttl = ttl_seconds if ttl_seconds is not None else self.ttl_seconds
        await self.redis.set(self._key(task_id), next_state.model_dump_json(), ex=ttl)
        return next_state

    async def set_terminal(self, state: SyncRuntimeState) -> None:
        """Mark terminal state and shorten TTL."""
        await self.set(state, ttl_seconds=self.terminal_ttl_seconds)

    async def delete(self, task_id: int) -> None:
        """Delete runtime state for a task."""
        await self.redis.delete(self._key(task_id))

    async def exists(self, task_id: int) -> bool:
        """Check if runtime state exists for a task."""
        return bool(await self.redis.exists(self._key(task_id)))


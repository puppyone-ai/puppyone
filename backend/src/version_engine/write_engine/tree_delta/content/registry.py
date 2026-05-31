"""Deterministic strategy routing for optional L5 content-aware deltas."""

from __future__ import annotations

from src.version_engine.write_engine.tree_delta.content.models import ContentDelta
from src.version_engine.write_engine.tree_delta.content.strategy import (
    ContentDeltaStrategy,
)


class ContentDeltaRegistry:
    """Route changed files to optional machine-diff strategies.

    Strategies are enrichments, not authority. If no strategy supports a file
    or a strategy cannot inspect it, L5 falls back to structural TreeDelta. This
    keeps the write path correct while allowing many file-specific inspectors
    to be registered without adding file-type branches to the core engine.
    """

    def __init__(
        self,
        strategies: tuple[ContentDeltaStrategy, ...] = (),
        *,
        strict: bool = False,
    ) -> None:
        self._strategies: list[ContentDeltaStrategy] = []
        self._strict = strict
        for strategy in strategies:
            self.register(strategy)

    @property
    def strategies(self) -> tuple[ContentDeltaStrategy, ...]:
        return tuple(self._strategies)

    def register(self, strategy: ContentDeltaStrategy) -> None:
        strategy_id = getattr(strategy, "id", "")
        if not strategy_id:
            raise ValueError("content delta strategy id is required")
        if any(existing.id == strategy_id for existing in self._strategies):
            raise ValueError(f"duplicate content delta strategy id: {strategy_id}")
        self._strategies.append(strategy)

    def strategy_for(
        self,
        path: str,
        old_data: bytes | None,
        new_data: bytes | None,
    ) -> ContentDeltaStrategy | None:
        for strategy in self._strategies:
            if strategy.supports(path, old_data, new_data):
                return strategy
        return None

    def changed_regions(
        self,
        path: str,
        old_data: bytes | None,
        new_data: bytes | None,
    ) -> ContentDelta | None:
        strategy = self.strategy_for(path, old_data, new_data)
        if not strategy:
            return None
        try:
            regions = strategy.changed_regions(path, old_data, new_data)
        except Exception as exc:
            if self._strict:
                raise
            regions = {
                "kind": "content-delta-error",
                "error": type(exc).__name__,
                "fallback": "structural",
            }
        return ContentDelta(path=path, strategy_id=strategy.id, regions=regions)

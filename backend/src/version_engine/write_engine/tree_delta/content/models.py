"""Contracts for optional L5 content-aware deltas."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ContentDelta:
    """Machine-readable content delta produced by one strategy."""

    path: str
    strategy_id: str
    regions: object

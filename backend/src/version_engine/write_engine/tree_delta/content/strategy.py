"""Strategy protocol for optional L5 content-aware deltas."""

from __future__ import annotations

from typing import Protocol


class ContentDeltaStrategy(Protocol):
    """Optional extension point for L5 content-aware conflict inputs.

    Structural TreeDelta stays path/tree/blob based. If L5 needs JSON,
    Markdown, DOCX, or product-specific write-conflict facts, those strategies
    hang off this contract and feed merge/conflict policy, not UI rendering.
    """

    id: str

    def supports(self, path: str, old_data: bytes | None, new_data: bytes | None) -> bool:
        """Return whether this strategy can inspect the changed file."""

    def changed_regions(
        self,
        path: str,
        old_data: bytes | None,
        new_data: bytes | None,
    ) -> object:
        """Return strategy-specific machine regions for L5 policy use."""

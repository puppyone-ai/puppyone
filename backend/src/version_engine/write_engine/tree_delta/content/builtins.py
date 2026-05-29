"""Default optional content-aware delta strategies."""

from __future__ import annotations

from src.version_engine.write_engine.tree_delta.content.registry import (
    ContentDeltaRegistry,
)
from src.version_engine.write_engine.tree_delta.content.strategies.docx import (
    DocxPackageDeltaStrategy,
)
from src.version_engine.write_engine.tree_delta.content.strategies.json import (
    JsonPathDeltaStrategy,
)
from src.version_engine.write_engine.tree_delta.content.strategies.text import (
    TextLineDeltaStrategy,
)


def build_default_content_delta_registry(*, strict: bool = False) -> ContentDeltaRegistry:
    """Build the default strategy router.

    More specific formats must appear before broader fallbacks. Product-specific
    strategies should be registered by the caller after construction, or through
    a dedicated composition root, rather than imported by L5 Core directly.
    """

    return ContentDeltaRegistry(
        (
            JsonPathDeltaStrategy(),
            DocxPackageDeltaStrategy(),
            TextLineDeltaStrategy(),
        ),
        strict=strict,
    )

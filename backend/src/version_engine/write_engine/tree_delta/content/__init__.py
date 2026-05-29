"""Optional L5 content-aware machine diff extensions."""

from src.version_engine.write_engine.tree_delta.content.builtins import (
    build_default_content_delta_registry,
)
from src.version_engine.write_engine.tree_delta.content.models import ContentDelta
from src.version_engine.write_engine.tree_delta.content.registry import (
    ContentDeltaRegistry,
)
from src.version_engine.write_engine.tree_delta.content.strategy import (
    ContentDeltaStrategy,
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

__all__ = [
    "ContentDelta",
    "ContentDeltaRegistry",
    "ContentDeltaStrategy",
    "DocxPackageDeltaStrategy",
    "JsonPathDeltaStrategy",
    "TextLineDeltaStrategy",
    "build_default_content_delta_registry",
]

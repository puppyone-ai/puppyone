"""Built-in optional content-aware machine diff strategies."""

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
    "DocxPackageDeltaStrategy",
    "JsonPathDeltaStrategy",
    "TextLineDeltaStrategy",
]

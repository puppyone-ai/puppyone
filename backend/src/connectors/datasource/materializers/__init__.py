"""Provider-owned workspace file layouts for Integration syncs."""

from src.connectors.datasource.materializers.base import (
    MaterializationSchema,
    MaterializedOutput,
    SourceMaterializer,
)
from src.connectors.datasource.materializers.providers import DEFAULT_MATERIALIZERS

__all__ = [
    "DEFAULT_MATERIALIZERS",
    "MaterializationSchema",
    "MaterializedOutput",
    "SourceMaterializer",
]

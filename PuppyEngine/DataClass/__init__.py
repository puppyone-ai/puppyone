"""
DataClass Package

Data structures and schemas for PuppyEngine including Chunk models
and Pydantic validation schemas for workflows, blocks, and edges.
"""

from .Chunk import Chunk
from .schemas import (
    ALLOWED_EDGE_TYPES,
    BlockDataModel,
    BlockModel,
    ChunkEdgeData,
    DeepResearchEdgeData,
    EdgeCommonData,
    EdgeModel,
    GeneratorEdgeData,
    IfElseEdgeData,
    KeywordSearchModel,
    LLMEdgeData,
    LoadEdgeData,
    ModifyEdgeData,
    QASearchModel,
    SearchCollectionConfigs,
    SearchDataSourceItem,
    SearchEdgeData,
    VectorSearchModel,
    WebSearchModel,
    WorkflowModel,
    normalize_workflow_payload,
)

__all__ = [
    # Chunk
    "Chunk",
    # Constants
    "ALLOWED_EDGE_TYPES",
    # Block Models
    "BlockDataModel",
    "BlockModel",
    # Edge Data Models
    "EdgeCommonData",
    "LLMEdgeData",
    "LoadEdgeData",
    "ChunkEdgeData",
    "ModifyEdgeData",
    "IfElseEdgeData",
    "GeneratorEdgeData",
    "DeepResearchEdgeData",
    # Search Models
    "SearchCollectionConfigs",
    "SearchDataSourceItem",
    "VectorSearchModel",
    "KeywordSearchModel",
    "QASearchModel",
    "WebSearchModel",
    "SearchEdgeData",
    # Top Level
    "EdgeModel",
    "WorkflowModel",
    # Utilities
    "normalize_workflow_payload",
]


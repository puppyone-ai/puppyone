"""
Workflow/Edge/Block schemas and validators (v0.2)

This module defines explicit pydantic schemas for workflow payloads and provides
normalize + validate helpers that are compatible with the current engine design.

Goals:
- Keep Block data/external_metadata flexible to preserve UI contracts
- Enforce Edge inputs/outputs refer to existing blocks; value is optional label
- Restrict allowed edge types (exclude rerank/code/query_rewrite for now)
- For Search edges, align collection configs with PuppyStorage vector_routes
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Literal, Union
from pydantic import BaseModel, Field, field_validator, model_validator


ALLOWED_EDGE_TYPES = (
    "load",
    "llm",
    "chunk",
    "search",
    "modify",
    "ifelse",
    "generator",
    "deep_research",
)


class BlockDataModel(BaseModel):
    content: Optional[Any] = None
    external_metadata: Optional[Dict[str, Any]] = None


class BlockModel(BaseModel):
    # id comes from the outer mapping key; keep it optional for normalization
    id: Optional[str] = None
    label: Optional[str] = None
    type: Optional[str] = None
    storage_class: Literal["internal", "external"] = "internal"
    data: BlockDataModel = Field(default_factory=BlockDataModel)

    @model_validator(mode="before")
    def _ensure_data_dict(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        # Ensure 'data' exists and is a dict
        data = values.get("data")
        if data is None:
            values["data"] = {}
        return values


class EdgeCommonData(BaseModel):
    # inputs/outputs: key is block_id; value is optional label (for display)
    inputs: Dict[str, Optional[str]] = Field(default_factory=dict)
    outputs: Dict[str, Optional[str]] = Field(default_factory=dict)


class LLMEdgeData(EdgeCommonData):
    model: Optional[str] = None
    messages: Optional[List[Dict[str, Any]]] = None
    chat_histories: Optional[List[Dict[str, Any]]] = None


class LoadEdgeData(EdgeCommonData):
    block_type: str


class ChunkEdgeData(EdgeCommonData):
    chunking_mode: str
    sub_chunking_mode: Optional[str] = None


class ModifyEdgeData(EdgeCommonData):
    modify_type: str
    content: Any
    extra_configs: Optional[Dict[str, Any]] = None


class IfElseEdgeData(EdgeCommonData):
    cases: Dict[str, Any]
    content_blocks: Optional[Dict[str, Any]] = None


class GeneratorEdgeData(EdgeCommonData):
    queries: List[str]  # list of block_ids
    docs: Optional[List[str]] = None  # list of block_ids


class DeepResearchEdgeData(EdgeCommonData):
    query: Any


class SearchCollectionConfigs(BaseModel):
    # Two options:
    # 1) Provide collection_name directly
    # 2) Or provide set_name + model + user_id (Engine/Storage can derive collection_name)
    collection_name: Optional[str] = None
    set_name: Optional[str] = None
    model: Optional[str] = Field(default="text-embedding-ada-002")
    user_id: Optional[str] = Field(default="public")
    vdb_type: Optional[str] = None  # dynamic default handled by storage service

    @model_validator(mode="after")
    def _one_of_collection_or_triplet(self) -> "SearchCollectionConfigs":
        cname = self.collection_name
        set_name = self.set_name
        model = self.model
        user_id = self.user_id
        if not cname and not (set_name and model and user_id):
            raise ValueError(
                "Search collection_configs must include either collection_name, or all of set_name+model+user_id"
            )
        return self


class SearchDataSourceItem(BaseModel):
    index_item: Dict[str, Any]

    @field_validator("index_item")
    @classmethod
    def _validate_index_item(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        # Require index_item.collection_configs
        cc = v.get("collection_configs")
        if not isinstance(cc, dict):
            raise ValueError("index_item.collection_configs must be provided")
        # Validate collection_configs with our nested model
        SearchCollectionConfigs(**cc)
        return v


class VectorSearchModel(BaseModel):
    search_type: Literal["vector"]
    query_id: Dict[str, Any]
    doc_ids: Optional[List[str]] = None
    data_source: List[SearchDataSourceItem]
    top_k: Optional[int] = Field(default=10, ge=1)
    threshold: Optional[float] = None
    metric: Optional[str] = Field(default="cosine")

    @field_validator("query_id")
    @classmethod
    def _validate_query_id(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(v, dict) or len(v) == 0:
            raise ValueError("query_id must be a non-empty mapping of block_id -> {}")
        if len(v.keys()) != 1:
            raise ValueError("query_id must contain exactly one block_id")
        return v


class KeywordSearchModel(VectorSearchModel):
    search_type: Literal["keyword"]


class QASearchModel(BaseModel):
    search_type: Literal["qa"]
    sub_search_type: str
    query_id: Dict[str, Any]
    extra_configs: Optional[Dict[str, Any]] = None


class WebSearchModel(BaseModel):
    search_type: Literal["web"]
    sub_search_type: str
    top_k: Optional[int] = Field(default=5, ge=1)
    extra_configs: Optional[Dict[str, Any]] = None


SearchEdgeData = Union[
    VectorSearchModel, KeywordSearchModel, QASearchModel, WebSearchModel
]


class EdgeModel(BaseModel):
    type: Literal[
        "load",
        "llm",
        "chunk",
        "search",
        "modify",
        "ifelse",
        "generator",
        "deep_research",
    ]  # enforce allowed edges only
    data: Dict[str, Any]

    # Expand into specialized validations per edge type
    @model_validator(mode="after")
    def _validate_by_type(self) -> "EdgeModel":
        etype: str = self.type
        data: Dict[str, Any] = self.data or {}

        # Always coerce inputs/outputs presence
        data.setdefault("inputs", {})
        data.setdefault("outputs", {})

        # Dispatch to specific schemas to validate shape
        if etype == "llm":
            LLMEdgeData(**data)
        elif etype == "load":
            LoadEdgeData(**data)
        elif etype == "chunk":
            ChunkEdgeData(**data)
        elif etype == "modify":
            ModifyEdgeData(**data)
        elif etype == "ifelse":
            IfElseEdgeData(**data)
        elif etype == "generator":
            GeneratorEdgeData(**data)
        elif etype == "deep_research":
            DeepResearchEdgeData(**data)
        elif etype == "search":
            search_type = data.get("search_type")
            if search_type == "vector":
                VectorSearchModel(**data)
            elif search_type == "keyword":
                KeywordSearchModel(**data)
            elif search_type == "qa":
                QASearchModel(**data)
            elif search_type == "web":
                WebSearchModel(**data)
            else:
                raise ValueError(f"Unknown search_type: {search_type}")

        # write back potentially normalized data
        self.data = data
        return self


class WorkflowModel(BaseModel):
    version: Literal["0.2"] = "0.2"
    blocks: Dict[str, BlockModel]
    edges: Dict[str, EdgeModel]

    @model_validator(mode="after")
    def _validate_refs_and_labels(self) -> "WorkflowModel":
        blocks: Dict[str, BlockModel] = self.blocks or {}
        edges: Dict[str, EdgeModel] = self.edges or {}

        # Populate id and default label from key
        for bid, b in blocks.items():
            if b.id is None:
                b.id = bid
            if b.label is None:
                b.label = bid

        block_ids = set(blocks.keys())

        # Validate inputs/outputs refer to existing blocks and optional label matches
        for eid, e in edges.items():
            data = e.data or {}
            inputs = data.get("inputs", {}) or {}
            outputs = data.get("outputs", {}) or {}

            merged = dict(inputs)
            merged.update(outputs)
            for ref_id, label in merged.items():
                if ref_id not in block_ids:
                    raise ValueError(f"Edge {eid} references missing block_id: {ref_id}")
                if label is not None and blocks[ref_id].label != label:
                    # ignore mismatch silently; engine uses block_id + block.label from blocks
                    pass

        return self


def normalize_workflow_payload(raw_workflow: Dict[str, Any]) -> Dict[str, Any]:
    """Best-effort normalization: fill defaults and coerce shapes.

    Returns a new dict that passes WorkflowModel validation or raises ValueError.
    """
    if not isinstance(raw_workflow, dict):
        raise ValueError("workflow must be a JSON object")

    payload = dict(raw_workflow)  # shallow copy
    payload.setdefault("version", "0.2")
    payload.setdefault("blocks", {})
    payload.setdefault("edges", {})

    # Ensure blocks are dicts and have data dict
    normalized_blocks: Dict[str, Any] = {}
    for bid, b in payload["blocks"].items():
        if not isinstance(b, dict):
            raise ValueError(f"Block {bid} must be an object")
        b = dict(b)
        b.setdefault("label", bid)
        b.setdefault("storage_class", "external")
        b.setdefault("data", {})
        normalized_blocks[bid] = b

    payload["blocks"] = normalized_blocks

    # Normalize edges data: ensure inputs/outputs keys exist
    normalized_edges: Dict[str, Any] = {}
    for eid, e in payload["edges"].items():
        if not isinstance(e, dict):
            raise ValueError(f"Edge {eid} must be an object")
        e = dict(e)
        data = dict(e.get("data", {}))
        data.setdefault("inputs", {})
        data.setdefault("outputs", {})
        e["data"] = data
        normalized_edges[eid] = e

    payload["edges"] = normalized_edges

    # Validate with pydantic (raises on error)
    WorkflowModel(**payload)
    return payload



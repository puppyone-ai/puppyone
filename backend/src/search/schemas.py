from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SearchToolQueryInput(BaseModel):
    """
    Search Tool 查询入参（给 internal API / MCP tool 使用）。

    约束：
    - query 必填且非空（服务侧会做 strip 校验）
    - top_k 可选，默认 5，上限 20
    """

    query: str = Field(
        ...,
        description="检索查询文本（必填，非空）",
        examples=["LLM 训练数据如何清洗？", "项目里有哪些鉴权中间件？"],
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="返回结果条数（可选，默认 5，上限 20）",
        examples=[5, 10],
    )


class SearchChunk(BaseModel):
    # DB id（可选；当前实现主要依赖 turbopuffer attributes）
    id: Optional[int] = None

    table_id: int
    json_pointer: str

    chunk_index: int
    total_chunks: int

    chunk_text: str
    char_start: int
    char_end: int

    content_hash: str

    turbopuffer_namespace: Optional[str] = None
    turbopuffer_doc_id: Optional[str] = None


class SearchResultItem(BaseModel):
    score: float
    chunk: SearchChunk
    # Tool 视角下、相对于 tool.json_path 的路径（RFC6901）
    json_path: str


class SearchToolQueryResponse(BaseModel):
    query: str
    results: list[SearchResultItem] = Field(default_factory=list)

"""
Input/output schemas for this module.

Purpose:
- Normalize the turbopuffer SDK return structures so upper layers don't depend on SDK Pydantic models
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TurbopufferRow(BaseModel):
    id: int | str
    # If include_attributes returns a vector (float array or base64), it will be exposed here for export/debug
    vector: Any | None = None
    distance: float | None = None
    score: float | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class TurbopufferQueryResponse(BaseModel):
    rows: list[TurbopufferRow] = Field(default_factory=list)
    aggregations: dict[str, Any] | None = None
    aggregation_groups: list[dict[str, Any]] | None = None
    billing: dict[str, Any] | None = None
    performance: dict[str, Any] | None = None
    kind: Literal["query"] = "query"


class TurbopufferMultiQueryItem(BaseModel):
    rows: list[TurbopufferRow] = Field(default_factory=list)
    aggregations: dict[str, Any] | None = None
    aggregation_groups: list[dict[str, Any]] | None = None
    billing: dict[str, Any] | None = None
    performance: dict[str, Any] | None = None


class TurbopufferMultiQueryResponse(BaseModel):
    results: list[TurbopufferMultiQueryItem] = Field(default_factory=list)
    kind: Literal["multi_query"] = "multi_query"


class TurbopufferWriteResponse(BaseModel):
    kind: Literal["write"] = "write"
    rows_affected: int | None = None
    rows_upserted: int | None = None
    rows_patched: int | None = None
    rows_deleted: int | None = None
    rows_remaining: bool | None = None
    billing: dict[str, Any] | None = None


class TurbopufferNamespaceInfo(BaseModel):
    id: str


class TurbopufferListNamespacesResponse(BaseModel):
    namespaces: list[TurbopufferNamespaceInfo] = Field(default_factory=list)
    next_cursor: str | None = None
    kind: Literal["list_namespaces"] = "list_namespaces"

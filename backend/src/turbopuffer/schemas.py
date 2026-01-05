"""
本模块的输入/输出 schemas

目的：
- 归一化 turbopuffer SDK 的返回结构，避免上层依赖 SDK 的 Pydantic 模型
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TurbopufferRow(BaseModel):
    id: int | str
    distance: float | None = None
    score: float | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class TurbopufferQueryResponse(BaseModel):
    rows: list[TurbopufferRow] = Field(default_factory=list)
    kind: Literal["query"] = "query"


class TurbopufferMultiQueryItem(BaseModel):
    rows: list[TurbopufferRow] = Field(default_factory=list)


class TurbopufferMultiQueryResponse(BaseModel):
    results: list[TurbopufferMultiQueryItem] = Field(default_factory=list)
    kind: Literal["multi_query"] = "multi_query"


class TurbopufferWriteResponse(BaseModel):
    kind: Literal["write"] = "write"
    # turbopuffer 的写入返回可能包含 billing 等字段；本模块默认不暴露，留作扩展

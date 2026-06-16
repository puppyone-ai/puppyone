"""Internal MCP runtime endpoints backed by Version Engine scoped FS."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.internal.router import verify_internal_secret
from src.version_engine.bootstrap.dependencies import (
    get_product_operation_adapter,
    get_version_write_command_service,
)
from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.scoped_fs.errors import ScopedFsError
from src.version_engine.scoped_fs.registry import build_mcp_tool_definitions
from src.version_engine.scoped_fs.resolver import resolve_mcp_scoped_fs_context
from src.version_engine.scoped_fs.service import ScopedFsService


router = APIRouter(
    prefix="/internal/mcp-runtime",
    tags=["internal-mcp-runtime"],
    dependencies=[Depends(verify_internal_secret)],
)


class RuntimeToolsRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


class RuntimeCallRequest(BaseModel):
    api_key: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.post("/tools")
async def list_runtime_tools(payload: RuntimeToolsRequest):
    ctx = resolve_mcp_scoped_fs_context(payload.api_key)
    return {
        "mode": "mcp_endpoint",
        "endpoint": {
            "id": ctx.endpoint_id,
            "name": ctx.endpoint_name,
            "project_id": ctx.project_id,
            "scope_id": ctx.scope_id,
            "scope_path": ctx.scope_path,
            "mode": ctx.mode,
        },
        "tools": build_mcp_tool_definitions(
            writable=ctx.writable,
            allowed_tools=ctx.allowed_tools,
        ),
    }


@router.post("/call")
async def call_runtime_tool(
    payload: RuntimeCallRequest,
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    commands: VersionWriteCommandService = Depends(get_version_write_command_service),
):
    ctx = resolve_mcp_scoped_fs_context(payload.api_key)
    service = ScopedFsService(ops, commands)
    try:
        result = await service.call(ctx, payload.name, payload.arguments)
    except ScopedFsError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    return {
        "tool": payload.name,
        "structuredContent": result,
        "isError": False,
    }

"""Internal MCP runtime endpoints backed by Version Engine scoped FS."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.internal.router import verify_internal_secret
from src.infra.search.dependencies import get_search_service
from src.infra.search.index_task_repository import SearchIndexTaskRepository
from src.infra.search.service import SearchService
from src.infra.supabase.dependencies import (
    get_supabase_client,
    get_supabase_repository,
)
from src.repo.access_surface_repository import AccessSurfaceRepository
from src.tool.repository import ToolRepositorySupabase
from src.version_engine.bootstrap.dependencies import (
    get_product_operation_adapter,
    get_version_write_command_service,
)
from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.scoped_fs.errors import ScopedFsError
from src.version_engine.scoped_fs.registry import (
    MCP_FS_TOOL_NAMES,
    build_mcp_tool_definitions,
)
from src.version_engine.scoped_fs.resolver import ResolvedMcpRuntime, resolve_mcp_runtime
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


def _custom_tool_name(name: str) -> str:
    return f"tool_{name}"


def _list_custom_tools(runtime: ResolvedMcpRuntime) -> list[tuple[dict, Any]]:
    """Resolve canonical ``access_tools`` bindings into concrete tools."""

    surface_repo = AccessSurfaceRepository(get_supabase_client())
    tool_repo = ToolRepositorySupabase(get_supabase_repository())
    resolved: list[tuple[dict, Any]] = []
    seen_names: set[str] = set()
    for binding in surface_repo.list_tool_bindings(
        runtime.context.endpoint_id,
        enabled_only=True,
        mcp_exposed_only=True,
    ):
        tool = tool_repo.get_by_id(binding.get("tool_id", ""))
        if not tool or tool.project_id != runtime.context.project_id:
            continue
        exposed_name = _custom_tool_name(tool.name)
        if exposed_name in seen_names or exposed_name in MCP_FS_TOOL_NAMES:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate MCP tool name: {exposed_name}",
            )
        seen_names.add(exposed_name)
        resolved.append((binding, tool))
    return resolved


def _custom_tool_definition(tool: Any) -> dict[str, Any]:
    input_schema = tool.input_schema
    if not isinstance(input_schema, dict):
        input_schema = {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "top_k": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query"],
            "additionalProperties": False,
        }
    return {
        "name": _custom_tool_name(tool.name),
        "title": tool.name,
        "description": tool.description or f"{tool.name} tool",
        "inputSchema": input_schema,
        "outputSchema": tool.output_schema if isinstance(tool.output_schema, dict) else None,
        "annotations": {
            "readOnlyHint": tool.type == "search",
            "destructiveHint": False,
            "idempotentHint": tool.type == "search",
            "openWorldHint": False,
        },
    }


def _tool_is_inside_runtime_scope(runtime: ResolvedMcpRuntime, path: str) -> bool:
    target = (path or "").strip("/")
    scope = runtime.context.scope_path.strip("/")
    if scope and target != scope and not target.startswith(f"{scope}/"):
        return False
    relative = target[len(scope):].strip("/") if scope else target
    for excluded in runtime.context.exclude:
        clean = str(excluded or "").strip("/")
        if clean:
            for candidate in (relative, target):
                if candidate == clean or candidate.startswith(f"{clean}/"):
                    return False
    return True


@router.post("/tools")
async def list_runtime_tools(payload: RuntimeToolsRequest):
    runtime = resolve_mcp_runtime(payload.api_key)
    ctx = runtime.context
    tools = build_mcp_tool_definitions(
        writable=ctx.writable,
        allowed_tools=ctx.allowed_tools,
    )
    tools.extend(_custom_tool_definition(tool) for _, tool in _list_custom_tools(runtime))
    return {
        "mode": runtime.surface_kind,
        "endpoint": {
            "id": ctx.endpoint_id,
            "name": ctx.endpoint_name,
            "project_id": ctx.project_id,
            "scope_id": ctx.scope_id,
            "scope_path": ctx.scope_path,
            "mode": ctx.mode,
        },
        "tools": tools,
    }


@router.post("/call")
async def call_runtime_tool(
    payload: RuntimeCallRequest,
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    commands: VersionWriteCommandService = Depends(get_version_write_command_service),
    search_service: SearchService = Depends(get_search_service),
):
    runtime = resolve_mcp_runtime(payload.api_key)
    ctx = runtime.context
    try:
        if payload.name in MCP_FS_TOOL_NAMES:
            result = await ScopedFsService(ops, commands).call(
                ctx, payload.name, payload.arguments
            )
        else:
            matches = [
                tool
                for _, tool in _list_custom_tools(runtime)
                if _custom_tool_name(tool.name) == payload.name
            ]
            if not matches:
                raise ScopedFsError("UNKNOWN_TOOL", f"Unknown MCP tool: {payload.name}")
            tool = matches[0]
            if tool.type != "search":
                raise ScopedFsError(
                    "UNSUPPORTED_TOOL",
                    f"Custom MCP tool type is not executable: {tool.type}",
                )
            if not tool.path or not _tool_is_inside_runtime_scope(runtime, tool.path):
                raise ScopedFsError(
                    "SCOPE_DENIED",
                    "Custom tool path is outside the MCP access surface scope",
                    status_code=403,
                )
            query = str(payload.arguments.get("query") or "").strip()
            if not query:
                raise ScopedFsError("INVALID_ARGUMENT", "query is required")
            try:
                top_k = max(1, min(int(payload.arguments.get("top_k", 5)), 100))
            except (TypeError, ValueError) as exc:
                raise ScopedFsError(
                    "INVALID_ARGUMENT", "top_k must be an integer"
                ) from exc
            task = SearchIndexTaskRepository(get_supabase_client()).get_by_tool_id(tool.id)
            if task and task.folder_path:
                result = await search_service.search_folder(
                    project_id=ctx.project_id,
                    folder_path=tool.path,
                    query=query,
                    top_k=top_k,
                )
            else:
                result = await search_service.search_scope(
                    project_id=ctx.project_id,
                    path=tool.path,
                    tool_json_path=tool.json_path or "",
                    query=query,
                    top_k=top_k,
                )
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

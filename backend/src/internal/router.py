"""
Internal API Router
Called by internal services (e.g., MCP Server), authenticated via SECRET
"""

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from typing import Optional, Dict, Any
from src.content.table.dependencies import get_table_service
from src.config import settings
from src.exceptions import AppException
from src.infra.supabase.dependencies import get_supabase_repository
from src.infra.turbopuffer.internal_router import router as turbopuffer_internal_router
from src.infra.search.dependencies import get_search_service
from src.infra.search.schemas import SearchToolQueryInput, SearchToolQueryResponse
from src.tool.repository import ToolRepositorySupabase
from src.version_engine.bootstrap.dependencies import (
    build_worker_version_engine_container,
    get_product_operation_adapter,
)
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.platform.project.repository import ProjectRepositorySupabase
from src.utils.logger import log_warning

router = APIRouter(prefix="/internal", tags=["internal"])


async def verify_internal_secret(x_internal_secret: str = Header(...)) -> None:
    configured_secret = (settings.INTERNAL_API_SECRET or "").strip()
    if not configured_secret:
        raise HTTPException(
            status_code=503,
            detail="Internal API secret is not configured",
        )

    if not hmac.compare_digest(x_internal_secret, configured_secret):
        raise HTTPException(status_code=403, detail="Invalid internal secret")


def _enforce_acting_user_project_access(request: Request, project_id: str) -> str:
    """SECURITY (C-3): Internal endpoints that operate on a project must
    declare WHICH user the call is being made on behalf of (via the
    X-Acting-User-Id header), and that user must have access to project_id.

    Without this check, anyone holding the internal secret (e.g. the mcp
    service, or an attacker who exfiltrated it) could read/write the hash
    tree of ANY project by varying project_id.

    Returns:
        acting_user_id (str)

    Raises:
        400 if X-Acting-User-Id is missing
        403 if the acting user has no access to project_id
    """
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    acting_user = request.headers.get("x-acting-user-id", "").strip()
    if not acting_user:
        raise HTTPException(
            status_code=400,
            detail=(
                "Internal endpoints operating on a project must declare "
                "X-Acting-User-Id header"
            ),
        )

    try:
        repo = ProjectRepositorySupabase()
        role = repo.verify_project_access(project_id, acting_user)
    except Exception as e:
        log_warning(
            f"[Internal] project access check error project={project_id} "
            f"user={acting_user}: {e}"
        )
        raise HTTPException(
            status_code=503,
            detail="Project access check unavailable",
        ) from e

    if role is None:
        log_warning(
            f"[Internal] cross_tenant_denied project={project_id} "
            f"acting_user={acting_user} caller={request.headers.get('x-internal-caller', 'unknown')}"
        )
        raise HTTPException(
            status_code=403,
            detail="Acting user is not a member of this project",
        )
    return acting_user


def _create_write_commands() -> VersionWriteCommandService:
    return build_worker_version_engine_container().write_commands()


# ============================================================
# Turbopuffer internal debug endpoints
# ============================================================
router.include_router(
    turbopuffer_internal_router,
    dependencies=[Depends(verify_internal_secret)],
)


@router.get(
    "/table/{table_id}",
    summary="Get table metadata",
    description="Get table metadata by table_id (excluding data content)",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_table_metadata(table_id: str, table_service=Depends(get_table_service)):
    table = table_service.get_by_id(table_id)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    return {
        "id": table.id,
        "table_id": table.id,
        "name": table.name,
        "description": table.description,
        "project_id": table.project_id,
    }


# ============================================================
# New internal endpoints (more standardized naming, clearer parameters)
# ============================================================


@router.get(
    "/tables/{table_id}/context-schema",
    summary="Get table mount point data structure",
    description="Get structure by table_id + json_path (JSON Pointer), excluding actual values",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_table_context_schema(
    table_id: str,
    json_path: str = Query(default="", description="Mount point JSON Pointer path"),
    table_service=Depends(get_table_service),
):
    try:
        return table_service.get_context_structure(
            table_id=table_id, json_pointer_path=json_path
        )
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/tables/{table_id}/context-data",
    summary="Get table mount point data (optional JMESPath query)",
    description="Get data by table_id + json_path; if query is provided, performs JMESPath query on the data",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_table_context_data(
    table_id: str,
    json_path: str = Query(default="", description="Mount point JSON Pointer path"),
    query: Optional[str] = Query(
        default=None, description="JMESPath query expression (optional)"
    ),
    table_service=Depends(get_table_service),
):
    try:
        if query:
            return table_service.query_context_data_with_jmespath(
                table_id=table_id, json_pointer_path=json_path, query=query
            )
        return table_service.get_context_data(
            table_id=table_id, json_pointer_path=json_path
        )
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/tables/{table_id}/context-data",
    summary="Batch create elements at mount point",
    description="Create elements at mount point by table_id + json_path; writes by key for dict, appends content in order for list",
    dependencies=[Depends(verify_internal_secret)],
)
async def create_table_context_data(
    table_id: str,
    payload: Dict[str, Any],
    table_service=Depends(get_table_service),
):
    try:
        json_path = payload.get("json_path", "")
        elements = payload.get("elements", [])
        data = await table_service.create_context_data(
            table_id=table_id,
            mounted_json_pointer_path=json_path,
            elements=elements,
        )
        return {"message": "Created successfully", "data": data}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/tables/{table_id}/context-data",
    summary="Batch update elements at mount point",
    description="Update elements by table_id + json_path; replaces by key for dict, treats key as index for list",
    dependencies=[Depends(verify_internal_secret)],
)
async def update_table_context_data(
    table_id: str,
    payload: Dict[str, Any],
    table_service=Depends(get_table_service),
):
    try:
        json_path = payload.get("json_path", "")
        elements = payload.get("elements", [])
        data = await table_service.update_context_data(
            table_id=table_id, json_pointer_path=json_path, elements=elements
        )
        return {"message": "Updated successfully", "data": data}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete(
    "/tables/{table_id}/context-data",
    summary="Batch delete elements at mount point",
    description="Delete keys by table_id + json_path; deletes by key for dict, treats key as index for list",
    dependencies=[Depends(verify_internal_secret)],
)
async def delete_table_context_data(
    table_id: str,
    payload: Dict[str, Any],
    table_service=Depends(get_table_service),
):
    try:
        json_path = payload.get("json_path", "")
        keys = payload.get("keys", [])
        data = await table_service.delete_context_data(
            table_id=table_id, json_pointer_path=json_path, keys=keys
        )
        return {"message": "Deleted successfully", "data": data}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Search Tool internal endpoints (called by mcp_service v2)
# ============================================================


@router.post(
    "/tools/{tool_id}/search",
    response_model=SearchToolQueryResponse,
    summary="Execute Search Tool (ANN retrieval)",
    description=(
        "Execute semantic vector retrieval (ANN) by tool_id, returning structured results.\n\n"
        "Key points for frontend/callers:\n"
        "- This is an Internal API endpoint, requiring `X-Internal-Secret` authentication;\n"
        "- Tool must be `type=search` and must have a bound `path`;\n"
        "- Returned `results[*].json_path` is **relative to tool.json_path in RFC6901 format**, for frontend scoped positioning."
    ),
    dependencies=[Depends(verify_internal_secret)],
)
async def search_tool(
    tool_id: str,
    payload: SearchToolQueryInput,
    supabase_repo=Depends(get_supabase_repository),
    search_service=Depends(get_search_service),
):
    tool = supabase_repo.get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    if (tool.type or "").strip() != "search":
        raise HTTPException(status_code=400, detail="Tool is not a search tool")

    node_path = tool.path or ""
    if not node_path:
        raise HTTPException(status_code=400, detail="tool.path is missing")

    project_id = tool.project_id or ""
    if not project_id:
        raise HTTPException(status_code=400, detail="tool.project_id is missing")

    try:
        from src.infra.search.index_task_repository import SearchIndexTaskRepository
        from src.infra.supabase.client import SupabaseClient

        sb_client = SupabaseClient().get_client()
        task_repo = SearchIndexTaskRepository(sb_client)
        task = task_repo.get_by_tool_id(str(tool_id))

        is_folder_search = bool(task and task.folder_path)
    except Exception:
        is_folder_search = False

    try:
        if is_folder_search:
            results = await search_service.search_folder(
                project_id=project_id,
                folder_path=node_path,
                query=payload.query,
                top_k=payload.top_k,
            )
        else:
            results = await search_service.search_scope(
                project_id=project_id,
                path=node_path,
                tool_json_path=tool.json_path or "",
                query=payload.query,
                top_k=payload.top_k,
            )
        return {"query": payload.query, "results": results}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# ContentNode POSIX endpoints (called by mcp_service POSIX tools)
# All path-based, using ProductOperationAdapter (hash clone/push under the hood)
# ============================================================


@router.post(
    "/nodes/resolve-path",
    summary="Resolve path to node info",
    description="Resolve to specific node info by project_id + path",
    dependencies=[Depends(verify_internal_secret)],
)
async def resolve_node_path(
    payload: Dict[str, Any],
    request: Request,
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
):
    try:
        project_id = payload.get("project_id", "")
        _enforce_acting_user_project_access(request, project_id)
        path = payload.get("path", "")

        if not path or path == "/":
            return {"virtual_root": True, "path": "/"}

        path = path.strip("/")
        entry = ops.stat(project_id, path)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        return {
            "name": entry.name,
            "type": entry.type,
            "path": entry.path,
            "size_bytes": entry.size_bytes,
            "mime_type": entry.mime_type,
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/nodes/list",
    summary="List directory contents",
    description="List child entries at specified path (including metadata)",
    dependencies=[Depends(verify_internal_secret)],
)
async def list_node_children(
    request: Request,
    project_id: str = Query(..., description="Project ID"),
    path: str = Query("", description="Directory path"),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
):
    try:
        _enforce_acting_user_project_access(request, project_id)
        path = path.strip("/")
        entries = ops.list_dir(project_id, path)

        return {
            "path": path,
            "children": [
                {
                    "name": e.name,
                    "path": e.path,
                    "type": e.type,
                    "size_bytes": e.size_bytes,
                    "mime_type": e.mime_type,
                    "children_count": e.children_count,
                }
                for e in entries
            ],
        }
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/nodes/read",
    summary="Read file content",
    description="Return JSON content / Markdown text / file metadata based on path and type",
    dependencies=[Depends(verify_internal_secret)],
)
async def read_node_content(
    request: Request,
    project_id: str = Query(..., description="Project ID"),
    path: str = Query(..., description="File path"),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
):
    try:
        _enforce_acting_user_project_access(request, project_id)
        path = path.strip("/")
        entry = ops.stat(project_id, path)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        base = {
            "name": entry.name,
            "path": entry.path,
            "type": entry.type,
            "size_bytes": entry.size_bytes,
        }

        if entry.type == "folder":
            children = ops.list_dir(project_id, path)
            base["children"] = [
                {
                    "name": c.name,
                    "path": c.path,
                    "type": c.type,
                    "size_bytes": c.size_bytes,
                }
                for c in children
            ]
            return base

        content_bytes = ops.read_file(project_id, path)

        if entry.type == "json":
            import json
            try:
                base["content"] = json.loads(content_bytes.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                base["content"] = content_bytes.decode("utf-8", errors="replace")
            return base

        if entry.type == "markdown":
            base["content"] = content_bytes.decode("utf-8", errors="replace")
            return base

        base["mime_type"] = entry.mime_type
        base["content"] = content_bytes.decode("utf-8", errors="replace")
        return base

    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/nodes/write",
    summary="Write file content (via ProductOperationAdapter)",
    description="Create or update file content",
    dependencies=[Depends(verify_internal_secret)],
)
async def write_node_content(
    payload: Dict[str, Any],
    request: Request,
):
    """
    Write file content via ProductOperationAdapter.

    payload:
        project_id: str
        path: str
        content: Any (JSON object or Markdown string)
        operator_id: str (optional)
    """
    try:
        project_id = payload.get("project_id", "")
        _enforce_acting_user_project_access(request, project_id)
        path = payload.get("path", "").strip("/")
        content = payload.get("content")
        operator_id = payload.get("operator_id", "mcp_agent")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        if not isinstance(content, (str, dict, list, bytes)):
            raise HTTPException(status_code=400, detail=f"Unsupported content type: {type(content).__name__}")

        commands = _create_write_commands()
        outcome = await commands.write_file(
            project_id,
            path,
            content,
            node_type="file",
            actor=operator_id,
            message=f"Write {path}",
        )
        result = outcome.result

        return {
            "path": outcome.path,
            "commit_id": result.commit_id,
            "op": "modified",
            "updated": True,
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/create",
    summary="Create file or directory (via ProductOperationAdapter)",
    description="Create a new file (JSON / Markdown) or empty directory at the specified path",
    dependencies=[Depends(verify_internal_secret)],
)
async def create_node(
    payload: Dict[str, Any],
    request: Request,
):
    """
    Create file/directory via ProductOperationAdapter.

    payload:
        project_id: str
        path: str
        node_type: str (json | markdown | folder)
        content: Any (optional)
        created_by: str (optional)
    """
    try:
        project_id = payload.get("project_id", "")
        _enforce_acting_user_project_access(request, project_id)
        path = payload.get("path", "").strip("/")
        node_type = payload.get("node_type", "")
        content = payload.get("content")
        created_by = payload.get("created_by", "mcp_agent")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        if node_type not in ("json", "markdown", "folder"):
            raise HTTPException(status_code=400, detail=f"Unsupported node type for creation: {node_type}")

        commands = _create_write_commands()

        if node_type == "folder":
            outcome = await commands.mkdir(
                project_id,
                path,
                actor=created_by,
                message=f"mkdir {path}",
            )
            result = outcome.result
        else:
            if content is None:
                content = {} if node_type == "json" else ""

            outcome = await commands.write_file(
                project_id,
                path,
                content,
                node_type=node_type,
                actor=created_by,
                message=f"Create {path}",
            )
            result = outcome.result

        return {
            "path": outcome.path,
            "created": True,
            "commit_id": result.commit_id,
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/rm",
    summary="Delete file or directory",
    description="Remove file or directory from the version tree",
    dependencies=[Depends(verify_internal_secret)],
)
async def remove_node(
    payload: Dict[str, Any],
    request: Request,
):
    """
    payload:
        project_id: str
        path: str
        user_id: str
    """
    try:
        project_id = payload.get("project_id", "")
        _enforce_acting_user_project_access(request, project_id)
        path = payload.get("path", "").strip("/")
        user_id = payload.get("user_id", "mcp_agent")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")
        commands = _create_write_commands()
        if commands.ops.stat(project_id, path) is None:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        outcome = await commands.delete(
            project_id,
            [path],
            actor=user_id,
            message=f"delete {path}",
        )
        result = outcome.result

        return {"path": path, "removed": True, "commit_id": result.commit_id}
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Node rename / move (called by AGFS puppyonefs, etc.)
# ============================================================

@router.post(
    "/nodes/rename",
    summary="Rename file or directory (via ProductOperationAdapter)",
    description="Rename by moving paths",
    dependencies=[Depends(verify_internal_secret)],
)
async def rename_node(
    payload: Dict[str, Any],
    request: Request,
):
    try:
        project_id = payload.get("project_id", "")
        _enforce_acting_user_project_access(request, project_id)
        path = payload.get("path", "").strip("/")
        new_name = payload.get("new_name", "")
        if not new_name:
            raise HTTPException(status_code=400, detail="new_name is required")
        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        parent = "/".join(path.split("/")[:-1])
        new_path = f"{parent}/{new_name}" if parent else new_name

        commands = _create_write_commands()
        await commands.move(
            project_id,
            path,
            new_path,
            actor="system",
            message=f"rename {path} → {new_path}",
        )

        return {"path": new_path, "name": new_name, "renamed": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/move",
    summary="Move file or directory to new path (via ProductOperationAdapter)",
    description="Move file/directory to a new parent directory",
    dependencies=[Depends(verify_internal_secret)],
)
async def move_node_internal(
    payload: Dict[str, Any],
    request: Request,
):
    try:
        project_id = payload.get("project_id", "")
        _enforce_acting_user_project_access(request, project_id)
        path = payload.get("path", "").strip("/")
        new_parent_path = payload.get("new_parent_path", "").strip("/")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        name = path.split("/")[-1]
        new_path = f"{new_parent_path}/{name}" if new_parent_path else name

        commands = _create_write_commands()
        await commands.move(
            project_id,
            path,
            new_path,
            actor="system",
            message=f"move {path} → {new_path}",
        )

        return {"old_path": path, "new_path": new_path, "moved": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Agent internal endpoints (called by mcp_service, new architecture)
# ============================================================

def _resolve_agent_via_connectors(mcp_api_key: str) -> dict:
    """Resolve an MCP key through the canonical connectors/repo_scopes model."""

    from src.repo.connector_service import ConnectorService
    from src.repo.scope_repository import RepoScopeRepository

    connector = ConnectorService().get_agent_by_mcp_key(mcp_api_key)
    if connector is None:
        raise HTTPException(status_code=404, detail="Agent not found for this MCP API key")

    # Connectors don't have first-class tools/bash_accesses today; the
    # agent's bound scope IS its access scope. We return one access
    # entry per scope (the connector's bound scope), letting the MCP
    # service render its tool list against that scope.
    scope = RepoScopeRepository().get(connector.scope_id)
    accesses_data: list[dict] = []
    if scope is not None:
        is_writable = scope.mode == "rw"
        accesses_data.append({
            "path": scope.path,
            "bash_enabled": True,
            "bash_readonly": not is_writable,
            "tool_query": True,
            "tool_create": is_writable,
            "tool_update": is_writable,
            "tool_delete": is_writable,
            "json_path": "",
            "node_name": scope.name,
            "node_type": "folder",
        })

    return {
        "agent": {
            "id": connector.id,
            "name": connector.name,
            "project_id": connector.project_id,
            # Connector-backed in-app agents expose the chat runtime.
            "type": "chat",
            "user_id": connector.created_by or "",
        },
        "accesses": accesses_data,
        # Agent-scoped tool grants are derived from the bound repo scope.
        # No secondary agent/access table is consulted here.
        "tools": [],
    }


@router.get(
    "/agent-by-mcp-key/{mcp_api_key}",
    summary="Get Agent and its access permissions and tools by MCP API key",
    description="MCP Server calls this endpoint to get Agent configuration for generating tool lists",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_agent_by_mcp_key(
    mcp_api_key: str,
):
    """Resolve an MCP API key to an agent's config + tools + accesses.

    The canonical source of truth is ``connectors`` rows with
    provider='agent' and ``config.mcp_api_key``. Missing or unhealthy
    connector state fails loud instead of consulting historical tables.
    """
    return _resolve_agent_via_connectors(mcp_api_key)


@router.get(
    "/mcp-endpoint-by-key/{api_key}",
    summary="Get standalone MCP endpoint configuration by API key",
    description="MCP Server calls this endpoint to get standalone MCP Endpoint configuration",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_mcp_endpoint_by_key(api_key: str):
    from src.connectors.mcp_endpoint.repository import McpEndpointRepository

    repo = McpEndpointRepository()
    endpoint = repo.get_by_api_key(api_key)
    if not endpoint:
        raise HTTPException(status_code=404, detail="MCP endpoint not found for this API key")
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="MCP endpoint is not active")

    accesses_data = []
    for a in endpoint.get("accesses", []):
        entry = {
            "path": a.get("path", ""),
            "bash_enabled": True,
            "bash_readonly": a.get("readonly", True),
            "tool_query": True,
            "tool_create": not a.get("readonly", True),
            "tool_update": not a.get("readonly", True),
            "tool_delete": not a.get("readonly", True),
            "json_path": a.get("json_path", ""),
            "node_name": a.get("path", ""),
            "node_type": "",
        }
        accesses_data.append(entry)

    tool_repo = ToolRepositorySupabase(get_supabase_repository())
    tools_data = []
    for t in endpoint.get("tools_config", []):
        tool = tool_repo.get_by_id(t.get("tool_id", ""))
        if tool and t.get("enabled", True):
            tools_data.append({
                "id": t.get("tool_id"),
                "tool_id": tool.id,
                "name": tool.name,
                "type": tool.type,
                "description": tool.description,
                "path": tool.path,
                "json_path": tool.json_path,
                "input_schema": tool.input_schema,
                "category": tool.category,
                "enabled": True,
                "mcp_exposed": True,
            })

    return {
        "endpoint": {
            "id": endpoint["id"],
            "name": endpoint["name"],
            "project_id": endpoint["project_id"],
        },
        "accesses": accesses_data,
        "tools": tools_data,
    }


@router.get(
    "/sandbox-endpoint-by-key/{access_key}",
    summary="Get standalone Sandbox endpoint configuration by access key",
    description="External consumers call this to get Sandbox endpoint mounts, runtime, and other configuration before execution",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_sandbox_endpoint_by_key(access_key: str):
    from src.connectors.sandbox_endpoint.repository import SandboxEndpointRepository

    repo = SandboxEndpointRepository()
    endpoint = repo.get_by_access_key(access_key)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Sandbox endpoint not found for this access key")
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="Sandbox endpoint is not active")

    mounts_data = []
    for m in endpoint.get("mounts", []):
        entry = {
            "path": m.get("path", ""),
            "mount_path": m.get("mount_path", "/workspace"),
            "permissions": m.get("permissions", {"read": True, "write": False, "exec": False}),
            "node_name": m.get("path", ""),
            "node_type": "",
        }
        mounts_data.append(entry)

    return {
        "endpoint": {
            "id": endpoint["id"],
            "name": endpoint["name"],
            "project_id": endpoint["project_id"],
            "runtime": endpoint.get("runtime", "alpine"),
            "provider": endpoint.get("provider", "docker"),
            "timeout_seconds": endpoint.get("timeout_seconds", 30),
            "resource_limits": endpoint.get("resource_limits", {}),
        },
        "mounts": mounts_data,
    }

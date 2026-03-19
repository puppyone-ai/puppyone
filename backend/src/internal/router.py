"""
Internal API路由
供内部服务（如MCP Server）调用，使用SECRET鉴权
"""

import hmac
import json as json_lib

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from typing import Optional, Dict, Any, List
from src.content.table.dependencies import get_table_service
from src.config import settings
from src.exceptions import AppException, NotFoundException, BusinessException
from src.infra.supabase.dependencies import get_supabase_repository
from src.infra.turbopuffer.internal_router import router as turbopuffer_internal_router
from src.infra.search.dependencies import get_search_service
from src.infra.search.schemas import SearchToolQueryInput, SearchToolQueryResponse
from src.connectors.agent.config.service import AgentConfigService
from src.connectors.agent.config.repository import AgentRepository
from src.tool.repository import ToolRepositorySupabase
from src.tool.models import Tool
from src.mut_engine.dependencies import get_tree_reader
from src.mut_engine.tree_reader import MutTreeReader

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


# ============================================================
# Turbopuffer internal debug endpoints
# ============================================================
router.include_router(
    turbopuffer_internal_router,
    dependencies=[Depends(verify_internal_secret)],
)


@router.get(
    "/table/{table_id}",
    summary="获取表格元数据",
    description="根据table_id获取表格的元数据（不包含数据内容）",
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
# 新版 internal 端点（命名更规范，参数更清晰）
# ============================================================


@router.get(
    "/tables/{table_id}/context-schema",
    summary="获取表格挂载点数据结构",
    description="根据 table_id + json_path（JSON Pointer）获取结构（不包含实际值）",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_table_context_schema(
    table_id: str,
    json_path: str = Query(default="", description="挂载点 JSON Pointer 路径"),
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
    summary="获取表格挂载点数据（可选JMESPath查询）",
    description="根据 table_id + json_path 获取数据；如传 query 则在该数据上做 JMESPath 查询",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_table_context_data(
    table_id: str,
    json_path: str = Query(default="", description="挂载点 JSON Pointer 路径"),
    query: Optional[str] = Query(
        default=None, description="JMESPath 查询表达式（可选）"
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
    summary="在挂载点批量创建元素",
    description="根据 table_id + json_path 在挂载点创建元素；挂载点是 dict 时按 key 写入，list 时按顺序追加 content",
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
        return {"message": "创建成功", "data": data}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/tables/{table_id}/context-data",
    summary="在挂载点批量更新元素",
    description="根据 table_id + json_path 更新元素；dict 时按 key 替换，list 时 key 视为下标替换",
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
        return {"message": "更新成功", "data": data}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete(
    "/tables/{table_id}/context-data",
    summary="在挂载点批量删除元素",
    description="根据 table_id + json_path 删除 keys；dict 时按 key 删除，list 时 key 视为下标删除",
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
        return {"message": "删除成功", "data": data}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Search Tool internal endpoints（供 mcp_service v2 调用）
# ============================================================


@router.post(
    "/tools/{tool_id}/search",
    response_model=SearchToolQueryResponse,
    summary="执行 Search Tool（ANN retrieval）",
    description=(
        "根据 tool_id 执行语义向量检索（ANN），返回结构化结果。\n\n"
        "给前端/调用方的关键点：\n"
        "- 该端点为 Internal API，需要 `X-Internal-Secret` 鉴权；\n"
        "- tool 必须是 `type=search`，且必须绑定 `node_id`；\n"
        "- 返回的 `results[*].json_path` 为 **相对于 tool.json_path 的 RFC6901 路径**，便于前端在 scope 内定位。"
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

    node_id = tool.node_id or ""
    if not node_id:
        raise HTTPException(status_code=400, detail="tool.node_id is missing")

    project_id = tool.project_id or ""
    if not project_id:
        raise HTTPException(status_code=400, detail="tool.project_id is missing")

    try:
        from src.infra.search.index_task_repository import SearchIndexTaskRepository
        from src.infra.supabase.client import SupabaseClient
        
        sb_client = SupabaseClient().get_client()
        task_repo = SearchIndexTaskRepository(sb_client)
        task = task_repo.get_by_tool_id(str(tool_id))
        
        is_folder_search = bool(task and task.folder_node_id)
    except Exception:
        is_folder_search = False

    try:
        if is_folder_search:
            results = await search_service.search_folder(
                project_id=project_id,
                folder_node_id=node_id,
                query=payload.query,
                top_k=payload.top_k,
            )
        else:
            results = await search_service.search_scope(
                project_id=project_id,
                node_id=node_id,
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
# ContentNode POSIX endpoints（供 mcp_service POSIX 工具调用）
# All path-based, using MutEphemeralClient (MUT protocol)
# ============================================================


def _make_mcp_client(project_id: str, operator_id: str = "mcp_agent"):
    """Create a MutEphemeralClient for MCP/internal operations."""
    from src.mut_engine.dependencies import create_ephemeral_client
    auth_context = {
        "agent": operator_id,
        "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
    }
    return create_ephemeral_client(project_id, auth_context)


@router.post(
    "/nodes/resolve-path",
    summary="解析路径到节点信息",
    description="根据 project_id + path 解析到具体节点信息",
    dependencies=[Depends(verify_internal_secret)],
)
async def resolve_node_path(
    payload: Dict[str, Any],
    reader: MutTreeReader = Depends(get_tree_reader),
):
    try:
        project_id = payload.get("project_id", "")
        path = payload.get("path", "")

        if not path or path == "/":
            return {"virtual_root": True, "path": "/"}

        path = path.strip("/")
        entry = reader.stat(project_id, path)
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
    summary="列出目录内容",
    description="列出指定路径的子条目（含元信息）",
    dependencies=[Depends(verify_internal_secret)],
)
async def list_node_children(
    project_id: str = Query(..., description="项目 ID"),
    path: str = Query("", description="目录路径"),
    reader: MutTreeReader = Depends(get_tree_reader),
):
    try:
        path = path.strip("/")
        entries = reader.list_dir(project_id, path)
        entries = [e for e in entries if e.name != ".trash"]

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
    summary="读取文件内容",
    description="根据路径和类型返回 JSON 内容 / Markdown 文本 / 文件元信息",
    dependencies=[Depends(verify_internal_secret)],
)
async def read_node_content(
    project_id: str = Query(..., description="项目 ID"),
    path: str = Query(..., description="文件路径"),
    reader: MutTreeReader = Depends(get_tree_reader),
):
    try:
        path = path.strip("/")
        entry = reader.stat(project_id, path)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        base = {
            "name": entry.name,
            "path": entry.path,
            "type": entry.type,
            "size_bytes": entry.size_bytes,
        }

        if entry.type == "folder":
            children = reader.list_dir(project_id, path)
            children = [c for c in children if c.name != ".trash"]
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

        content_bytes = reader.read_file(project_id, path)

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
    summary="写入文件内容（via MUT Protocol）",
    description="创建或更新文件内容",
    dependencies=[Depends(verify_internal_secret)],
)
async def write_node_content(
    payload: Dict[str, Any],
):
    """
    写入文件内容 via MUT protocol (MutEphemeralClient).

    payload:
        project_id: str
        path: str
        content: Any (JSON 对象或 Markdown 字符串)
        operator_id: str (可选)
    """
    try:
        import asyncio
        project_id = payload.get("project_id", "")
        path = payload.get("path", "").strip("/")
        content = payload.get("content")
        operator_id = payload.get("operator_id", "mcp_agent")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        if isinstance(content, str):
            content_bytes = content.encode("utf-8")
        elif isinstance(content, (dict, list)):
            import json
            content_bytes = json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported content type: {type(content).__name__}")

        client = _make_mcp_client(project_id, operator_id)
        await asyncio.to_thread(client.clone)
        result = await asyncio.to_thread(
            client.push,
            modified={path: content_bytes},
            message=f"Write {path}",
        )

        return {
            "path": path,
            "version": result.get("version", 0),
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
    summary="创建文件或目录（via MUT Protocol）",
    description="在指定路径创建新文件（JSON / Markdown）或空目录",
    dependencies=[Depends(verify_internal_secret)],
)
async def create_node(
    payload: Dict[str, Any],
):
    """
    创建文件/目录 via MUT protocol (MutEphemeralClient).

    payload:
        project_id: str
        path: str
        node_type: str (json | markdown | folder)
        content: Any (可选)
        created_by: str (可选)
    """
    try:
        import asyncio
        project_id = payload.get("project_id", "")
        path = payload.get("path", "").strip("/")
        node_type = payload.get("node_type", "")
        content = payload.get("content")
        created_by = payload.get("created_by", "mcp_agent")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        if node_type not in ("json", "markdown", "folder"):
            raise HTTPException(status_code=400, detail=f"Unsupported node type for creation: {node_type}")

        client = _make_mcp_client(project_id, created_by)
        await asyncio.to_thread(client.clone)

        if node_type == "folder":
            result = await asyncio.to_thread(
                client.push,
                modified={f"{path}/.keep": b""},
                message=f"mkdir {path}",
            )
        else:
            if content is None:
                content = {} if node_type == "json" else ""

            if isinstance(content, str):
                content_bytes = content.encode("utf-8")
            else:
                import json
                content_bytes = json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")

            result = await asyncio.to_thread(
                client.push,
                modified={path: content_bytes},
                message=f"Create {path}",
            )

        return {
            "path": path,
            "created": True,
            "version": result.get("version", 0),
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/trash",
    summary="软删除（via MUT Protocol）",
    description="将文件或目录移入 .trash",
    dependencies=[Depends(verify_internal_secret)],
)
async def trash_node(
    payload: Dict[str, Any],
    reader: MutTreeReader = Depends(get_tree_reader),
):
    """
    软删除：移入 .trash via MUT protocol.

    payload:
        project_id: str
        path: str
        user_id: str
    """
    try:
        import asyncio
        import time as _time
        project_id = payload.get("project_id", "")
        path = payload.get("path", "").strip("/")
        user_id = payload.get("user_id", "mcp_agent")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        basename = path.rsplit("/", 1)[-1] if "/" in path else path
        trash_path = f".trash/{basename}_{int(_time.time())}"

        client = _make_mcp_client(project_id, user_id)
        files = await asyncio.to_thread(client.clone)

        modified: Dict[str, bytes] = {}
        deleted: list[str] = []

        entry = reader.stat(project_id, path)
        if entry and entry.type == "folder":
            prefix = path + "/"
            for fpath, content in files.items():
                if fpath == path or fpath.startswith(prefix):
                    suffix = fpath[len(path):]
                    modified[trash_path + suffix] = content
                    deleted.append(fpath)
        else:
            content = files.get(path, b"")
            modified[trash_path] = content
            deleted.append(path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=f"trash {basename}",
        )

        return {"path": path, "removed": True, "message": "Moved to trash"}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Node rename / move（供 AGFS puppyonefs 等调用）
# ============================================================

@router.post(
    "/nodes/rename",
    summary="重命名文件或目录（via MUT Protocol）",
    description="移动路径来实现重命名",
    dependencies=[Depends(verify_internal_secret)],
)
async def rename_node(
    payload: Dict[str, Any],
    reader: MutTreeReader = Depends(get_tree_reader),
):
    try:
        import asyncio
        project_id = payload.get("project_id", "")
        path = payload.get("path", "").strip("/")
        new_name = payload.get("new_name", "")
        if not new_name:
            raise HTTPException(status_code=400, detail="new_name is required")
        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        parent = "/".join(path.split("/")[:-1])
        new_path = f"{parent}/{new_name}" if parent else new_name

        entry = reader.stat(project_id, path)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        client = _make_mcp_client(project_id, "system")
        files = await asyncio.to_thread(client.clone)

        modified: Dict[str, bytes] = {}
        deleted: list[str] = []

        if entry.type == "folder":
            prefix = path + "/"
            for fpath, content in files.items():
                if fpath == path or fpath.startswith(prefix):
                    suffix = fpath[len(path):]
                    modified[new_path + suffix] = content
                    deleted.append(fpath)
        else:
            content = files.get(path, b"")
            modified[new_path] = content
            deleted.append(path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=f"rename {path} → {new_path}",
        )

        return {"path": new_path, "name": new_name, "renamed": True}
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/move",
    summary="移动文件或目录到新路径（via MUT Protocol）",
    description="移动文件/目录到新的父目录下",
    dependencies=[Depends(verify_internal_secret)],
)
async def move_node_internal(
    payload: Dict[str, Any],
    reader: MutTreeReader = Depends(get_tree_reader),
):
    try:
        import asyncio
        project_id = payload.get("project_id", "")
        path = payload.get("path", "").strip("/")
        new_parent_path = payload.get("new_parent_path", "").strip("/")

        if not path:
            raise HTTPException(status_code=400, detail="path is required")

        name = path.split("/")[-1]
        new_path = f"{new_parent_path}/{name}" if new_parent_path else name

        entry = reader.stat(project_id, path)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        client = _make_mcp_client(project_id, "system")
        files = await asyncio.to_thread(client.clone)

        modified: Dict[str, bytes] = {}
        deleted: list[str] = []

        if entry.type == "folder":
            prefix = path + "/"
            for fpath, content in files.items():
                if fpath == path or fpath.startswith(prefix):
                    suffix = fpath[len(path):]
                    modified[new_path + suffix] = content
                    deleted.append(fpath)
        else:
            content = files.get(path, b"")
            modified[new_path] = content
            deleted.append(path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=f"move {path} → {new_path}",
        )

        return {"old_path": path, "new_path": new_path, "moved": True}
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Agent internal endpoints（供 mcp_service 调用，新架构）
# ============================================================

def get_agent_config_service() -> AgentConfigService:
    return AgentConfigService(AgentRepository())


@router.get(
    "/agent-by-mcp-key/{mcp_api_key}",
    summary="根据 MCP API key 获取 Agent 及其访问权限和工具",
    description="MCP Server 调用此端点获取 Agent 配置，用于生成工具列表",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_agent_by_mcp_key(
    mcp_api_key: str,
    agent_service: AgentConfigService = Depends(get_agent_config_service),
):
    agent = agent_service.get_by_mcp_api_key(mcp_api_key)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found for this MCP API key")
    
    tool_repo = ToolRepositorySupabase(get_supabase_repository())
    tools_data = []
    for agent_tool in agent.tools:
        tool = tool_repo.get_by_id(agent_tool.tool_id)
        if tool:
            tools_data.append({
                "id": agent_tool.id,
                "tool_id": tool.id,
                "name": tool.name,
                "type": tool.type,
                "description": tool.description,
                "node_id": tool.node_id,
                "json_path": tool.json_path,
                "input_schema": tool.input_schema,
                "category": tool.category,
                "enabled": agent_tool.enabled,
                "mcp_exposed": agent_tool.mcp_exposed,
            })
    
    accesses_data = []
    for bash in agent.bash_accesses:
        access_entry = {
            "node_id": bash.node_id,
            "bash_enabled": True,
            "bash_readonly": bash.readonly,
            "tool_query": True,
            "tool_create": not bash.readonly,
            "tool_update": not bash.readonly,
            "tool_delete": not bash.readonly,
            "json_path": bash.json_path or "",
            "node_name": bash.node_id,
            "node_type": "",
        }
        accesses_data.append(access_entry)

    return {
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "project_id": agent.project_id,
            "type": agent.type,
        },
        "accesses": accesses_data,
        "tools": tools_data,
    }


@router.get(
    "/mcp-endpoint-by-key/{api_key}",
    summary="根据 API key 获取独立 MCP 端点配置",
    description="MCP Server 调用此端点获取独立 MCP Endpoint 配置",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_mcp_endpoint_by_key(api_key: str):
    from src.endpoints.mcp.repository import McpEndpointRepository

    repo = McpEndpointRepository()
    endpoint = repo.get_by_api_key(api_key)
    if not endpoint:
        raise HTTPException(status_code=404, detail="MCP endpoint not found for this API key")
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="MCP endpoint is not active")

    accesses_data = []
    for a in endpoint.get("accesses", []):
        entry = {
            "node_id": a.get("node_id", ""),
            "bash_enabled": True,
            "bash_readonly": a.get("readonly", True),
            "tool_query": True,
            "tool_create": not a.get("readonly", True),
            "tool_update": not a.get("readonly", True),
            "tool_delete": not a.get("readonly", True),
            "json_path": a.get("json_path", ""),
            "node_name": a.get("node_id", ""),
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
                "node_id": tool.node_id,
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
    summary="根据 access key 获取独立 Sandbox 端点配置",
    description="外部消费者调用执行前，先获取 Sandbox 端点的 mounts、runtime 等配置",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_sandbox_endpoint_by_key(access_key: str):
    from src.endpoints.sandbox.repository import SandboxEndpointRepository

    repo = SandboxEndpointRepository()
    endpoint = repo.get_by_access_key(access_key)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Sandbox endpoint not found for this access key")
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="Sandbox endpoint is not active")

    mounts_data = []
    for m in endpoint.get("mounts", []):
        entry = {
            "node_id": m.get("node_id", ""),
            "mount_path": m.get("mount_path", "/workspace"),
            "permissions": m.get("permissions", {"read": True, "write": False, "exec": False}),
            "node_name": m.get("node_id", ""),
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

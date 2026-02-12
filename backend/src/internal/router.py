"""
Internal API路由
供内部服务（如MCP Server）调用，使用SECRET鉴权
"""

import hmac
import json as json_lib

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from typing import Optional, Dict, Any, List
from src.table.dependencies import get_table_service
from src.config import settings
from src.exceptions import AppException, NotFoundException, BusinessException
from src.supabase.dependencies import get_supabase_repository
from src.turbopuffer.internal_router import router as turbopuffer_internal_router
from src.search.dependencies import get_search_service
from src.search.schemas import SearchToolQueryInput, SearchToolQueryResponse
from src.agent.config.service import AgentConfigService
from src.agent.config.repository import AgentRepository
from src.tool.repository import ToolRepositorySupabase
from src.tool.models import Tool
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService

router = APIRouter(prefix="/internal", tags=["internal"])


async def verify_internal_secret(x_internal_secret: str = Header(...)) -> None:
    """
    验证Internal API的SECRET

    Args:
        x_internal_secret: X-Internal-Secret header

    Raises:
        HTTPException: 如果SECRET无效
    """
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
# - 仅内部调试使用：统一复用 X-Internal-Secret 鉴权
# ============================================================
router.include_router(
    turbopuffer_internal_router,
    dependencies=[Depends(verify_internal_secret)],
)


# ============================================================
# 已废弃的端点（V2 和 Legacy 模式已移除，只保留 Agent 模式）
# /mcp-instance/{api_key} - Legacy 模式，已移除
# /mcp-v2/{api_key} - V2 模式，已移除
# ============================================================


@router.get(
    "/table/{table_id}",
    summary="获取表格元数据",
    description="根据table_id获取表格的元数据（不包含数据内容）",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_table_metadata(table_id: str, table_service=Depends(get_table_service)):
    """
    获取表格元数据

    Args:
        table_id: 表格ID

    Returns:
        表格元数据
    """
    table = table_service.get_by_id(table_id)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    return {
        # 兼容字段：历史上有的客户端使用 id，有的使用 table_id
        "id": table.id,
        "table_id": table.id,
        "name": table.name,
        "description": table.description,
        "project_id": table.project_id,
    }


# ============================================================
# 新版 internal 端点（命名更规范，参数更清晰）
# - json_path: 挂载点（JSON Pointer），对应 mcp_instance 的职责范围
# - query: JMESPath 查询表达式
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
        # 让 internal 调用方获得正确的 HTTP status（尤其是 404/400），便于排查 json_path 问题
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
        # NotFoundException/BusinessException 等需要保留语义，否则 MCP 侧只会看到 500
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
        data = table_service.create_context_data(
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
        data = table_service.update_context_data(
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
        data = table_service.delete_context_data(
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

    # 根据节点类型选择搜索方式：
    # - 如果 search_index_task 有 folder_node_id，说明是 folder search
    # - 否则是 scope (JSON) search
    try:
        from src.search.index_task_repository import SearchIndexTaskRepository
        from src.supabase.client import SupabaseClient
        
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


# @router.post(
#     "/table-data/{table_id}/create",
#     summary="创建表格数据",
#     description="在指定表格和路径下创建数据",
#     dependencies=[Depends(verify_internal_secret)]
# )
# async def create_table_data(
#     table_id: int,
#     payload: Dict[str, Any],
#     table_service = Depends(get_table_service)
# ):
#     """
#     创建表格数据

#     Args:
#         table_id: 表格ID
#         payload: 请求体，包含json_pointer和elements

#     Returns:
#         操作结果
#     """
#     try:
#         json_pointer = payload.get("json_pointer", "")
#         elements = payload.get("elements", [])

#         table_service.create_context_data(
#             table_id=table_id,
#             mounted_json_pointer_path=json_pointer,
#             elements=elements
#         )

#         return {"message": "创建成功"}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# @router.post(
#     "/table-data/{table_id}/update",
#     summary="更新表格数据",
#     description="更新指定表格和路径下的数据",
#     dependencies=[Depends(verify_internal_secret)]
# )
# async def update_table_data(
#     table_id: int,
#     payload: Dict[str, Any],
#     table_service = Depends(get_table_service)
# ):
#     """
#     更新表格数据

#     Args:
#         table_id: 表格ID
#         payload: 请求体，包含json_pointer和elements

#     Returns:
#         操作结果
#     """
#     try:
#         json_pointer = payload.get("json_pointer", "")
#         elements = payload.get("elements", [])

#         table_service.update_context_data(
#             table_id=table_id,
#             json_pointer_path=json_pointer,
#             elements=elements
#         )

#         return {"message": "更新成功"}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# @router.post(
#     "/table-data/{table_id}/delete",
#     summary="删除表格数据",
#     description="删除指定表格和路径下的数据",
#     dependencies=[Depends(verify_internal_secret)]
# )
# async def delete_table_data(
#     table_id: int,
#     payload: Dict[str, Any],
#     table_service = Depends(get_table_service)
# ):
#     """
#     删除表格数据

#     Args:
#         table_id: 表格ID
#         payload: 请求体，包含json_pointer和keys

#     Returns:
#         操作结果
#     """
#     try:
#         json_pointer = payload.get("json_pointer", "")
#         keys = payload.get("keys", [])

#         table_service.delete_context_data(
#             table_id=table_id,
#             json_pointer_path=json_pointer,
#             keys=keys
#         )

#         return {"message": "删除成功"}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# ContentNode POSIX endpoints（供 mcp_service POSIX 工具调用）
# ============================================================


@router.post(
    "/nodes/resolve-path",
    summary="解析人类可读路径到节点",
    description="根据 project_id + root_accesses + path 解析到具体节点",
    dependencies=[Depends(verify_internal_secret)],
)
async def resolve_node_path(
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    路径解析：人类可读路径 -> node_id + 元信息
    
    payload:
        project_id: str
        root_accesses: list[{node_id, node_name, node_type}]
        path: str (如 "/docs/readme.md")
    """
    try:
        project_id = payload.get("project_id", "")
        root_accesses = payload.get("root_accesses", [])
        path = payload.get("path", "/")

        node = node_service.resolve_path(project_id, root_accesses, path)
        display_path = node_service.build_display_path(node, root_accesses)

        return {
            "node_id": node.id,
            "name": node.name,
            "type": node.type,
            "path": display_path,
            "parent_id": node.parent_id,
            "size_bytes": node.size_bytes,
            "mime_type": node.mime_type,
            "updated_at": node.updated_at.isoformat() if node.updated_at else None,
        }
    except BusinessException as e:
        if e.message == "VIRTUAL_ROOT":
            # 虚拟根标记 — 告知调用方这是虚拟根目录
            return {"virtual_root": True, "path": "/"}
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/nodes/{node_id}/children",
    summary="列出子节点",
    description="列出指定节点的子节点（含 display_path 等元信息）",
    dependencies=[Depends(verify_internal_secret)],
)
async def list_node_children(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """列出子节点，过滤 .trash"""
    try:
        children = node_service.list_children(project_id, node_id)
        # 过滤掉 .trash 文件夹
        children = [c for c in children if c.name != ContentNodeService.TRASH_FOLDER_NAME]

        return {
            "parent_id": node_id,
            "children": [
                {
                    "node_id": c.id,
                    "name": c.name,
                    "type": c.type,
                    "size_bytes": c.size_bytes,
                    "mime_type": c.mime_type,
                    "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                    "parent_id": c.parent_id,
                }
                for c in children
            ],
        }
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/nodes/{node_id}/content",
    summary="读取节点内容",
    description="根据节点类型返回 JSON 内容 / Markdown 文本 / 文件元信息",
    dependencies=[Depends(verify_internal_secret)],
)
async def read_node_content(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """读取节点内容（按类型分发）"""
    try:
        node = node_service.get_by_id(node_id, project_id)

        base = {
            "node_id": node.id,
            "name": node.name,
            "type": node.type,
            "size_bytes": node.size_bytes,
            "updated_at": node.updated_at.isoformat() if node.updated_at else None,
        }

        if node.is_json or (node.preview_json is not None and not node.is_folder):
            base["content"] = node.preview_json
            return base

        if node.is_markdown or node.preview_md is not None:
            base["content"] = node.preview_md
            return base

        if node.s3_key:
            # 二进制文件 — 返回元信息 + presigned download URL
            download_url = await node_service.get_download_url(node_id, project_id)
            base["mime_type"] = node.mime_type
            base["download_url"] = download_url
            return base

        if node.is_folder:
            # 文件夹 — 返回子节点列表
            children = node_service.list_children(project_id, node_id)
            children = [c for c in children if c.name != ContentNodeService.TRASH_FOLDER_NAME]
            base["children"] = [
                {
                    "node_id": c.id,
                    "name": c.name,
                    "type": c.type,
                    "size_bytes": c.size_bytes,
                }
                for c in children
            ]
            return base

        # 同步节点等 — 返回 preview_json 如果有
        if node.preview_json is not None:
            base["content"] = node.preview_json
        return base

    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/nodes/{node_id}/content",
    summary="更新节点内容",
    description="更新 JSON 或 Markdown 节点的内容",
    dependencies=[Depends(verify_internal_secret)],
)
async def write_node_content(
    node_id: str,
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    更新节点内容。
    
    payload:
        project_id: str
        content: Any (JSON 对象或 Markdown 字符串)
    """
    try:
        project_id = payload.get("project_id", "")
        content = payload.get("content")
        node = node_service.get_by_id(node_id, project_id)

        if node.is_markdown or node.type == "markdown":
            if not isinstance(content, str):
                raise HTTPException(status_code=400, detail="Markdown content must be a string")
            updated = await node_service.update_markdown_content(node_id, project_id, content)
        elif node.is_json or node.type == "json":
            updated = node_service.update_node(node_id, project_id, preview_json=content)
        elif node.preview_json is not None:
            # 同步节点等带 preview_json 的节点
            updated = node_service.update_node(node_id, project_id, preview_json=content)
        elif node.preview_md is not None:
            if not isinstance(content, str):
                raise HTTPException(status_code=400, detail="Markdown content must be a string")
            updated = await node_service.update_markdown_content(node_id, project_id, content)
        else:
            raise HTTPException(status_code=400, detail=f"Cannot write to node type: {node.type}")

        return {
            "node_id": updated.id,
            "name": updated.name,
            "type": updated.type,
            "updated": True,
            "updated_at": updated.updated_at.isoformat() if updated.updated_at else None,
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/create",
    summary="创建节点",
    description="在指定父目录下创建新节点（JSON / Markdown / Folder）",
    dependencies=[Depends(verify_internal_secret)],
)
async def create_node(
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    创建节点。
    
    payload:
        project_id: str
        parent_id: str
        name: str
        node_type: str (json | markdown | folder)
        content: Any (可选, JSON 对象或 Markdown 字符串)
        created_by: str (可选)
    """
    try:
        project_id = payload.get("project_id", "")
        parent_id = payload.get("parent_id")
        name = payload.get("name", "")
        node_type = payload.get("node_type", "")
        content = payload.get("content")
        created_by = payload.get("created_by")

        if node_type == "folder":
            node = node_service.create_folder(project_id, name, parent_id, created_by)
        elif node_type == "json":
            node = node_service.create_json_node(project_id, name, content or {}, parent_id, created_by)
        elif node_type == "markdown":
            content_str = content if isinstance(content, str) else ""
            node = await node_service.create_markdown_node(project_id, name, content_str, parent_id, created_by)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported node type for creation: {node_type}")

        return {
            "node_id": node.id,
            "name": node.name,
            "type": node.type,
            "created": True,
            "parent_id": node.parent_id,
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/{node_id}/trash",
    summary="软删除节点（移入废纸篓）",
    description="将节点移入 .trash 文件夹（可恢复的软删除）",
    dependencies=[Depends(verify_internal_secret)],
)
async def trash_node(
    node_id: str,
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    软删除：移入 .trash
    
    payload:
        project_id: str
        user_id: str
    """
    try:
        project_id = payload.get("project_id", "")
        user_id = payload.get("user_id", "system")

        node_service.soft_delete_node(node_id, project_id, user_id)
        return {"node_id": node_id, "removed": True, "message": "Moved to trash"}
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================
# Node rename / move / prepare-upload（供 AGFS puppyonefs 等调用）
# ============================================================

@router.post(
    "/nodes/{node_id}/rename",
    summary="重命名节点",
    description="修改节点名称（不影响 id_path）",
    dependencies=[Depends(verify_internal_secret)],
)
async def rename_node(
    node_id: str,
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    重命名节点

    payload:
        project_id: str
        new_name: str
    """
    try:
        project_id = payload.get("project_id", "")
        new_name = payload.get("new_name", "")
        if not new_name:
            raise HTTPException(status_code=400, detail="new_name is required")
        updated = node_service.update_node(node_id, project_id, name=new_name)
        return {"node_id": updated.id, "name": updated.name, "renamed": True}
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/{node_id}/move",
    summary="移动节点到新父目录",
    description="将节点移动到另一个文件夹下（递归更新子节点 id_path）",
    dependencies=[Depends(verify_internal_secret)],
)
async def move_node_internal(
    node_id: str,
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    移动节点

    payload:
        project_id: str
        new_parent_id: str | None  (None 表示移动到项目根)
    """
    try:
        project_id = payload.get("project_id", "")
        new_parent_id = payload.get("new_parent_id")
        updated = node_service.move_node(node_id, project_id, new_parent_id)
        return {"node_id": updated.id, "parent_id": updated.parent_id, "moved": True}
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/prepare-upload",
    summary="准备文件上传（获取 presigned URL）",
    description="创建 file 类型节点并返回 S3 presigned upload URL",
    dependencies=[Depends(verify_internal_secret)],
)
async def prepare_upload(
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    准备上传

    payload:
        project_id: str
        name: str
        content_type: str (可选，默认 application/octet-stream)
        parent_id: str | None (可选)
    """
    try:
        project_id = payload.get("project_id", "")
        name = payload.get("name", "")
        content_type = payload.get("content_type", "application/octet-stream")
        parent_id = payload.get("parent_id")

        if not name:
            raise HTTPException(status_code=400, detail="name is required")

        node, upload_url = await node_service.prepare_file_upload(
            project_id=project_id,
            name=name,
            content_type=content_type,
            parent_id=parent_id,
        )
        return {
            "node_id": node.id,
            "upload_url": upload_url,
            "s3_key": node.s3_key,
        }
    except HTTPException:
        raise
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/nodes/{node_id}/reupload-url",
    summary="获取已有 S3 文件节点的重新上传 URL",
    description="为已有的 file 类型节点生成新的 presigned upload URL（覆盖原有 S3 对象）",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_reupload_url(
    node_id: str,
    payload: Dict[str, Any],
    node_service: ContentNodeService = Depends(get_content_node_service),
):
    """
    获取已有文件节点的 presigned upload URL，用于覆盖更新文件内容。

    payload:
        project_id: str
        content_type: str (可选，默认 application/octet-stream)
    """
    try:
        project_id = payload.get("project_id", "")
        content_type = payload.get("content_type", "application/octet-stream")

        node = node_service.get_by_id(node_id, project_id)
        if not node.s3_key:
            raise HTTPException(status_code=400, detail="Node has no S3 file key")

        upload_url = await node_service.s3.generate_presigned_upload_url(
            key=node.s3_key,
            expires_in=3600,
            content_type=content_type,
        )
        return {
            "node_id": node.id,
            "upload_url": upload_url,
            "s3_key": node.s3_key,
        }
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
    """获取 AgentConfigService 实例"""
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
    """
    根据 MCP API key 获取 Agent 及其 bash_accesses 和 tools
    
    返回结构：
    {
        "agent": { id, name, project_id, type },
        "accesses": [
            {
                "node_id": "xxx",
                "bash_enabled": true,
                "bash_readonly": true,
                "tool_query": true,
                "tool_create": false,
                "tool_update": false,
                "tool_delete": false,
                "json_path": ""
            }
        ],
        "tools": [
            {
                "id": "xxx",
                "tool_id": "xxx",
                "name": "tool_name",
                "type": "search",
                "description": "...",
                "node_id": "xxx",
                "json_path": "",
                "input_schema": {...},
                "enabled": true,
                "mcp_exposed": true
            }
        ]
    }
    """
    agent = agent_service.get_by_mcp_api_key(mcp_api_key)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found for this MCP API key")
    
    # 获取关联的 Tool 详细信息
    tool_repo = ToolRepositorySupabase(get_supabase_repository())
    tools_data = []
    for agent_tool in agent.tools:  # agent.tools 已在 get_by_mcp_api_key_with_accesses 中加载
        tool = tool_repo.get_by_id(agent_tool.tool_id)
        if tool:
            tools_data.append({
                "id": agent_tool.id,  # agent_tool 关联 ID
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
    
    # 构建 accesses（包含 node_name 和 node_type）
    from src.content_node.dependencies import get_content_node_repository
    from src.supabase.client import SupabaseClient

    node_repo = get_content_node_repository(SupabaseClient())
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
            "node_name": "",   # 默认值
            "node_type": "",   # 默认值
        }
        # 查询节点获取 name 和 type
        node = node_repo.get_by_id(bash.node_id)
        if node:
            access_entry["node_name"] = node.name
            access_entry["node_type"] = node.type
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

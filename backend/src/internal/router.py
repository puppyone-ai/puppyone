"""
Internal API路由
供内部服务（如MCP Server）调用，使用SECRET鉴权
"""

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from typing import Optional, Dict, Any
from src.mcp.dependencies import get_mcp_instance_service
from src.table.dependencies import get_table_service
from src.config import settings
from src.exceptions import AppException
from src.supabase.dependencies import get_supabase_repository
from src.turbopuffer.internal_router import router as turbopuffer_internal_router
from src.search.dependencies import get_search_service
from src.search.schemas import SearchToolQueryInput, SearchToolQueryResponse

router = APIRouter(prefix="/internal", tags=["internal"])


async def verify_internal_secret(x_internal_secret: str = Header(...)) -> None:
    """
    验证Internal API的SECRET

    Args:
        x_internal_secret: X-Internal-Secret header

    Raises:
        HTTPException: 如果SECRET无效
    """
    if x_internal_secret != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=403, detail="Invalid internal secret")


# ============================================================
# Turbopuffer internal debug endpoints
# - 仅内部调试使用：统一复用 X-Internal-Secret 鉴权
# ============================================================
router.include_router(
    turbopuffer_internal_router,
    dependencies=[Depends(verify_internal_secret)],
)


@router.get(
    "/mcp-instance/{api_key}",
    summary="获取MCP实例数据",
    description="根据API key获取MCP实例的完整数据",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_mcp_instance(api_key: str, mcp_service=Depends(get_mcp_instance_service)):
    """
    获取MCP实例数据

    Args:
        api_key: API key

    Returns:
        MCP实例数据
    """
    instance = await mcp_service.get_mcp_instance_by_api_key(api_key)
    if not instance:
        raise HTTPException(status_code=404, detail="MCP instance not found")

    return {
        "api_key": instance.api_key,
        "user_id": instance.user_id,
        "project_id": instance.project_id,
        "table_id": instance.table_id,
        "json_path": instance.json_path,
        "status": instance.status,
        "tools_definition": instance.tools_definition,
        "register_tools": instance.register_tools,
        "preview_keys": instance.preview_keys,
    }


@router.get(
    "/mcp-v2/{api_key}",
    summary="获取 MCP v2 实例及其绑定工具列表",
    description="根据 api_key 获取 mcp_v2 实例 + 已绑定工具（用于 mcp_service list_tools/call_tool）",
    dependencies=[Depends(verify_internal_secret)],
)
async def get_mcp_v2_instance_and_tools(
    api_key: str,
    supabase_repo=Depends(get_supabase_repository),
):
    """
    返回结构（稳定契约）:
    {
      "mcp_v2": { id, api_key, user_id, name, status },
      "bound_tools": [
        { tool: {...tool fields...}, binding: { id, status } }
      ]
    }
    """
    mcp = supabase_repo.get_mcp_v2_by_api_key(api_key)
    if not mcp:
        raise HTTPException(status_code=404, detail="MCP v2 instance not found")

    bindings = supabase_repo.get_mcp_bindings_by_mcp_id(mcp.id)
    bound_tools = []
    for b in bindings:
        # 默认只返回启用的 binding（禁用的在 mcp_service 不展示，也不允许执行）
        if b.status is False:
            continue
        tool_id = b.tool_id or ""
        if not tool_id:
            continue
        tool = supabase_repo.get_tool(tool_id)
        if not tool:
            continue
        bound_tools.append(
            {
                "tool": tool.model_dump(),
                "binding": {"id": b.id, "status": bool(b.status)},
            }
        )

    return {
        "mcp_v2": {
            "id": mcp.id,
            "api_key": mcp.api_key,
            "user_id": mcp.user_id,
            "name": mcp.name,
            "status": bool(mcp.status),
        },
        "bound_tools": bound_tools,
    }


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
        "- tool 必须是 `type=search`，且必须绑定 `table_id/json_path`；\n"
        "- 返回的 `results[*].json_path` 为 **相对于 tool.json_path 的 RFC6901 路径**，便于前端在 scope 内定位。"
    ),
    dependencies=[Depends(verify_internal_secret)],
)
async def search_tool(
    tool_id: str,
    payload: SearchToolQueryInput,
    supabase_repo=Depends(get_supabase_repository),
    table_service=Depends(get_table_service),
    search_service=Depends(get_search_service),
):
    tool = supabase_repo.get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    if (tool.type or "").strip() != "search":
        raise HTTPException(status_code=400, detail="Tool is not a search tool")

    table_id = tool.table_id or ""
    if not table_id:
        raise HTTPException(status_code=400, detail="tool.table_id is missing")

    table = table_service.get_by_id(table_id)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    try:
        results = await search_service.search_scope(
            project_id=int(table.project_id),
            table_id=table_id,
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

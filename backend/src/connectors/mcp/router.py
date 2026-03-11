from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query

from src.connectors.mcp.service import McpEndpointService
from src.connectors.mcp.schemas import (
    McpEndpointCreate,
    McpEndpointUpdate,
    McpEndpointOut,
)
from src.connectors.mcp.dependencies import (
    get_mcp_endpoint_service,
    get_verified_mcp_endpoint,
)
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse


router = APIRouter(
    prefix="/mcp-endpoints",
    tags=["mcp-endpoints"],
    responses={
        404: {"description": "MCP endpoint not found"},
        403: {"description": "Access denied"},
    },
)


def _to_out(row: dict) -> McpEndpointOut:
    return McpEndpointOut(
        id=row["id"],
        project_id=row["project_id"],
        node_id=row.get("node_id"),
        name=row["name"],
        description=row.get("description"),
        api_key=row["api_key"],
        tools_config=row.get("tools_config", []),
        accesses=row.get("accesses", []),
        config=row.get("config", {}),
        status=row["status"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


@router.get(
    "",
    response_model=ApiResponse[List[McpEndpointOut]],
    summary="列出项目的 MCP 端点",
)
def list_endpoints(
    project_id: str = Query(..., description="项目 ID"),
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
):
    if not service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = service.list_endpoints(project_id)
    return ApiResponse.success(data=[_to_out(r) for r in rows])


@router.get(
    "/{endpoint_id}",
    response_model=ApiResponse[McpEndpointOut],
    summary="获取 MCP 端点详情",
)
def get_endpoint(
    endpoint: dict = Depends(get_verified_mcp_endpoint),
):
    return ApiResponse.success(data=_to_out(endpoint))


@router.get(
    "/by-node/{node_id}",
    response_model=ApiResponse[McpEndpointOut],
    summary="按节点查 MCP 端点",
)
def get_by_node(
    node_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
):
    row = service.get_by_node(node_id)
    if not row:
        raise HTTPException(status_code=404, detail="No MCP endpoint for this node")
    if not service.verify_access(row["id"], current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return ApiResponse.success(data=_to_out(row))


@router.post(
    "",
    response_model=ApiResponse[McpEndpointOut],
    summary="创建 MCP 端点",
)
def create_endpoint(
    payload: McpEndpointCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
):
    if not service.verify_project_access(payload.project_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    row = service.create_endpoint(
        project_id=payload.project_id,
        name=payload.name,
        node_id=payload.node_id,
        description=payload.description,
        accesses=payload.accesses,
        tools_config=payload.tools_config,
    )
    return ApiResponse.success(data=_to_out(row), message="MCP endpoint created")


@router.put(
    "/{endpoint_id}",
    response_model=ApiResponse[McpEndpointOut],
    summary="更新 MCP 端点",
)
def update_endpoint(
    payload: McpEndpointUpdate,
    endpoint: dict = Depends(get_verified_mcp_endpoint),
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
):
    update_kwargs = payload.model_dump(exclude_unset=True)
    row = service.update_endpoint(endpoint["id"], **update_kwargs)
    if not row:
        raise HTTPException(status_code=500, detail="Update failed")
    return ApiResponse.success(data=_to_out(row))


@router.delete(
    "/{endpoint_id}",
    response_model=ApiResponse,
    summary="删除 MCP 端点",
)
def delete_endpoint(
    endpoint: dict = Depends(get_verified_mcp_endpoint),
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
):
    service.delete_endpoint(endpoint["id"])
    return ApiResponse.success(message="MCP endpoint deleted")


@router.post(
    "/{endpoint_id}/regenerate-key",
    response_model=ApiResponse[McpEndpointOut],
    summary="重新生成 API key",
)
def regenerate_key(
    endpoint: dict = Depends(get_verified_mcp_endpoint),
    current_user: CurrentUser = Depends(get_current_user),
    service: McpEndpointService = Depends(get_mcp_endpoint_service),
):
    row = service.regenerate_key(endpoint["id"])
    if not row:
        raise HTTPException(status_code=500, detail="Regenerate failed")
    return ApiResponse.success(data=_to_out(row), message="API key regenerated")

"""DB Connector API Router"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, Path, Query

from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse
from src.db_connector.service import DBConnectorService
from src.db_connector.dependencies import get_db_connector_service
from src.db_connector.schemas import (
    CreateConnectionRequest,
    SaveTableRequest,
    ConnectionResponse,
    ConnectionCreatedResponse,
    TableInfoResponse,
    TablePreviewResponse,
    SaveResultResponse,
)

router = APIRouter(
    prefix="/db-connector",
    tags=["db-connector"],
)


def _conn_to_response(conn) -> ConnectionResponse:
    return ConnectionResponse(
        id=conn.id,
        name=conn.name,
        provider=conn.provider,
        project_id=conn.project_id,
        is_active=conn.is_active,
        last_used_at=conn.last_used_at.isoformat() if conn.last_used_at else None,
        created_at=conn.created_at.isoformat() if hasattr(conn.created_at, 'isoformat') else str(conn.created_at),
    )


# === 连接管理 ===

@router.post(
    "/connections",
    response_model=ApiResponse[ConnectionCreatedResponse],
    summary="创建数据库连接（自动测试）",
)
async def create_connection(
    req: CreateConnectionRequest,
    project_id: str = Query(..., description="项目 ID"),
    user: CurrentUser = Depends(get_current_user),
    service: DBConnectorService = Depends(get_db_connector_service),
):
    try:
        result = await service.create_connection(
            user_id=user.user_id,
            project_id=project_id,
            name=req.name,
            provider=req.provider,
            config=req.to_config(),
        )
        return ApiResponse.success(
            data=ConnectionCreatedResponse(
                connection=_conn_to_response(result["connection"]),
                database_info=result["database_info"],
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")


@router.get(
    "/connections",
    response_model=ApiResponse[List[ConnectionResponse]],
    summary="列出项目下的数据库连接",
)
async def list_connections(
    project_id: str = Query(..., description="项目 ID"),
    user: CurrentUser = Depends(get_current_user),
    service: DBConnectorService = Depends(get_db_connector_service),
):
    connections = service.list_connections(user.user_id, project_id)
    return ApiResponse.success(data=[_conn_to_response(c) for c in connections])


@router.delete(
    "/connections/{connection_id}",
    response_model=ApiResponse,
    summary="删除数据库连接",
)
async def delete_connection(
    connection_id: str = Path(...),
    user: CurrentUser = Depends(get_current_user),
    service: DBConnectorService = Depends(get_db_connector_service),
):
    service.delete_connection(connection_id, user.user_id)
    return ApiResponse.success(message="Connection deleted")


# === 表数据 ===

@router.get(
    "/connections/{connection_id}/tables",
    response_model=ApiResponse[List[TableInfoResponse]],
    summary="列出数据库中的所有表",
)
async def list_tables(
    connection_id: str = Path(...),
    user: CurrentUser = Depends(get_current_user),
    service: DBConnectorService = Depends(get_db_connector_service),
):
    tables = await service.list_tables(connection_id, user.user_id)
    return ApiResponse.success(
        data=[
            TableInfoResponse(name=t.name, type=t.type, columns=t.columns)
            for t in tables
        ]
    )


@router.get(
    "/connections/{connection_id}/tables/{table_name}/preview",
    response_model=ApiResponse[TablePreviewResponse],
    summary="预览表数据（前50行）",
)
async def preview_table(
    connection_id: str = Path(...),
    table_name: str = Path(...),
    limit: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
    service: DBConnectorService = Depends(get_db_connector_service),
):
    try:
        result = await service.preview_table(
            connection_id=connection_id,
            user_id=user.user_id,
            table=table_name,
            limit=limit,
        )
        return ApiResponse.success(
            data=TablePreviewResponse(
                columns=result.columns,
                rows=result.rows,
                row_count=result.row_count,
                execution_time_ms=result.execution_time_ms,
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


# === 保存 ===

@router.post(
    "/connections/{connection_id}/save",
    response_model=ApiResponse[SaveResultResponse],
    summary="保存整张表为 content_node",
)
async def save_table(
    req: SaveTableRequest,
    connection_id: str = Path(...),
    project_id: str = Query(..., description="项目 ID"),
    user: CurrentUser = Depends(get_current_user),
    service: DBConnectorService = Depends(get_db_connector_service),
):
    try:
        result = await service.save_table(
            connection_id=connection_id,
            user_id=user.user_id,
            project_id=project_id,
            name=req.name,
            table=req.table,
            limit=req.limit,
        )
        return ApiResponse.success(
            data=SaveResultResponse(
                content_node_id=result["content_node_id"],
                row_count=result["row_count"],
            )
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Save failed: {str(e)}")

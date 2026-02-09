"""Content Node API Router"""

from fastapi import APIRouter, Depends, Query, status
from typing import Optional, List

from src.content_node.service import ContentNodeService
from src.content_node.dependencies import get_content_node_service
from src.content_node.schemas import (
    CreateFolderRequest,
    CreateJsonNodeRequest,
    CreateMarkdownNodeRequest,
    UpdateNodeRequest,
    MoveNodeRequest,
    BulkCreateRequest,
    BulkCreateResponse,
    BulkCreateResultItem,
    NodeInfo,
    NodeDetail,
    NodeListResponse,
    UploadUrlResponse,
    DownloadUrlResponse,
)
from src.common_schemas import ApiResponse
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.project.dependencies import get_project_service
from src.project.service import ProjectService
from src.exceptions import NotFoundException, ErrorCode

router = APIRouter(
    prefix="/nodes",
    tags=["content-nodes"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


def _node_to_info(node) -> NodeInfo:
    """转换节点为 NodeInfo"""
    return NodeInfo(
        id=node.id,
        name=node.name,
        project_id=node.project_id,
        id_path=node.id_path,
        parent_id=node.parent_id,
        # 类型字段
        type=node.type,
        source=node.source,
        preview_type=node.preview_type,
        mime_type=node.mime_type,
        size_bytes=node.size_bytes,
        # 同步相关字段
        sync_url=node.sync_url,
        sync_id=node.sync_id,
        sync_status=node.sync_status,
        last_synced_at=node.last_synced_at.isoformat() if node.last_synced_at else None,
        is_synced=node.is_synced,
        sync_source=node.sync_source,
        created_at=node.created_at.isoformat(),
        updated_at=node.updated_at.isoformat(),
    )


def _node_to_detail(node) -> NodeDetail:
    """转换节点为 NodeDetail"""
    return NodeDetail(
        id=node.id,
        name=node.name,
        project_id=node.project_id,
        id_path=node.id_path,
        parent_id=node.parent_id,
        # 类型字段
        type=node.type,
        source=node.source,
        preview_type=node.preview_type,
        mime_type=node.mime_type,
        size_bytes=node.size_bytes,
        preview_json=node.preview_json,
        preview_md=node.preview_md,
        s3_key=node.s3_key,
        permissions=node.permissions,
        # 同步相关字段
        sync_url=node.sync_url,
        sync_id=node.sync_id,
        sync_status=node.sync_status,
        last_synced_at=node.last_synced_at.isoformat() if node.last_synced_at else None,
        is_synced=node.is_synced,
        sync_source=node.sync_source,
        created_at=node.created_at.isoformat(),
        updated_at=node.updated_at.isoformat(),
    )


def _ensure_project_access(
    project_service: ProjectService,
    current_user: CurrentUser,
    project_id: str,
) -> None:
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise NotFoundException(
            f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
        )


# === 查询 API ===

@router.get(
    "/",
    response_model=ApiResponse[NodeListResponse],
    summary="列出节点",
    description="列出指定项目中父节点下的所有子节点，不传 parent_id 则列出项目根节点",
)
def list_nodes(
    project_id: str = Query(..., description="项目 ID"),
    parent_id: Optional[str] = Query(None, description="父节点 ID，不传则列出项目根节点"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    nodes = service.list_children(project_id, parent_id)
    return ApiResponse.success(
        data=NodeListResponse(
            nodes=[_node_to_info(n) for n in nodes],
            total=len(nodes),
        )
    )


@router.get(
    "/{node_id}",
    response_model=ApiResponse[NodeDetail],
    summary="获取节点详情",
)
def get_node(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node = service.get_by_id(node_id, project_id)
    return ApiResponse.success(data=_node_to_detail(node))


@router.get(
    "/by-id-path/",
    response_model=ApiResponse[NodeDetail],
    summary="按 id_path 获取节点",
)
def get_node_by_id_path(
    project_id: str = Query(..., description="项目 ID"),
    id_path: str = Query(..., description="节点 id_path，如 /uuid1/uuid2/uuid3"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node = service.get_by_id_path(project_id, id_path)
    return ApiResponse.success(data=_node_to_detail(node))


# === 创建 API ===

@router.post(
    "/folder",
    response_model=ApiResponse[NodeDetail],
    summary="创建文件夹",
    status_code=status.HTTP_201_CREATED,
)
def create_folder(
    request: CreateFolderRequest,
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, request.project_id)
    node = service.create_folder(
        project_id=request.project_id,
        name=request.name,
        parent_id=request.parent_id,
        created_by=current_user.user_id,
    )
    return ApiResponse.success(data=_node_to_detail(node), message="文件夹创建成功")


@router.post(
    "/json",
    response_model=ApiResponse[NodeDetail],
    summary="创建 JSON 节点",
    status_code=status.HTTP_201_CREATED,
)
def create_json_node(
    request: CreateJsonNodeRequest,
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, request.project_id)
    node = service.create_json_node(
        project_id=request.project_id,
        name=request.name,
        content=request.content,
        parent_id=request.parent_id,
        created_by=current_user.user_id,
    )
    return ApiResponse.success(data=_node_to_detail(node), message="节点创建成功")


@router.post(
    "/markdown",
    response_model=ApiResponse[NodeDetail],
    summary="创建 Markdown 节点",
    status_code=status.HTTP_201_CREATED,
)
async def create_markdown_node(
    request: CreateMarkdownNodeRequest,
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, request.project_id)
    node = await service.create_markdown_node(
        project_id=request.project_id,
        name=request.name,
        content=request.content,
        parent_id=request.parent_id,
        created_by=current_user.user_id,
    )
    return ApiResponse.success(data=_node_to_detail(node), message="Markdown 节点创建成功")


@router.post(
    "/bulk-create",
    response_model=ApiResponse[BulkCreateResponse],
    summary="批量创建节点",
    description="批量创建文件夹和文件节点（用于文件夹上传）",
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_nodes(
    request: BulkCreateRequest,
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    批量创建节点，用于文件夹上传场景。
    
    节点通过 temp_id 和 parent_temp_id 建立层级关系：
    - temp_id: 每个节点的临时标识（前端生成）
    - parent_temp_id: 父节点的临时标识，None 表示挂载到 parent_id 指定的节点下
    
    type 字段: folder | json | markdown | file
    
    示例：上传文件夹 my-docs/
    ```json
    {
      "project_id": "xxx",
      "parent_id": null,
      "nodes": [
        {"temp_id": "t1", "name": "my-docs", "type": "folder", "parent_temp_id": null},
        {"temp_id": "t2", "name": "readme.md", "type": "markdown", "parent_temp_id": "t1", "content": "# Hello"},
        {"temp_id": "t3", "name": "config.json", "type": "json", "parent_temp_id": "t1", "content": {"key": "value"}}
      ]
    }
    ```
    """
    nodes_data = [
        {
            "temp_id": n.temp_id,
            "name": n.name,
            "type": n.type,
            "parent_temp_id": n.parent_temp_id,
            "content": n.content,
        }
        for n in request.nodes
    ]
    
    _ensure_project_access(project_service, current_user, request.project_id)
    results = await service.bulk_create_nodes(
        project_id=request.project_id,
        nodes=nodes_data,
        root_parent_id=request.parent_id,
        created_by=current_user.user_id,
    )
    
    return ApiResponse.success(
        data=BulkCreateResponse(
            created=[BulkCreateResultItem(**r) for r in results],
            total=len(results),
        ),
        message=f"成功创建 {len(results)} 个节点",
    )


@router.post(
    "/upload",
    response_model=ApiResponse[UploadUrlResponse],
    summary="准备文件上传",
    description="获取预签名上传 URL，用于直接上传文件到 S3",
    status_code=status.HTTP_201_CREATED,
)
async def prepare_upload(
    name: str = Query(..., description="文件名"),
    project_id: str = Query(..., description="项目 ID"),
    content_type: str = Query(..., description="文件 MIME 类型"),
    parent_id: Optional[str] = Query(None, description="父节点 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node, upload_url = await service.prepare_file_upload(
        project_id=project_id,
        name=name,
        content_type=content_type,
        parent_id=parent_id,
        created_by=current_user.user_id,
    )
    return ApiResponse.success(
        data=UploadUrlResponse(
            node_id=node.id,
            upload_url=upload_url,
            s3_key=node.s3_key,
        ),
        message="上传 URL 生成成功",
    )


# === 更新 API ===

@router.put(
    "/{node_id}",
    response_model=ApiResponse[NodeDetail],
    summary="更新节点",
)
def update_node(
    node_id: str,
    request: UpdateNodeRequest,
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node = service.update_node(
        node_id=node_id,
        project_id=project_id,
        name=request.name,
        preview_json=request.preview_json,
        preview_md=request.preview_md,
    )
    return ApiResponse.success(data=_node_to_detail(node), message="节点更新成功")


@router.post(
    "/{node_id}/move",
    response_model=ApiResponse[NodeDetail],
    summary="移动节点",
)
def move_node(
    node_id: str,
    request: MoveNodeRequest,
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node = service.move_node(
        node_id=node_id,
        project_id=project_id,
        new_parent_id=request.new_parent_id,
    )
    return ApiResponse.success(data=_node_to_detail(node), message="节点移动成功")


# === 删除 API ===

@router.delete(
    "/{node_id}",
    response_model=ApiResponse[None],
    summary="删除节点",
    description="删除节点及其所有子节点",
)
async def delete_node(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    await service.delete_node(node_id, project_id)
    return ApiResponse.success(message="节点删除成功")


# === 下载 API ===

@router.get(
    "/{node_id}/download",
    response_model=ApiResponse[DownloadUrlResponse],
    summary="获取下载 URL",
    description="获取预签名下载 URL（仅适用于 file 和 sync 类型）",
)
async def get_download_url(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    url = await service.get_download_url(node_id, project_id)
    return ApiResponse.success(
        data=DownloadUrlResponse(download_url=url, expires_in=3600)
    )

"""Content Node API Router"""

from fastapi import APIRouter, Depends, Query, status
from typing import Optional, List

from src.content_node.service import ContentNodeService
from src.content_node.dependencies import get_content_node_service
from src.content_node.schemas import (
    CreateFolderRequest,
    CreateJsonNodeRequest,
    UpdateNodeRequest,
    MoveNodeRequest,
    NodeInfo,
    NodeDetail,
    NodeListResponse,
    UploadUrlResponse,
    DownloadUrlResponse,
)
from src.common_schemas import ApiResponse
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user

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
        type=node.type,
        path=node.path,
        parent_id=node.parent_id,
        mime_type=node.mime_type,
        size_bytes=node.size_bytes,
        created_at=node.created_at.isoformat(),
        updated_at=node.updated_at.isoformat(),
    )


def _node_to_detail(node) -> NodeDetail:
    """转换节点为 NodeDetail"""
    return NodeDetail(
        id=node.id,
        name=node.name,
        type=node.type,
        path=node.path,
        parent_id=node.parent_id,
        mime_type=node.mime_type,
        size_bytes=node.size_bytes,
        content=node.content,
        s3_key=node.s3_key,
        permissions=node.permissions,
        created_at=node.created_at.isoformat(),
        updated_at=node.updated_at.isoformat(),
    )


# === 查询 API ===

@router.get(
    "/",
    response_model=ApiResponse[NodeListResponse],
    summary="列出节点",
    description="列出指定父节点下的所有子节点，不传 parent_id 则列出根节点",
)
def list_nodes(
    parent_id: Optional[str] = Query(None, description="父节点 ID，不传则列出根节点"),
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    nodes = service.list_children(current_user.user_id, parent_id)
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
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    node = service.get_by_id(node_id, current_user.user_id)
    return ApiResponse.success(data=_node_to_detail(node))


@router.get(
    "/by-path/",
    response_model=ApiResponse[NodeDetail],
    summary="按路径获取节点",
)
def get_node_by_path(
    path: str = Query(..., description="节点路径，如 /项目A/文档/readme.md"),
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    node = service.get_by_path(current_user.user_id, path)
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
    current_user: CurrentUser = Depends(get_current_user),
):
    node = service.create_folder(
        user_id=current_user.user_id,
        name=request.name,
        parent_id=request.parent_id,
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
    current_user: CurrentUser = Depends(get_current_user),
):
    node = service.create_json_node(
        user_id=current_user.user_id,
        name=request.name,
        content=request.content,
        parent_id=request.parent_id,
    )
    return ApiResponse.success(data=_node_to_detail(node), message="节点创建成功")


@router.post(
    "/upload",
    response_model=ApiResponse[UploadUrlResponse],
    summary="准备文件上传",
    description="获取预签名上传 URL，用于直接上传文件到 S3",
    status_code=status.HTTP_201_CREATED,
)
async def prepare_upload(
    name: str = Query(..., description="文件名"),
    content_type: str = Query(..., description="文件 MIME 类型"),
    parent_id: Optional[str] = Query(None, description="父节点 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    node, upload_url = await service.prepare_file_upload(
        user_id=current_user.user_id,
        name=name,
        content_type=content_type,
        parent_id=parent_id,
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
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    node = service.update_node(
        node_id=node_id,
        user_id=current_user.user_id,
        name=request.name,
        content=request.content,
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
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    node = service.move_node(
        node_id=node_id,
        user_id=current_user.user_id,
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
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    await service.delete_node(node_id, current_user.user_id)
    return ApiResponse.success(message="节点删除成功")


# === 下载 API ===

@router.get(
    "/{node_id}/download",
    response_model=ApiResponse[DownloadUrlResponse],
    summary="获取下载 URL",
    description="获取预签名下载 URL（仅适用于非 JSON 类型）",
)
async def get_download_url(
    node_id: str,
    service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    url = await service.get_download_url(node_id, current_user.user_id)
    return ApiResponse.success(
        data=DownloadUrlResponse(download_url=url, expires_in=3600)
    )


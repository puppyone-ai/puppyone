"""Content Node API Router — All writes go through Mut Protocol commit()"""

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
    NodeContentResponse,
    UploadUrlResponse,
    DownloadUrlResponse,
)
from src.collaboration.service import CollaborationService
from src.collaboration.dependencies import get_collaboration_service
from src.collaboration.schemas import Mutation, MutationType, Operator
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


def _compute_preview_snippet(node, max_len: int = 200) -> str | None:
    """内容已迁移到 S3，snippet 需从 S3 读取。目前返回 None。"""
    return None
    return None


def _node_to_info(
    node,
    children_count: int | None = None,
) -> NodeInfo:
    """转换节点为 NodeInfo"""
    return NodeInfo(
        id=node.id,
        name=node.name,
        project_id=node.project_id,
        id_path=node.id_path,
        parent_id=node.parent_id,
        type=node.type,
        mime_type=node.mime_type,
        size_bytes=node.size_bytes,
        preview_snippet=_compute_preview_snippet(node),
        children_count=children_count,
        created_at=node.created_at.isoformat(),
        updated_at=node.updated_at.isoformat(),
    )


def _node_to_detail(node) -> NodeDetail:
    """转换节点为 NodeDetail（metadata only — 内容通过 /content 端点读取）"""
    return NodeDetail(
        id=node.id,
        name=node.name,
        project_id=node.project_id,
        id_path=node.id_path,
        parent_id=node.parent_id,
        type=node.type,
        mime_type=node.mime_type,
        size_bytes=node.size_bytes,
        content_hash=node.content_hash,
        s3_key=node.s3_key,
        mut_path=node.mut_path,
        permissions=node.permissions,
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

    folder_ids = [n.id for n in nodes if n.type == "folder"]
    children_counts = service.repo.count_children_batch(folder_ids) if folder_ids else {}

    node_infos = [
        _node_to_info(n, children_count=children_counts.get(n.id))
        for n in nodes
    ]
    return ApiResponse.success(
        data=NodeListResponse(nodes=node_infos, total=len(node_infos))
    )


@router.get(
    "/batch",
    response_model=ApiResponse[List[NodeDetail]],
    summary="批量获取节点详情",
    description="通过逗号分隔的 ID 列表一次获取多个节点，最多 50 个",
)
def get_nodes_batch(
    ids: str = Query(..., description="逗号分隔的节点 ID 列表"),
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node_ids = [nid.strip() for nid in ids.split(",") if nid.strip()]
    if len(node_ids) > 50:
        node_ids = node_ids[:50]
    nodes = service.repo.get_by_ids(node_ids)
    nodes = [n for n in nodes if n.project_id == project_id]
    return ApiResponse.success(data=[_node_to_detail(n) for n in nodes])


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
    "/{node_id}/content",
    response_model=ApiResponse[NodeContentResponse],
    summary="读取节点内容（从 S3 MUT ObjectStore）",
)
def get_node_content(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    service: ContentNodeService = Depends(get_content_node_service),
    collab: CollaborationService = Depends(get_collaboration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node = service.get_by_id(node_id, project_id)

    content_hash = node.content_hash
    if not content_hash:
        return ApiResponse.success(data=NodeContentResponse(
            node_id=node_id,
            node_type=node.type,
            content_hash=None,
            size_bytes=node.size_bytes,
        ))

    try:
        repo = collab._repos.get_repo(project_id)
        content_bytes = repo.store.get(content_hash)
    except Exception:
        return ApiResponse.success(data=NodeContentResponse(
            node_id=node_id,
            node_type=node.type,
            content_hash=content_hash,
            size_bytes=node.size_bytes,
        ))

    import json as _json

    content_json = None
    content_text = None

    if node.type == "json":
        try:
            content_json = _json.loads(content_bytes.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            content_text = content_bytes.decode("utf-8", errors="replace")
    elif node.type == "markdown":
        content_text = content_bytes.decode("utf-8", errors="replace")
    elif node.type == "file" and node.s3_key:
        from src.s3.service import S3Service
        from src.s3.dependencies import get_s3_service
        pass

    return ApiResponse.success(data=NodeContentResponse(
        node_id=node_id,
        node_type=node.type,
        content_hash=content_hash,
        content_json=content_json,
        content_text=content_text,
        size_bytes=len(content_bytes),
    ))


@router.get(
    "/by-path",
    response_model=ApiResponse[NodeInfo],
    summary="按人类可读路径获取节点",
    description="根据 project_id 和路径（如 /docs/notion）解析到节点",
)
def get_node_by_path(
    project_id: str = Query(..., description="项目 ID"),
    path: str = Query(..., description="人类可读路径，如 /docs/notion"),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    node = service.resolve_path_from_root(project_id, path)
    return ApiResponse.success(data=_node_to_info(node))


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
async def create_folder(
    request: CreateFolderRequest,
    collab: CollaborationService = Depends(get_collaboration_service),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, request.project_id)
    result = await collab.commit(Mutation(
        type=MutationType.NODE_CREATE,
        operator=Operator(type="user", id=current_user.user_id),
        project_id=request.project_id,
        name=request.name,
        parent_id=request.parent_id,
        node_type="folder",
    ))
    node = service.get_by_id(result.node_id, request.project_id)
    return ApiResponse.success(data=_node_to_detail(node), message="文件夹创建成功")


@router.post(
    "/json",
    response_model=ApiResponse[NodeDetail],
    summary="创建 JSON 节点",
    status_code=status.HTTP_201_CREATED,
)
async def create_json_node(
    request: CreateJsonNodeRequest,
    collab: CollaborationService = Depends(get_collaboration_service),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, request.project_id)
    result = await collab.commit(Mutation(
        type=MutationType.NODE_CREATE,
        operator=Operator(type="user", id=current_user.user_id),
        project_id=request.project_id,
        name=request.name,
        content=request.content,
        parent_id=request.parent_id,
        node_type="json",
    ))
    node = service.get_by_id(result.node_id, request.project_id)
    return ApiResponse.success(data=_node_to_detail(node), message="节点创建成功")


@router.post(
    "/markdown",
    response_model=ApiResponse[NodeDetail],
    summary="创建 Markdown 节点",
    status_code=status.HTTP_201_CREATED,
)
async def create_markdown_node(
    request: CreateMarkdownNodeRequest,
    collab: CollaborationService = Depends(get_collaboration_service),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, request.project_id)
    result = await collab.commit(Mutation(
        type=MutationType.NODE_CREATE,
        operator=Operator(type="user", id=current_user.user_id),
        project_id=request.project_id,
        name=request.name,
        content=request.content,
        parent_id=request.parent_id,
        node_type="markdown",
    ))
    node = service.get_by_id(result.node_id, request.project_id)
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
    collab: CollaborationService = Depends(get_collaboration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    批量创建节点，用于文件夹上传场景。

    节点通过 temp_id 和 parent_temp_id 建立层级关系：
    - temp_id: 每个节点的临时标识（前端生成）
    - parent_temp_id: 父节点的临时标识，None 表示挂载到 parent_id 指定的节点下

    type 字段: folder | json | markdown | file

    所有带 content 的 JSON/Markdown 节点通过 MUT 写入（collab.commit）。
    """
    _ensure_project_access(project_service, current_user, request.project_id)

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

    results = await service.bulk_create_nodes(
        project_id=request.project_id,
        nodes=nodes_data,
        root_parent_id=request.parent_id,
        created_by=current_user.user_id,
    )

    temp_to_node_id = {r["temp_id"]: r["node_id"] for r in results}

    for n in request.nodes:
        if n.content is None:
            continue
        if n.type not in ("json", "markdown"):
            continue
        node_id = temp_to_node_id.get(n.temp_id)
        if not node_id:
            continue
        await collab.commit(Mutation(
            type=MutationType.CONTENT_UPDATE,
            operator=Operator(type="user", id=current_user.user_id),
            project_id=request.project_id,
            node_id=node_id,
            content=n.content,
            node_type=n.type,
        ))

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
async def update_node(
    node_id: str,
    request: UpdateNodeRequest,
    project_id: str = Query(..., description="项目 ID"),
    collab: CollaborationService = Depends(get_collaboration_service),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    op = Operator(type="user", id=current_user.user_id)

    if request.name is not None:
        await collab.commit(Mutation(
            type=MutationType.NODE_RENAME,
            operator=op,
            node_id=node_id,
            project_id=project_id,
            new_name=request.name,
        ))

    json_content = request.content_json or request.preview_json
    text_content = request.content_text or request.preview_md

    if json_content is not None:
        await collab.commit(Mutation(
            type=MutationType.CONTENT_UPDATE,
            operator=op,
            node_id=node_id,
            content=json_content,
            node_type="json",
            base_version=0,
        ))
    elif text_content is not None:
        await collab.commit(Mutation(
            type=MutationType.CONTENT_UPDATE,
            operator=op,
            node_id=node_id,
            content=text_content,
            node_type="markdown",
            base_version=0,
        ))

    node = service.get_by_id(node_id, project_id)
    return ApiResponse.success(data=_node_to_detail(node), message="节点更新成功")


@router.post(
    "/{node_id}/move",
    response_model=ApiResponse[NodeDetail],
    summary="移动节点",
)
async def move_node(
    node_id: str,
    request: MoveNodeRequest,
    project_id: str = Query(..., description="项目 ID"),
    collab: CollaborationService = Depends(get_collaboration_service),
    service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    await collab.commit(Mutation(
        type=MutationType.NODE_MOVE,
        operator=Operator(type="user", id=current_user.user_id),
        node_id=node_id,
        project_id=project_id,
        new_parent_id=request.new_parent_id,
    ))
    node = service.get_by_id(node_id, project_id)
    return ApiResponse.success(data=_node_to_detail(node), message="节点移动成功")


# === 删除 API ===

@router.delete(
    "/{node_id}",
    response_model=ApiResponse[None],
    summary="删除节点（软删除，移入 .trash）",
)
async def delete_node(
    node_id: str,
    project_id: str = Query(..., description="项目 ID"),
    collab: CollaborationService = Depends(get_collaboration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    await collab.commit(Mutation(
        type=MutationType.NODE_DELETE,
        operator=Operator(type="user", id=current_user.user_id),
        node_id=node_id,
        project_id=project_id,
        created_by=current_user.user_id,
    ))
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

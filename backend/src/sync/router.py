"""
L2.5 Sync — API Routes

Source management:
  POST   /sync/sources                        Create data source
  GET    /sync/sources                        List data sources
  DELETE /sync/sources/{id}                   Delete data source
  POST   /sync/sources/{id}/bootstrap         First connect: scan and bind nodes
  POST   /sync/sources/{id}/pause             Pause
  POST   /sync/sources/{id}/resume            Resume

CLI-driven sync:
  POST   /sync/sources/{id}/push-file         Push a local file to PuppyOne
  GET    /sync/sources/{id}/pull-files         Get files that need pulling
  POST   /sync/sources/{id}/ack-pull          Acknowledge pulled files

Server-side sync:
  POST   /sync/pull                           Trigger server-side PULL
  POST   /sync/push/{node_id}                Trigger server-side PUSH

Bindings:
  GET    /sync/sources/{id}/bindings          List nodes bound to a source
"""

from typing import Optional, Any
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.sync.service import SyncService
from src.sync.dependencies import get_sync_service
from src.common_schemas import ApiResponse


router = APIRouter(prefix="/sync", tags=["sync"])


# ============================================================
# Request / Response models
# ============================================================

class CreateSourceRequest(BaseModel):
    project_id: str
    adapter_type: str
    config: dict
    trigger_config: Optional[dict] = None
    sync_mode: str = "bidirectional"
    conflict_strategy: str = "three_way_merge"
    credentials_ref: Optional[str] = None


class SourceResponse(BaseModel):
    id: int
    project_id: str
    adapter_type: str
    config: dict
    trigger_config: dict
    sync_mode: str
    conflict_strategy: str
    status: str
    last_error: Optional[str]


class NodeBindingResponse(BaseModel):
    node_id: str
    source_id: int
    external_resource_id: str
    remote_hash: Optional[str]
    last_sync_version: int
    status: str


class BootstrapRequest(BaseModel):
    target_folder_node_id: Optional[str] = None


class BootstrapResponse(BaseModel):
    bindings_created: int


class PullResponse(BaseModel):
    synced: int
    results: list[dict]


class PushResponse(BaseModel):
    pushed: int
    results: list[dict]


# --- CLI sync models ---

class PushFileRequest(BaseModel):
    external_resource_id: str  # relative path, e.g. "config.json"
    content_json: Optional[Any] = None
    content_md: Optional[str] = None
    content_hash: str  # SHA-256 of local file
    name: Optional[str] = None  # defaults to filename stem


class PushFileResponse(BaseModel):
    node_id: str
    external_resource_id: str
    action: str  # "created" | "updated" | "skipped"
    version: int


class PullFileItem(BaseModel):
    node_id: str
    external_resource_id: str
    content_json: Optional[Any] = None
    content_md: Optional[str] = None
    node_type: str  # "json" | "markdown"
    current_version: int


class PullFilesResponse(BaseModel):
    files: list[PullFileItem]
    total: int


class AckPullItem(BaseModel):
    node_id: str
    version: int
    remote_hash: str


class AckPullRequest(BaseModel):
    items: list[AckPullItem]


# ============================================================
# Source management
# ============================================================

@router.post("/sources", response_model=ApiResponse[SourceResponse])
def create_source(
    body: CreateSourceRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    source = sync_svc.add_source(
        project_id=body.project_id,
        adapter_type=body.adapter_type,
        config=body.config,
        trigger_config=body.trigger_config,
        sync_mode=body.sync_mode,
        conflict_strategy=body.conflict_strategy,
        credentials_ref=body.credentials_ref,
    )
    _notify_folder_source("start", source.id)
    return ApiResponse.success(data=_source_resp(source))


@router.get("/sources", response_model=ApiResponse[list[SourceResponse]])
def list_sources(
    project_id: Optional[str] = Query(None),
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if project_id:
        sources = sync_svc.sources.list_by_project(project_id)
    else:
        sources = sync_svc.sources.list_active()
    return ApiResponse.success(data=[_source_resp(s) for s in sources])


@router.delete("/sources/{source_id}", response_model=ApiResponse)
def delete_source(
    source_id: int,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _notify_folder_source("stop", source_id)
    sync_svc.remove_source(source_id)
    return ApiResponse.success(message="Source deleted")


@router.post("/sources/{source_id}/bootstrap", response_model=ApiResponse[BootstrapResponse])
async def bootstrap_source(
    source_id: int,
    body: BootstrapRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    bindings = await sync_svc.bootstrap(source_id, body.target_folder_node_id)
    return ApiResponse.success(data=BootstrapResponse(bindings_created=len(bindings)))


@router.post("/sources/{source_id}/pause", response_model=ApiResponse)
def pause_source(
    source_id: int,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _notify_folder_source("stop", source_id)
    sync_svc.pause_source(source_id)
    return ApiResponse.success(message="Source paused")


@router.post("/sources/{source_id}/resume", response_model=ApiResponse)
def resume_source(
    source_id: int,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    sync_svc.resume_source(source_id)
    _notify_folder_source("start", source_id)
    return ApiResponse.success(message="Source resumed")


# ============================================================
# Bindings
# ============================================================

@router.get("/sources/{source_id}/bindings", response_model=ApiResponse[list[NodeBindingResponse]])
def list_bindings(
    source_id: int,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    mappings = sync_svc.node_sync.list_by_source(source_id)
    return ApiResponse.success(data=[_binding_resp(m) for m in mappings])


# ============================================================
# CLI-driven sync: push-file, pull-files, ack-pull
# ============================================================

@router.post(
    "/sources/{source_id}/push-file",
    response_model=ApiResponse[PushFileResponse],
)
async def push_file(
    source_id: int,
    body: PushFileRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    CLI pushes a local file to PuppyOne.
    Creates a new node if no binding exists, updates if it does.
    """
    import os
    from src.content_node.repository import ContentNodeRepository
    from src.content_node.service import ContentNodeService
    from src.s3.service import S3Service
    from src.supabase.client import SupabaseClient

    source = sync_svc.sources.get_by_id(source_id)
    if not source:
        return ApiResponse.error(code=1004, message=f"Source #{source_id} not found")

    supabase = SupabaseClient()
    node_repo = ContentNodeRepository(supabase)
    node_svc = ContentNodeService(repo=node_repo, s3_service=S3Service())

    is_json = body.content_json is not None
    existing = sync_svc.node_sync.find_by_resource(source_id, body.external_resource_id)

    if existing:
        if existing.remote_hash == body.content_hash:
            return ApiResponse.success(data=PushFileResponse(
                node_id=existing.node_id,
                external_resource_id=body.external_resource_id,
                action="skipped",
                version=existing.last_sync_version,
            ))

        updated = node_svc.update_node(
            node_id=existing.node_id,
            project_id=source.project_id,
            preview_json=body.content_json if is_json else None,
            preview_md=body.content_md if not is_json else None,
            operator_type="sync",
            operator_id=f"cli:{body.external_resource_id}",
        )
        version = updated.current_version or 0
        sync_svc.node_sync.update_sync_point(
            node_id=existing.node_id,
            last_sync_version=version,
            remote_hash=body.content_hash,
        )
        return ApiResponse.success(data=PushFileResponse(
            node_id=existing.node_id,
            external_resource_id=body.external_resource_id,
            action="updated",
            version=version,
        ))

    file_name = body.name or os.path.splitext(
        os.path.basename(body.external_resource_id)
    )[0]
    target_folder_id = source.config.get("target_folder_id")

    if is_json:
        new_node = node_svc.create_json_node(
            project_id=source.project_id,
            name=file_name,
            content=body.content_json,
            parent_id=target_folder_id,
            created_by=current_user.user_id,
        )
    else:
        new_node = await node_svc.create_markdown_node(
            project_id=source.project_id,
            name=file_name,
            content=body.content_md or "",
            parent_id=target_folder_id,
            created_by=current_user.user_id,
        )

    sync_svc.node_sync.bind_node(
        node_id=new_node.id,
        source_id=source_id,
        external_resource_id=body.external_resource_id,
    )
    version = new_node.current_version or 0
    sync_svc.node_sync.update_sync_point(
        node_id=new_node.id,
        last_sync_version=version,
        remote_hash=body.content_hash,
    )
    return ApiResponse.success(data=PushFileResponse(
        node_id=new_node.id,
        external_resource_id=body.external_resource_id,
        action="created",
        version=version,
    ))


@router.get(
    "/sources/{source_id}/pull-files",
    response_model=ApiResponse[PullFilesResponse],
)
def pull_files(
    source_id: int,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns files that have changed on the server since last sync.
    Also discovers new nodes created via the web UI in the target folder.
    CLI writes them to local filesystem, then calls ack-pull.
    """
    from src.content_node.repository import ContentNodeRepository
    from src.supabase.client import SupabaseClient

    source = sync_svc.sources.get_by_id(source_id)
    if not source:
        return ApiResponse.error(code=1004, message=f"Source #{source_id} not found")

    node_repo = ContentNodeRepository(SupabaseClient())
    files: list[PullFileItem] = []
    seen_node_ids: set[str] = set()

    # 1) Existing bindings: check for updated content
    bindings = sync_svc.node_sync.list_by_source(source_id)
    for binding in bindings:
        seen_node_ids.add(binding.node_id)
        node = node_repo.get_by_id(binding.node_id)
        if not node:
            continue

        node_version = node.current_version or 0
        if node_version <= binding.last_sync_version:
            continue

        is_json = node.preview_json is not None
        files.append(PullFileItem(
            node_id=node.id,
            external_resource_id=binding.external_resource_id,
            content_json=node.preview_json if is_json else None,
            content_md=node.preview_md if not is_json else None,
            node_type="json" if is_json else "markdown",
            current_version=node_version,
        ))

    # 2) Discover new unbound nodes in the target folder (created via web UI)
    target_folder_id = source.config.get("target_folder_id")
    if target_folder_id:
        children = node_repo.list_children(source.project_id, target_folder_id)
        for node in children:
            if node.id in seen_node_ids:
                continue
            if node.type == "folder":
                continue

            ext = ".json" if node.type == "json" else ".md"
            resource_id = f"{node.name}{ext}"
            is_json = node.type == "json"

            # Auto-bind this new node to the sync source
            sync_svc.node_sync.bind_node(
                node_id=node.id,
                source_id=source_id,
                external_resource_id=resource_id,
            )

            files.append(PullFileItem(
                node_id=node.id,
                external_resource_id=resource_id,
                content_json=node.preview_json if is_json else None,
                content_md=node.preview_md if not is_json else None,
                node_type="json" if is_json else "markdown",
                current_version=node.current_version or 0,
            ))

    return ApiResponse.success(data=PullFilesResponse(files=files, total=len(files)))


@router.post("/sources/{source_id}/ack-pull", response_model=ApiResponse)
def ack_pull(
    source_id: int,
    body: AckPullRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    CLI acknowledges it has written pulled files to local filesystem.
    Updates sync point so the same content won't be pulled again.
    """
    for item in body.items:
        sync_svc.node_sync.update_sync_point(
            node_id=item.node_id,
            last_sync_version=item.version,
            remote_hash=item.remote_hash,
        )
    return ApiResponse.success(message=f"Acknowledged {len(body.items)} files")


# ============================================================
# Server-side PULL / PUSH
# ============================================================

@router.post("/pull", response_model=ApiResponse[PullResponse])
async def trigger_pull(
    source_id: Optional[int] = Query(None, description="Source ID. Omit to pull all."),
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if source_id:
        results = await sync_svc.pull_source(source_id)
    else:
        results = await sync_svc.pull_all()
    return ApiResponse.success(data=PullResponse(synced=len(results), results=results))


@router.post("/push/{node_id}", response_model=ApiResponse[PushResponse])
async def trigger_push(
    node_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.content_node.repository import ContentNodeRepository
    from src.supabase.client import SupabaseClient

    node = ContentNodeRepository(SupabaseClient()).get_by_id(node_id)
    if not node:
        return ApiResponse.error(code=1004, message=f"Node not found: {node_id}")

    content = node.preview_json if node.preview_json is not None else node.preview_md
    node_type = "json" if node.preview_json is not None else "markdown"

    results = await sync_svc.push_node(
        node_id=node_id,
        version=node.current_version or 0,
        content=content,
        node_type=node_type,
    )
    return ApiResponse.success(data=PushResponse(pushed=len(results), results=results))


# ============================================================
# Helpers
# ============================================================

def _notify_folder_source(action: str, source_id: int) -> None:
    try:
        from src.sync.handlers.folder_source import FolderSourceService
        svc = FolderSourceService.get_instance()
        if not svc:
            return
        if action == "start":
            svc.start_for_source(source_id)
        elif action == "stop":
            svc.stop_for_source(source_id)
    except Exception:
        pass


def _source_resp(s) -> SourceResponse:
    return SourceResponse(
        id=s.id, project_id=s.project_id, adapter_type=s.adapter_type,
        config=s.config, trigger_config=s.trigger_config,
        sync_mode=s.sync_mode, conflict_strategy=s.conflict_strategy,
        status=s.status, last_error=s.last_error,
    )


def _binding_resp(m) -> NodeBindingResponse:
    return NodeBindingResponse(
        node_id=m.node_id, source_id=m.source_id,
        external_resource_id=m.external_resource_id,
        remote_hash=m.remote_hash, last_sync_version=m.last_sync_version,
        status=m.status,
    )

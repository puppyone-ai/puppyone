"""
Tree API — MutOps 的 REST HTTP 外壳

MutOps 是唯一的操作入口，本文件只做:
  HTTP 参数解析 + 认证 + 调用 MutOps + 格式化响应

端点:
  GET  /ls       — 列出目录内容
  GET  /cat      — 读取文件内容
  GET  /stat     — 获取文件/目录信息
  GET  /tree     — 获取完整目录树
  POST /write    — 写入文件
  POST /mkdir    — 创建目录
  POST /mv       — 移动/重命名
  POST /rm       — 删除（移入 .trash）
  POST /restore  — 从 .trash 恢复
  GET  /trash    — 列出回收站
  GET  /versions — 版本历史
  GET  /version-content — 获取某版本文件内容
  GET  /diff     — 对比两个版本
  POST /rollback — 回滚到指定版本
"""

from __future__ import annotations

import json as _json

from fastapi import APIRouter, Depends, Query, HTTPException

from src.mut_engine.tree_reader import MutEntry
from src.mut_engine.ops import MutOps
from src.mut_engine.dependencies import (
    get_mut_ops,
    get_mut_write_service,
)
from src.mut_engine.write_service import MutWriteService
from src.mut_engine.schemas import (
    WriteFileRequest,
    MkdirRequest,
    MoveRequest,
    RemoveRequest,
    RestoreRequest,
    BulkWriteRequest,
    MutEntryResponse,
    ListDirResponse,
    ReadFileResponse,
    StatResponse,
    TreeResponse,
    TrashListResponse,
    FileVersionInfo,
    VersionHistoryResponse,
    RollbackResponse,
    RollbackRequest,
)
from src.common_schemas import ApiResponse
from src.platform.auth.models import CurrentUser
from src.platform.auth.dependencies import get_current_user
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService
from src.exceptions import NotFoundException, ErrorCode

router = APIRouter(
    prefix="/tree",
    tags=["tree"],
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


def _entry_to_response(entry: MutEntry) -> MutEntryResponse:
    return MutEntryResponse(
        name=entry.name,
        path=entry.path,
        type=entry.type,
        content_hash=entry.content_hash,
        size_bytes=entry.size_bytes,
        mime_type=entry.mime_type,
        children_count=entry.children_count,
    )


# ═══════════════════════════════════════════════
# 读取 API
# ═══════════════════════════════════════════════

@router.get(
    "/{project_id}/ls",
    response_model=ApiResponse[ListDirResponse],
    summary="列出目录内容",
)
def list_dir(
    project_id: str,
    path: str = Query("", description="目录路径，空 = 根目录"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entries = ops.list_dir(project_id, clean_path)
    entries = [e for e in entries if not e.path.startswith(".trash/") and e.path != ".trash"]
    version = ops.get_version(project_id)

    return ApiResponse.success(data=ListDirResponse(
        path=clean_path,
        entries=[_entry_to_response(e) for e in entries],
        version=version,
    ))


@router.get(
    "/{project_id}/cat",
    response_model=ApiResponse[ReadFileResponse],
    summary="读取文件内容",
)
def read_file(
    project_id: str,
    path: str = Query(..., description="文件路径"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    try:
        content = ops.read_file(project_id, clean_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {clean_path}")

    entry = ops.stat(project_id, clean_path)
    node_type = entry.type if entry else "file"
    version = ops.get_version(project_id)

    content_json = None
    content_text = None

    if node_type == "json":
        try:
            content_json = _json.loads(content.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            content_text = content.decode("utf-8", errors="replace")
    else:
        content_text = content.decode("utf-8", errors="replace")

    return ApiResponse.success(data=ReadFileResponse(
        path=clean_path,
        type=node_type,
        content=content_json,
        content_text=content_text,
        content_hash=entry.content_hash if entry else None,
        version=version,
    ))


@router.get(
    "/{project_id}/stat",
    response_model=ApiResponse[StatResponse],
    summary="获取文件/目录信息",
)
def stat(
    project_id: str,
    path: str = Query(..., description="路径"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entry = ops.stat(project_id, clean_path)
    if not entry:
        return ApiResponse.success(data=StatResponse(
            path=clean_path,
            type="",
            name="",
            exists=False,
        ))

    return ApiResponse.success(data=StatResponse(
        path=entry.path,
        type=entry.type,
        name=entry.name,
        content_hash=entry.content_hash,
        size_bytes=entry.size_bytes,
        mime_type=entry.mime_type,
        children_count=entry.children_count,
        exists=True,
    ))


@router.get(
    "/{project_id}/tree",
    response_model=ApiResponse[TreeResponse],
    summary="获取完整目录树",
)
def full_tree(
    project_id: str,
    path: str = Query("", description="起始路径"),
    max_depth: int = Query(-1, description="最大递归深度，-1 = 无限"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entries = ops.list_tree(project_id, clean_path, max_depth=max_depth)
    entries = [e for e in entries if not e.path.startswith(".trash/") and e.path != ".trash"]
    version = ops.get_version(project_id)

    return ApiResponse.success(data=TreeResponse(
        path=clean_path,
        entries=[_entry_to_response(e) for e in entries],
        version=version,
    ))


@router.get(
    "/{project_id}/trash",
    response_model=ApiResponse[TrashListResponse],
    summary="列出回收站内容",
)
def list_trash(
    project_id: str,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    entries = ops.list_dir(project_id, ".trash")
    return ApiResponse.success(data=TrashListResponse(
        entries=[_entry_to_response(e) for e in entries],
    ))


# ═══════════════════════════════════════════════
# 写入 API (via MutOps)
# ═══════════════════════════════════════════════

@router.post(
    "/{project_id}/write",
    summary="写入文件",
)
async def write_file_endpoint(
    project_id: str,
    body: WriteFileRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    clean_path = body.path.strip("/")
    if body.node_type == "json":
        if isinstance(body.content, str):
            content_bytes = body.content.encode("utf-8")
        else:
            content_bytes = _json.dumps(body.content, ensure_ascii=False, indent=2).encode("utf-8")
        if not clean_path.endswith(".json"):
            clean_path += ".json"
    elif body.node_type == "markdown":
        content_bytes = (body.content if isinstance(body.content, str) else str(body.content)).encode("utf-8")
        if not clean_path.endswith(".md"):
            clean_path += ".md"
    else:
        if isinstance(body.content, bytes):
            content_bytes = body.content
        elif isinstance(body.content, str):
            content_bytes = body.content.encode("utf-8")
        else:
            content_bytes = _json.dumps(body.content, ensure_ascii=False).encode("utf-8")

    who = f"user:{current_user.user_id}"
    result = await ops.write_file(
        project_id, clean_path, content_bytes,
        who=who, message=body.message or f"edit {clean_path}",
    )

    return ApiResponse.success(data={
        "version": result.version,
        "path": clean_path,
        "merged": result.merged,
        "conflicts": result.conflicts,
    })


@router.post(
    "/{project_id}/mkdir",
    summary="创建目录",
)
async def mkdir(
    project_id: str,
    body: MkdirRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"
    result = await ops.mkdir(project_id, body.path, who=who)
    return ApiResponse.success(data={"path": body.path.strip("/"), "version": result.version})


@router.post(
    "/{project_id}/mv",
    summary="移动/重命名",
)
async def move(
    project_id: str,
    body: MoveRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"

    try:
        result = await ops.move(
            project_id, body.old_path, body.new_path,
            who=who, message=body.message or f"moved {body.old_path} → {body.new_path}",
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ApiResponse.success(data={
        "version": result.version,
        "old_path": body.old_path.strip("/"),
        "new_path": body.new_path.strip("/"),
    })


@router.post(
    "/{project_id}/rm",
    summary="删除（移入 .trash）",
)
async def remove(
    project_id: str,
    body: RemoveRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"
    clean_path = body.path.strip("/")

    if body.permanent:
        result = await ops.permanent_delete(project_id, clean_path, who=who)
        return ApiResponse.success(data={
            "version": result.version,
            "path": clean_path,
        })
    else:
        result = await ops.trash(project_id, clean_path, who=who)
        trash_path = [p for p in result.paths if p.startswith(".trash/")]
        return ApiResponse.success(data={
            "version": result.version,
            "path": clean_path,
            "old_path": clean_path,
            "new_path": trash_path[0] if trash_path else "",
        })


@router.post(
    "/{project_id}/restore",
    summary="从 .trash 恢复",
)
async def restore(
    project_id: str,
    body: RestoreRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"

    result = await ops.restore(
        project_id, body.trash_path, body.original_path, who=who,
    )

    return ApiResponse.success(data={
        "version": result.version,
        "old_path": body.trash_path.strip("/"),
        "new_path": body.original_path.strip("/"),
    })


@router.post(
    "/{project_id}/bulk-write",
    summary="批量写入文件",
)
async def bulk_write(
    project_id: str,
    body: BulkWriteRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    modified: dict[str, bytes] = {}
    for item in body.files:
        clean_path = item.path.strip("/")
        if item.node_type == "json":
            content_bytes = _json.dumps(item.content, ensure_ascii=False, indent=2).encode("utf-8")
            if not clean_path.endswith(".json"):
                clean_path += ".json"
        elif item.node_type == "markdown":
            content_bytes = (item.content if isinstance(item.content, str) else str(item.content)).encode("utf-8")
            if not clean_path.endswith(".md"):
                clean_path += ".md"
        else:
            content_bytes = (item.content if isinstance(item.content, str) else _json.dumps(item.content)).encode("utf-8")
        modified[clean_path] = content_bytes

    who = f"user:{current_user.user_id}"
    result = await ops.bulk_write(
        project_id, modified, who=who,
        message=body.message or "bulk write",
    )

    return ApiResponse.success(data={
        "version": result.version,
        "total": len(modified),
        "merged": result.merged,
    })


# ═══════════════════════════════════════════════
# 版本历史 API (uses MutWriteService for admin/history queries)
# ═══════════════════════════════════════════════

@router.get(
    "/{project_id}/versions",
    response_model=ApiResponse[VersionHistoryResponse],
    summary="版本历史",
)
async def get_versions(
    project_id: str,
    path: str = Query(None, description="文件路径（不传 = 项目级历史）"),
    limit: int = Query(50, description="最大返回数"),
    since_version: int = Query(0, description="从此版本之后开始"),
    mut_write: MutWriteService = Depends(get_mut_write_service),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    entries = await mut_write.get_version_history(
        project_id=project_id,
        path=path.strip("/") if path else None,
        limit=limit,
        since_version=since_version,
    )
    current_version = ops.get_version(project_id)

    versions = []
    for e in entries:
        versions.append(FileVersionInfo(
            version=e.get("version", 0),
            who=e.get("who", ""),
            message=e.get("message", ""),
            changes=e.get("changes") or [],
            conflicts=e.get("conflicts") or [],
            root_hash=e.get("root_hash", ""),
            scope_path=e.get("scope_path", ""),
            created_at=e.get("created_at"),
        ))

    root_hash = ops.get_root_hash(project_id) or ""

    return ApiResponse.success(data=VersionHistoryResponse(
        project_id=project_id,
        path=path,
        current_version=current_version,
        root_hash=root_hash,
        commits=versions,
        total=len(versions),
    ))


@router.get(
    "/{project_id}/version-content",
    summary="获取某版本的文件内容",
)
async def get_version_content(
    project_id: str,
    path: str = Query(..., description="文件路径"),
    version: int = Query(..., description="版本号"),
    mut_write: MutWriteService = Depends(get_mut_write_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    clean_path = path.strip("/")
    try:
        content = await mut_write.get_version_content(project_id, clean_path, version)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))

    from src.mut_engine.tree_reader import detect_type
    node_type = detect_type(clean_path)

    if node_type == "json":
        try:
            return ApiResponse.success(data={
                "path": clean_path,
                "version": version,
                "type": "json",
                "content": _json.loads(content.decode("utf-8")),
            })
        except (ValueError, UnicodeDecodeError):
            pass

    return ApiResponse.success(data={
        "path": clean_path,
        "version": version,
        "type": node_type,
        "content_text": content.decode("utf-8", errors="replace"),
    })


@router.get(
    "/{project_id}/diff",
    summary="对比两个版本",
)
async def diff_versions(
    project_id: str,
    v1: int = Query(..., description="版本 1"),
    v2: int = Query(..., description="版本 2"),
    mut_write: MutWriteService = Depends(get_mut_write_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    try:
        changes = await mut_write.compute_diff(project_id, v1, v2)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ApiResponse.success(data={
        "project_id": project_id,
        "v1": v1,
        "v2": v2,
        "changes": changes,
    })


@router.post(
    "/{project_id}/rollback",
    response_model=ApiResponse[RollbackResponse],
    summary="回滚到指定版本",
)
async def rollback(
    project_id: str,
    body: RollbackRequest,
    mut_write: MutWriteService = Depends(get_mut_write_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    try:
        new_version = await mut_write.rollback(
            project_id=project_id,
            target_version=body.target_version,
            operator=f"user:{current_user.user_id}",
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ApiResponse.success(data=RollbackResponse(
        project_id=project_id,
        new_version=new_version,
        rolled_back_to=body.target_version,
    ))

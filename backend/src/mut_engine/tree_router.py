"""
Tree API — Mut tree 的 REST 接口

所有操作通过 MUT protocol (MutEphemeralClient in-process)。
读操作: clone()/pull() 获取 scope 下的文件快照
写操作: clone() → 修改 → push()，走 MUT 完整 conflict detection

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

import asyncio
import json as _json

from fastapi import APIRouter, Depends, Query, HTTPException

from src.mut_engine.tree_reader import MutTreeReader, MutEntry
from src.mut_engine.dependencies import (
    get_repo_manager,
    get_tree_reader,
    get_mut_write_service,
)
from src.mut_engine.ephemeral_client import MutEphemeralClient
from src.mut_engine.repo_manager import MutRepoManager
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


def _make_user_client(
    repo_manager: MutRepoManager,
    project_id: str,
    user_id: str,
) -> MutEphemeralClient:
    """Create an ephemeral MUT client for a human user (root rw scope)."""
    auth = {
        "agent": f"user:{user_id}",
        "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
    }
    return MutEphemeralClient(repo_manager, project_id, auth)


# ═══════════════════════════════════════════════
# 读取 API (via MutTreeReader — lightweight, no clone overhead)
# ═══════════════════════════════════════════════

@router.get(
    "/{project_id}/ls",
    response_model=ApiResponse[ListDirResponse],
    summary="列出目录内容",
)
def list_dir(
    project_id: str,
    path: str = Query("", description="目录路径，空 = 根目录"),
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entries = reader.list_dir(project_id, clean_path)
    entries = [e for e in entries if not e.path.startswith(".trash/") and e.path != ".trash"]
    version = reader.get_version(project_id)

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
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    try:
        content = reader.read_file(project_id, clean_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {clean_path}")

    entry = reader.stat(project_id, clean_path)
    node_type = entry.type if entry else "file"
    version = reader.get_version(project_id)

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
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entry = reader.stat(project_id, clean_path)
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
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entries = reader.list_tree(project_id, clean_path, max_depth=max_depth)
    entries = [e for e in entries if not e.path.startswith(".trash/") and e.path != ".trash"]
    version = reader.get_version(project_id)

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
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    entries = reader.list_dir(project_id, ".trash")
    return ApiResponse.success(data=TrashListResponse(
        entries=[_entry_to_response(e) for e in entries],
    ))


# ═══════════════════════════════════════════════
# 写入 API (via MutEphemeralClient — full MUT protocol)
# ═══════════════════════════════════════════════

@router.post(
    "/{project_id}/write",
    summary="写入文件",
)
async def write_file_endpoint(
    project_id: str,
    body: WriteFileRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
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

    client = _make_user_client(repo_manager, project_id, current_user.user_id)
    await asyncio.to_thread(client.clone)

    result = await asyncio.to_thread(
        client.push,
        modified={clean_path: content_bytes},
        message=body.message or f"edit {clean_path}",
    )

    return ApiResponse.success(data={
        "version": result.get("version", 0),
        "path": clean_path,
        "op": "modified" if clean_path in client.files else "added",
        "merged": result.get("merged", False),
        "conflicts": result.get("conflicts", 0),
    })


@router.post(
    "/{project_id}/mkdir",
    summary="创建目录",
)
async def mkdir(
    project_id: str,
    body: MkdirRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = body.path.strip("/")
    keep_path = f"{clean_path}/.keep"

    client = _make_user_client(repo_manager, project_id, current_user.user_id)
    await asyncio.to_thread(client.clone)

    result = await asyncio.to_thread(
        client.push,
        modified={keep_path: b""},
        message=f"mkdir {clean_path}",
    )

    return ApiResponse.success(data={"path": clean_path, "version": result.get("version", 0)})


@router.post(
    "/{project_id}/mv",
    summary="移动/重命名",
)
async def move(
    project_id: str,
    body: MoveRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    old_path = body.old_path.strip("/")
    new_path = body.new_path.strip("/")

    client = _make_user_client(repo_manager, project_id, current_user.user_id)
    files = await asyncio.to_thread(client.clone)

    modified: dict[str, bytes] = {}
    deleted: list[str] = []

    entry = reader.stat(project_id, old_path)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Path not found: {old_path}")

    if entry.type == "folder":
        old_prefix = old_path + "/"
        for path, content in files.items():
            if path == old_path or path.startswith(old_prefix):
                suffix = path[len(old_path):]
                modified[new_path + suffix] = content
                deleted.append(path)
    else:
        content = files.get(old_path)
        if content is None:
            raise HTTPException(status_code=404, detail=f"File not found: {old_path}")
        modified[new_path] = content
        deleted.append(old_path)

    result = await asyncio.to_thread(
        client.push,
        modified=modified,
        deleted=deleted,
        message=body.message or f"moved {old_path} → {new_path}",
    )

    return ApiResponse.success(data={
        "version": result.get("version", 0),
        "old_path": old_path,
        "new_path": new_path,
    })


@router.post(
    "/{project_id}/rm",
    summary="删除（移入 .trash）",
)
async def remove(
    project_id: str,
    body: RemoveRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = body.path.strip("/")
    operator = f"user:{current_user.user_id}"

    if body.permanent:
        client = _make_user_client(repo_manager, project_id, current_user.user_id)
        files = await asyncio.to_thread(client.clone)

        deleted: list[str] = []
        entry = reader.stat(project_id, clean_path)
        if entry and entry.type == "folder":
            prefix = clean_path + "/"
            for path in files:
                if path == clean_path or path.startswith(prefix):
                    deleted.append(path)
        else:
            deleted.append(clean_path)

        result = await asyncio.to_thread(
            client.push,
            deleted=deleted,
            message=f"deleted {clean_path}",
        )
        return ApiResponse.success(data={
            "version": result.get("version", 0),
            "path": clean_path,
        })
    else:
        import time
        basename = clean_path.rsplit("/", 1)[-1] if "/" in clean_path else clean_path
        trash_path = f".trash/{basename}_{int(time.time())}"

        client = _make_user_client(repo_manager, project_id, current_user.user_id)
        files = await asyncio.to_thread(client.clone)

        modified: dict[str, bytes] = {}
        deleted_list: list[str] = []

        entry = reader.stat(project_id, clean_path)
        if entry and entry.type == "folder":
            prefix = clean_path + "/"
            for path, content in files.items():
                if path == clean_path or path.startswith(prefix):
                    suffix = path[len(clean_path):]
                    modified[trash_path + suffix] = content
                    deleted_list.append(path)
        else:
            content = files.get(clean_path, b"")
            modified[trash_path] = content
            deleted_list.append(clean_path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted_list,
            message=f"trash {basename}",
        )

        return ApiResponse.success(data={
            "version": result.get("version", 0),
            "path": clean_path,
            "old_path": clean_path,
            "new_path": trash_path,
        })


@router.post(
    "/{project_id}/restore",
    summary="从 .trash 恢复",
)
async def restore(
    project_id: str,
    body: RestoreRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    reader: MutTreeReader = Depends(get_tree_reader),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    trash_path = body.trash_path.strip("/")
    original_path = body.original_path.strip("/")

    client = _make_user_client(repo_manager, project_id, current_user.user_id)
    files = await asyncio.to_thread(client.clone)

    modified: dict[str, bytes] = {}
    deleted: list[str] = []

    entry = reader.stat(project_id, trash_path)
    if entry and entry.type == "folder":
        prefix = trash_path + "/"
        for path, content in files.items():
            if path == trash_path or path.startswith(prefix):
                suffix = path[len(trash_path):]
                modified[original_path + suffix] = content
                deleted.append(path)
    else:
        content = files.get(trash_path, b"")
        modified[original_path] = content
        deleted.append(trash_path)

    result = await asyncio.to_thread(
        client.push,
        modified=modified,
        deleted=deleted,
        message=f"restore {original_path}",
    )

    return ApiResponse.success(data={
        "version": result.get("version", 0),
        "old_path": trash_path,
        "new_path": original_path,
    })


@router.post(
    "/{project_id}/bulk-write",
    summary="批量写入文件",
)
async def bulk_write(
    project_id: str,
    body: BulkWriteRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    client = _make_user_client(repo_manager, project_id, current_user.user_id)
    await asyncio.to_thread(client.clone)

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

    result = await asyncio.to_thread(
        client.push,
        modified=modified,
        message=body.message or "bulk write",
    )

    return ApiResponse.success(data={
        "version": result.get("version", 0),
        "total": len(modified),
        "merged": result.get("merged", False),
    })


# ═══════════════════════════════════════════════
# 版本历史 API
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
    reader: MutTreeReader = Depends(get_tree_reader),
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
    current_version = reader.get_version(project_id)

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

    root_hash = reader.get_root_hash(project_id) or ""

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

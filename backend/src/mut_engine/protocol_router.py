"""
MUT Protocol Router — MutOps 的 MUT 线协议 HTTP 外壳

将 MUT 原生 HTTP 同步协议暴露给外部客户端:
  - CLI daemon 通过 clone/push/pull 同步本地文件夹
  - 远程 MUT client 通过标准协议操作内容树

MutOps 是唯一的操作入口，本文件只做:
  HTTP 参数解析 + 认证 + 调用 MutOps.handle_* + 日志
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from mut.foundation.error import PermissionDenied, LockError

from src.mut_engine.auth import get_mut_auth
from src.mut_engine.ops import MutOps
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.write_service import MutWriteService
from src.mut_engine.repo_manager import MutRepoManager
from src.mut_engine.dependencies import get_repo_manager
from src.utils.logger import log_info, log_error

router = APIRouter(prefix="/api/v1/mut")


@router.post("/{project_id}/clone")
async def mut_clone(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    ops: MutOps = Depends(get_mut_ops),
):
    """Clone a project scope (like `git clone`)."""
    body = await request.json()

    try:
        result = await asyncio.to_thread(ops.handle_clone, project_id, auth, body)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] clone failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Clone failed: {e}")

    log_info(f"[MUT] clone project={project_id} agent={auth['agent']}")
    return JSONResponse(result)


@router.post("/{project_id}/push")
async def mut_push(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    ops: MutOps = Depends(get_mut_ops),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Push changes to server (like `git push`). Includes server-side merge."""
    body = await request.json()

    try:
        result = await asyncio.to_thread(ops.handle_push, project_id, auth, body)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] push failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Push failed: {e}")

    _run_post_push_hook(project_id, repo_manager, result)

    log_info(
        f"[MUT] push project={project_id} agent={auth['agent']} "
        f"v={result.get('version')} merged={result.get('merged', False)}"
    )
    return JSONResponse(result)


@router.post("/{project_id}/pull")
async def mut_pull(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    ops: MutOps = Depends(get_mut_ops),
):
    """Pull latest changes (like `git pull`)."""
    body = await request.json()

    try:
        result = await asyncio.to_thread(ops.handle_pull, project_id, auth, body)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] pull failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Pull failed: {e}")

    log_info(
        f"[MUT] pull project={project_id} agent={auth['agent']} "
        f"status={result.get('status')}"
    )
    return JSONResponse(result)


@router.post("/{project_id}/negotiate")
async def mut_negotiate(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    ops: MutOps = Depends(get_mut_ops),
):
    """Hash negotiation for object dedup (reduces transfer size)."""
    body = await request.json()

    try:
        result = await asyncio.to_thread(ops.handle_negotiate, project_id, auth, body)
    except Exception as e:
        log_error(f"[MUT] negotiate failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Negotiate failed: {e}")

    return JSONResponse(result)


def _run_post_push_hook(
    project_id: str, repo_manager: MutRepoManager, push_result: dict
) -> None:
    """Post-commit consistency hook after MUT protocol push."""
    version = push_result.get("version")
    if not version or push_result.get("status") != "ok":
        return

    try:
        repo = repo_manager.get_repo(project_id)
        entry = repo.history.get_entry(version)
        if not entry:
            return

        changes = entry.get("changes", [])
        if isinstance(changes, str):
            import json
            changes = json.loads(changes)

        deleted_paths = [
            c["path"] for c in changes
            if c.get("action") == "delete" or c.get("op") == "deleted"
        ]

        if deleted_paths:
            write_svc = MutWriteService(repo_manager)
            write_svc._post_commit_delete(project_id, deleted_paths)

    except Exception as e:
        log_error(f"[MUT] post-push hook failed for project {project_id}: {e}")

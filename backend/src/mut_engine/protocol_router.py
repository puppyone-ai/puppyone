"""
MUT Protocol Router — clone/push/pull/negotiate 端点

将 MUT 原生 HTTP 同步协议暴露给 PuppyOne 客户端:
  - Agent 通过 `mut clone/push/pull` 操作内容树
  - 本地文件夹同步通过 MUT 协议替代 OpenClaw
  - Sandbox 通过 `mut clone` 加载文件，`mut push` 写回

所有端点使用 PuppyOneServerRepo 适配器，底层 S3 + Supabase。
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from mut.server.handlers import (
    handle_clone,
    handle_push,
    handle_pull,
    handle_negotiate,
)
from mut.foundation.error import PermissionDenied, LockError

from src.mut_engine.auth import get_mut_auth
from src.mut_engine.dependencies import get_repo_manager
from src.mut_engine.repo_manager import MutRepoManager
from src.mut_engine.write_service import MutWriteService
from src.utils.logger import log_info, log_error

router = APIRouter(prefix="/api/v1/mut")


@router.post("/{project_id}/clone")
async def mut_clone(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Clone a project scope (like `git clone`)."""
    body = await request.json()
    server_repo = repo_manager.get_server_repo(project_id)

    try:
        result = await asyncio.to_thread(handle_clone, server_repo, auth, body)
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
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Push changes to server (like `git push`). Includes server-side merge."""
    body = await request.json()
    server_repo = repo_manager.get_server_repo(project_id)

    try:
        result = await asyncio.to_thread(handle_push, server_repo, auth, body)
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
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Pull latest changes (like `git pull`)."""
    body = await request.json()
    server_repo = repo_manager.get_server_repo(project_id)

    try:
        result = await asyncio.to_thread(handle_pull, server_repo, auth, body)
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
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Hash negotiation for object dedup (reduces transfer size)."""
    body = await request.json()
    server_repo = repo_manager.get_server_repo(project_id)

    try:
        result = await asyncio.to_thread(handle_negotiate, server_repo, auth, body)
    except Exception as e:
        log_error(f"[MUT] negotiate failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Negotiate failed: {e}")

    return JSONResponse(result)


def _run_post_push_hook(
    project_id: str, repo_manager: MutRepoManager, push_result: dict
) -> None:
    """Run post-commit consistency hook after MUT protocol push.

    Reads the newly created history entry to extract changes,
    then delegates to MutWriteService's consistency hooks.
    """
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

"""
MUT Protocol Router — clone/push/pull/negotiate 端点

将 MUT 原生 HTTP 同步协议暴露给 PuppyOne 客户端:
  - Agent 通过 `mut clone/push/pull` 操作内容树
  - 本地文件夹同步通过 MUT 协议替代 OpenClaw
  - Sandbox 通过 `mut clone` 加载文件，`mut push` 写回

所有端点使用 PuppyOneServerRepo 适配器，底层 S3 + Supabase。
Push 后自动触发 IndexSync 保持 content_nodes 同步。
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
from src.mut_engine.dependencies import get_repo_manager, get_index_sync
from src.mut_engine.repo_manager import MutRepoManager
from src.mut_engine.index_sync import IndexSync
from src.utils.logger import log_info, log_error

router = APIRouter(prefix="/api/v1/mut")


def _map_changeset_ops(changes: list[dict]) -> list[dict]:
    """Map MUT handler changeset format (action) to IndexSync format (op)."""
    op_map = {"add": "added", "update": "modified", "delete": "deleted"}
    return [
        {"path": c["path"], "op": op_map.get(c.get("action", ""), c.get("action", ""))}
        for c in changes
    ]


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
    index_sync: IndexSync = Depends(get_index_sync),
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

    if result.get("status") == "ok" and result.get("version"):
        changes = result.get("changes", [])
        if not changes:
            changes = body.get("_changes", [])
        mapped = _map_changeset_ops(changes)
        if mapped:
            proj_repo = repo_manager.get_repo(project_id)
            try:
                await index_sync.sync_changeset(
                    project_id=project_id,
                    store=proj_repo.store,
                    changes=mapped,
                    root_hash=result.get("root", ""),
                    version=result["version"],
                    operator_id=auth.get("agent"),
                )
            except Exception as e:
                log_error(f"[MUT] IndexSync failed after push: {e}")

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

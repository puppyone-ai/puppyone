"""
MUT Protocol Router — HTTP shell for the MUT wire protocol.

Exposes the MUT native HTTP sync protocol to external clients:
  - CLI daemon syncs local folders via clone/push/pull
  - Remote MUT clients operate on the content tree via the standard protocol

This router is a thin HTTP shell: it handles parameter parsing, authentication,
delegates to mut.server.handlers via MutRepoManager, and formats responses.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from mut.foundation.error import LockError, PermissionDenied
from mut.server.handlers import (
    handle_clone,
    handle_negotiate,
    handle_pull,
    handle_push,
)

from src.mut_engine.dependencies import get_repo_manager
from src.mut_engine.server.auth import get_mut_auth
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.services.hooks import run_post_push_hook
from src.utils.logger import log_error, log_info

router = APIRouter(prefix="/api/v1/mut")


def _invoke(handler_fn, repo_manager: MutRepoManager, project_id: str, auth: dict, body: dict) -> dict:
    """Resolve ServerRepo and call a MUT protocol handler (runs in worker thread)."""
    repo = repo_manager.get_server_repo(project_id)
    return handler_fn(repo, auth, body)


@router.post("/{project_id}/clone")
async def mut_clone(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Clone a project scope (like `git clone`)."""
    body = await request.json()

    try:
        result = await asyncio.to_thread(
            _invoke, handle_clone, repo_manager, project_id, auth, body,
        )
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

    from src.mut_engine.server.validation import validate_push_objects
    validate_push_objects(body)

    try:
        result = await asyncio.to_thread(
            _invoke, handle_push, repo_manager, project_id, auth, body,
        )
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] push failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Push failed: {e}")

    await asyncio.to_thread(run_post_push_hook, project_id, repo_manager, result)

    log_info(
        f"[MUT] push project={project_id} agent={auth['agent']} "
        f"commit={result.get('commit_id')} merged={result.get('merged', False)}"
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

    try:
        result = await asyncio.to_thread(
            _invoke, handle_pull, repo_manager, project_id, auth, body,
        )
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

    try:
        result = await asyncio.to_thread(
            _invoke, handle_negotiate, repo_manager, project_id, auth, body,
        )
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] negotiate failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Negotiate failed: {e}")

    return JSONResponse(result)


@router.post("/{project_id}/rollback")
async def mut_rollback(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Rollback to a historical commit (creates a revert commit)."""
    from mut.server.handlers import handle_rollback

    body = await request.json()

    try:
        result = await asyncio.to_thread(
            _invoke, handle_rollback, repo_manager, project_id, auth, body,
        )
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] rollback failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    await asyncio.to_thread(run_post_push_hook, project_id, repo_manager, result)

    log_info(
        f"[MUT] rollback project={project_id} agent={auth['agent']} "
        f"target={result.get('target_commit_id')} new={result.get('new_commit_id')}"
    )
    return JSONResponse(result)


@router.post("/{project_id}/pull-commit")
async def mut_pull_commit(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Pull files at a specific historical commit (not just latest)."""
    from mut.server.handlers import handle_pull_commit

    body = await request.json()

    try:
        result = await asyncio.to_thread(
            _invoke, handle_pull_commit, repo_manager, project_id, auth, body,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] pull-commit failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Pull commit failed: {e}")

    log_info(
        f"[MUT] pull-commit project={project_id} agent={auth['agent']} "
        f"commit={result.get('commit_id')}"
    )
    return JSONResponse(result)

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
from mut.core.protocol import require_supported_protocol
from mut.foundation.error import ClientTooOldError, LockError, PermissionDenied
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


def _raise_too_old(e: ClientTooOldError):
    """Lift a protocol-version rejection out of handler threads as an
    HTTP 426 Upgrade Required.

    The generic ``except Exception`` arms further down would otherwise
    flatten this to a 500 and strip the semantic cue the client's
    transport layer needs to print "please upgrade" instead of the
    default "server error" / "cannot reach server" message.
    """
    raise HTTPException(status_code=e.http_status, detail=str(e))


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
    except ClientTooOldError as e:
        _raise_too_old(e)
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

    # Protocol-version gate runs *before* size validation so an outdated
    # client gets a clear 426 ("upgrade your client") instead of a
    # misleading 413 ("payload too large") when it ships a fat push.
    try:
        require_supported_protocol(body)
    except ClientTooOldError as e:
        _raise_too_old(e)

    from src.mut_engine.server.validation import validate_push_objects
    validate_push_objects(body)

    # Parallel object upload — consolidates the negotiate + push dedup flow.
    #
    # Without this: negotiate checks exists(h) × N serially, returns missing list.
    # Client sends only missing objects. Then _store_incoming_objects inside
    # handle_push calls put(data) → _do_put → file_exists(h) AGAIN + upload(h).
    # That's 2 × N serial S3 calls for objects that negotiate already confirmed missing.
    #
    # With this: we upload all objects in parallel here (20 concurrent),
    # then clear body["objects"] so _store_incoming_objects iterates an empty dict.
    # Saves: N serial HEAD checks + N serial PUTs → replaced by N parallel PUTs.
    import base64
    objects_b64 = body.get("objects", {})
    if objects_b64:
        repo = repo_manager.get_server_repo(project_id)
        if hasattr(repo.store, "async_put_many"):
            decoded = {}
            for h, b64 in objects_b64.items():
                raw = base64.b64decode(b64)
                # ObjectStore.put(data) computes hash internally via hash_bytes(data).
                # We need to store under that computed hash, not the client-provided key.
                from mut.foundation.hash import hash_bytes as mut_hash
                real_hash = mut_hash(raw)
                decoded[real_hash] = raw
            await repo.store.async_put_many(decoded, skip_exists=True)
            # Clear objects so handle_push's _store_incoming_objects is a no-op
            body["objects"] = {}

    try:
        result = await asyncio.to_thread(
            _invoke, handle_push, repo_manager, project_id, auth, body,
        )
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] push failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Push failed: {e}")

    # Run post-push hook (graft) in background — don't block the push response.
    # The graft makes changes visible in the global root tree, but the scope
    # data is already committed and consistent. The client can proceed immediately.
    asyncio.get_event_loop().run_in_executor(
        None, run_post_push_hook, project_id, repo_manager, result,
    )

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
    except ClientTooOldError as e:
        _raise_too_old(e)
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
    """Hash negotiation for object dedup (reduces transfer size).

    Optimized: uses parallel S3 existence checks instead of serial.
    """
    body = await request.json()

    try:
        require_supported_protocol(body)
    except ClientTooOldError as e:
        _raise_too_old(e)

    hashes = body.get("hashes", [])
    if not hashes:
        return JSONResponse({"missing": []})

    repo = repo_manager.get_server_repo(project_id)
    store = repo.store

    # Parallel existence check — 20x faster than serial for many objects
    if hasattr(store, "async_exists_many"):
        existing = await store.async_exists_many(hashes)
        missing = [h for h in hashes if h not in existing]
    else:
        # Fallback to serial (non-S3 stores)
        result = await asyncio.to_thread(
            _invoke, handle_negotiate, repo_manager, project_id, auth, body,
        )
        return JSONResponse(result)

    return JSONResponse({"missing": missing})


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
    except ClientTooOldError as e:
        _raise_too_old(e)
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
    except ClientTooOldError as e:
        _raise_too_old(e)
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

"""
MUT Protocol Router — HTTP shell for the MUT wire protocol.

Exposes the MUT native HTTP sync protocol to external clients:
  - CLI daemon syncs local folders via clone/push/pull
  - Remote MUT clients operate on the content tree via the standard protocol

This router is a thin HTTP shell: it handles parameter parsing, authentication,
delegates to local legacy MUT handlers via MutRepoManager, and formats responses.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from src.mut_engine.adapters.mut.protocol import require_supported_protocol
from src.mut_engine.adapters.mut.legacy_handlers import (
    handle_clone,
    handle_negotiate,
    handle_pull,
    handle_scopes,
)
from src.mut_engine.application.errors import ClientTooOldError, LockError, PermissionDenied

from src.mut_engine.adapters.mut.push_adapter import submit_mut_push
from src.mut_engine.adapters.mut.rollback_adapter import submit_mut_rollback
from src.mut_engine.application.protocol_mode import ensure_protocol_enabled
from src.mut_engine.dependencies import get_repo_manager
from src.mut_engine.server.auth import get_mut_auth
from src.mut_engine.server.repo_manager import MutRepoManager
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
    await ensure_protocol_enabled(project_id, "mut")

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
    await ensure_protocol_enabled(project_id, "mut")

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
    # Wire format (post feat/git-format-storage in mut/): each ``objects``
    # entry is ``{<sha1_hex>: <base64-of-zlib-loose-bytes>}``. The hash is
    # the SHA-1 of the framed git object header+content; the value is the
    # zlib-compressed loose-object bytes.  We must store the loose bytes
    # verbatim under the supplied hash — re-deriving the hash from the
    # bytes (as the old code did via ``hash_bytes(raw)``) would compute
    # SHA-1(blob<size>\0<loose_bytes>) instead of the correct identity.
    #
    # Without this optimisation: negotiate checks exists(h) × N serially,
    # then the MUT push adapter stores each object again while translating the
    # request into a version intent. With parallel upload we collapse the 2N
    # round trips into N parallel PUTs and clear ``body["objects"]`` so the
    # adapter's object store step becomes a no-op.
    import base64
    objects_b64 = body.get("objects", {})
    if objects_b64:
        repo = repo_manager.get_server_repo(project_id)
        # ``ObjectStore`` itself doesn't expose batch upload — go through
        # the underlying ``S3StorageBackend`` (or whatever store wraps).
        backend = getattr(repo.store, "_backend", None)
        if backend is not None and hasattr(backend, "async_put_many"):
            decoded = {
                h: base64.b64decode(b64) for h, b64 in objects_b64.items()
            }
            await backend.async_put_many(decoded, skip_exists=True)
            # Clear so the MUT adapter's object ingest step is a no-op.
            body["objects"] = {}

    try:
        result = await submit_mut_push(repo_manager, project_id, auth, body)
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] push failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Push failed: {e}")

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
    await ensure_protocol_enabled(project_id, "mut")

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
    await ensure_protocol_enabled(project_id, "mut")

    try:
        require_supported_protocol(body)
    except ClientTooOldError as e:
        _raise_too_old(e)

    hashes = body.get("hashes", [])
    if not hashes:
        return JSONResponse({"missing": []})

    repo = repo_manager.get_server_repo(project_id)
    backend = getattr(repo.store, "_backend", None)

    # Parallel existence check on the backend — 20x faster than serial.
    if backend is not None and hasattr(backend, "async_exists_many"):
        existing = await backend.async_exists_many(hashes)
        missing = [h for h in hashes if h not in existing]
        return JSONResponse({"missing": missing})

    # Fallback to serial via the standard handler (non-S3 stores).
    result = await asyncio.to_thread(
        _invoke, handle_negotiate, repo_manager, project_id, auth, body,
    )
    return JSONResponse(result)


@router.post("/{project_id}/rollback")
async def mut_rollback(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Rollback to a historical commit (creates a revert commit)."""
    body = await request.json()
    await ensure_protocol_enabled(project_id, "mut")

    try:
        result = await submit_mut_rollback(repo_manager, project_id, auth, body)
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] rollback failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    log_info(
        f"[MUT] rollback project={project_id} agent={auth['agent']} "
        f"target={result.get('target_commit_id')} new={result.get('new_commit_id')}"
    )
    return JSONResponse(result)


@router.post("/{project_id}/scopes")
async def mut_scopes(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """List the scope this credential is bound to + descendants.

    Mirrors ``mut.server.handlers.handle_scopes`` — returns
    ``{"owned": ScopeInfo, "descendants": [ScopeInfo]}``. Read-only;
    safe to call from any auth context that already passed ``get_mut_auth``.
    """
    body = await request.json()
    await ensure_protocol_enabled(project_id, "mut")
    try:
        result = await asyncio.to_thread(
            _invoke, handle_scopes, repo_manager, project_id, auth, body,
        )
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"[MUT] scopes failed for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Scopes failed: {e}")

    log_info(f"[MUT] scopes project={project_id} agent={auth['agent']}")
    return JSONResponse(result)


@router.post("/{project_id}/pull-commit")
async def mut_pull_commit(
    project_id: str,
    request: Request,
    auth: dict = Depends(get_mut_auth),
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Pull files at a specific historical commit (not just latest)."""
    from src.mut_engine.adapters.mut.legacy_handlers import handle_pull_commit

    body = await request.json()
    await ensure_protocol_enabled(project_id, "mut")

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

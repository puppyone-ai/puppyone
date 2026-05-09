"""
Access Point — unified entry for MUT clients.

An Access Point is a URL + credential that gives a MUT client everything
it needs to connect. The client doesn't know about project_id, scope ids,
or platform concepts — just a URL and a key.

URL format: /api/v1/mut/ap/{access_key}/clone|push|pull|negotiate|rollback|pull-commit

The /api/v1 prefix is added by main.py via include_router(); this module's
APIRouter only knows the relative "/mut/ap" prefix. The single source of
truth for the composed public URL lives in src/mut_engine/_routes.py
(MUT_AP_PREFIX) — change that constant to break every client at once.

Per the access-point-redesign-2026-05-02, an access_key now maps to a
`repo_scopes` row. The row carries everything the auth context needs:

  - project_id: which MUT tree to operate on
  - path / exclude / mode: scope geometry
  - access_key_revoked_at: null if active, timestamp if revoked

This module provides:
  1. resolve_access_point() — lookup access_key → (project_id, auth_context)
  2. Access Point router — thin HTTP shell that delegates to mut.server.handlers
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from mut.core.protocol import require_supported_protocol
from mut.foundation.error import ClientTooOldError, LockError, PermissionDenied
from mut.server.handlers import (
    handle_clone,
    handle_negotiate,
    handle_pull,
    handle_push,
)

from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.auth import enforce_channel_pause
from src.mut_engine.services.hooks import run_post_push_hook
from src.utils.logger import log_error, log_info


def _resolve_via_repo_scopes(client, access_key: str) -> tuple[str, dict] | None:
    """Path A: post-redesign canonical lookup. Returns (project_id, auth) or
    None if the key isn't in repo_scopes. Raises 401 if the key IS in
    repo_scopes but is revoked (revocation must NOT silently fall through
    to the legacy table)."""
    resp = (
        client.table("repo_scopes")
        .select("id, project_id, path, exclude, mode, access_key_revoked_at")
        .eq("access_key", access_key)
        .maybe_single()
        .execute()
    )
    if not resp or not getattr(resp, "data", None):
        return None
    scope_row = resp.data
    if scope_row.get("access_key_revoked_at"):
        raise HTTPException(status_code=401, detail="Access point key has been revoked")
    project_id = scope_row["project_id"]
    return project_id, {
        "agent": f"scope:{scope_row['id']}",
        "_scope": {
            "id": scope_row["id"],
            "path": scope_row.get("path", ""),
            "exclude": scope_row.get("exclude") or [],
            "mode": scope_row.get("mode", "rw"),
        },
        "_project_id": project_id,
        "_user_identity": "",
    }


def _resolve_via_access_points(client, access_key: str) -> tuple[str, dict]:
    """Path B: legacy access_points + config.scope JSONB. Raises 401/403 on
    any failure; never returns None (this is the terminal lookup)."""
    resp = (
        client.table("access_points")
        .select("id, project_id, provider, config, revoked_at, status")
        .eq("access_key", access_key)
        .maybe_single()
        .execute()
    )
    if not resp or not getattr(resp, "data", None):
        raise HTTPException(status_code=401, detail="Invalid access point key")
    ap = resp.data
    if ap.get("revoked_at"):
        raise HTTPException(status_code=401, detail="Access point key has been revoked")
    if ap.get("status") not in (None, "active", "syncing"):
        raise HTTPException(status_code=403, detail="Access point is not active")

    cfg = ap.get("config") or {}
    raw_scope = cfg.get("scope") or {}
    project_id = ap["project_id"]
    return project_id, {
        "agent": ap["id"],
        "_scope": {
            "id": raw_scope.get("id", ap["id"]),
            "path": raw_scope.get("path", ""),
            "exclude": raw_scope.get("exclude") or [],
            "mode": raw_scope.get("mode", "rw"),
        },
        "_project_id": project_id,
        "_provider": ap.get("provider", "direct"),
        "_user_identity": cfg.get("user_identity", ""),
    }


def resolve_access_point(access_key: str) -> tuple[str, dict]:
    """Resolve an access_key to (project_id, auth_context).

    Resolution order (mirrors PuppyOneAuthenticator._try_access_key):
      1. repo_scopes (post-redesign canonical table)
      2. access_points + config.scope (legacy, transition-only)

    Path A wraps DB errors so a not-yet-migrated DB falls through to
    legacy. Once the data migration runs and access_points is dropped,
    only Path A produces results.

    Raises:
        HTTPException 401 if key is invalid / revoked / unknown to both tables.
    """
    from src.infra.supabase.client import SupabaseClient
    client = SupabaseClient().client

    try:
        result = _resolve_via_repo_scopes(client, access_key)
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[AP] repo_scopes lookup error (will try legacy): {e}")
        result = None

    if result is not None:
        return result

    try:
        return _resolve_via_access_points(client, access_key)
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[AP] access_points fallback lookup error: {e}")
        raise HTTPException(status_code=401, detail="Invalid access point key") from e


# ── Access Point Router ──────────────────────────────────────

ap_router = APIRouter(prefix="/mut/ap")


def _get_repo_manager() -> MutRepoManager:
    from src.mut_engine.dependencies import get_repo_manager_standalone
    return get_repo_manager_standalone()


def _invoke(handler_fn, repo_manager: MutRepoManager, project_id: str, auth: dict, body: dict) -> dict:
    """Resolve ServerRepo and call a MUT protocol handler (runs in worker thread)."""
    repo = repo_manager.get_server_repo(project_id)
    return handler_fn(repo, auth, body)


def _raise_too_old(e: ClientTooOldError) -> None:
    """Map a ClientTooOldError to HTTP 426 (Upgrade Required)."""
    raise HTTPException(status_code=426, detail=str(e))


async def _resolve_and_validate(access_key: str, request: Request) -> tuple[str, dict, MutRepoManager]:
    """Common resolve + identity check for all access point endpoints."""
    project_id, auth = await asyncio.to_thread(resolve_access_point, access_key)

    bound_identity = auth.get("_user_identity", "")
    if bound_identity:
        request_identity = request.headers.get("x-mut-user", "")
        if not request_identity:
            raise HTTPException(
                status_code=401,
                detail="X-Mut-User header required: key is bound to a specific user",
            )
        if request_identity != bound_identity:
            raise HTTPException(
                status_code=401,
                detail="User identity mismatch: key is bound to a different user",
            )

    enforce_channel_pause(
        auth, request.headers.get("x-puppy-client"),
        log_prefix="[AP]",
    )

    repo_manager = _get_repo_manager()
    return project_id, auth, repo_manager


@ap_router.post("/{access_key}/clone")
async def ap_clone(access_key: str, request: Request):
    """Clone via Access Point URL."""
    try:
        project_id, auth, repo_manager = await _resolve_and_validate(access_key, request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        result = await asyncio.to_thread(
            _invoke, handle_clone, repo_manager, project_id, auth, body,
        )
    except HTTPException:
        raise
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"[AP] clone failed: {e}")
        raise HTTPException(status_code=500, detail=f"Clone failed: {e}")

    log_info(f"[AP] clone ap={access_key[:8]}... project={project_id}")
    return JSONResponse(result)


@ap_router.post("/{access_key}/push")
async def ap_push(access_key: str, request: Request):
    """Push via Access Point URL."""
    try:
        project_id, auth, repo_manager = await _resolve_and_validate(access_key, request)
        body = await request.json()

        # Reject outdated clients up-front so the size validation below
        # cannot mask a 426 with a confusing 413 ("payload too large").
        require_supported_protocol(body)

        from src.mut_engine.server.validation import validate_push_objects
        validate_push_objects(body)

        result = await asyncio.to_thread(
            _invoke, handle_push, repo_manager, project_id, auth, body,
        )
    except HTTPException:
        raise
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        log_error(f"[AP] push failed: {e}")
        raise HTTPException(status_code=500, detail=f"Push failed: {e}")

    # Post-push hook in background — don't block the push response
    asyncio.get_event_loop().run_in_executor(
        None, run_post_push_hook, project_id, repo_manager, result,
    )

    log_info(
        f"[AP] push ap={access_key[:8]}... project={project_id} "
        f"commit={result.get('commit_id')} merged={result.get('merged', False)}"
    )
    return JSONResponse(result)


@ap_router.post("/{access_key}/pull")
async def ap_pull(access_key: str, request: Request):
    """Pull via Access Point URL."""
    try:
        project_id, auth, repo_manager = await _resolve_and_validate(access_key, request)
        body = await request.json()
        result = await asyncio.to_thread(
            _invoke, handle_pull, repo_manager, project_id, auth, body,
        )
    except HTTPException:
        raise
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log_error(f"[AP] pull failed: {e}")
        raise HTTPException(status_code=500, detail=f"Pull failed: {e}")

    log_info(f"[AP] pull ap={access_key[:8]}... status={result.get('status')}")
    return JSONResponse(result)


@ap_router.post("/{access_key}/negotiate")
async def ap_negotiate(access_key: str, request: Request):
    """Hash negotiation via Access Point URL — parallel existence checks."""
    try:
        project_id, auth, repo_manager = await _resolve_and_validate(access_key, request)
        body = await request.json()

        from mut.core.protocol import require_supported_protocol
        require_supported_protocol(body)

        hashes = body.get("hashes", [])
        if not hashes:
            return JSONResponse({"missing": []})

        repo = repo_manager.get_server_repo(project_id)
        store = repo.store
        if hasattr(store, "async_exists_many"):
            existing = await store.async_exists_many(hashes)
            missing = [h for h in hashes if h not in existing]
            result = {"missing": missing}
        else:
            result = await asyncio.to_thread(
                _invoke, handle_negotiate, repo_manager, project_id, auth, body,
            )
    except HTTPException:
        raise
    except ClientTooOldError as e:
        _raise_too_old(e)
    except Exception as e:
        log_error(f"[AP] negotiate failed: {e}")
        raise HTTPException(status_code=500, detail=f"Negotiate failed: {e}")

    return JSONResponse(result)


@ap_router.post("/{access_key}/rollback")
async def ap_rollback(access_key: str, request: Request):
    """Rollback via Access Point URL."""
    from mut.server.handlers import handle_rollback

    try:
        project_id, auth, repo_manager = await _resolve_and_validate(access_key, request)
        body = await request.json()
        result = await asyncio.to_thread(
            _invoke, handle_rollback, repo_manager, project_id, auth, body,
        )
    except HTTPException:
        raise
    except ClientTooOldError as e:
        _raise_too_old(e)
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(f"[AP] rollback failed: {e}")
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    await asyncio.to_thread(run_post_push_hook, project_id, repo_manager, result)

    log_info(f"[AP] rollback ap={access_key[:8]}... target={result.get('target_commit_id')}")
    return JSONResponse(result)


@ap_router.post("/{access_key}/pull-commit")
async def ap_pull_commit(access_key: str, request: Request):
    """Pull a specific historical commit via Access Point URL."""
    from mut.server.handlers import handle_pull_commit

    try:
        project_id, auth, repo_manager = await _resolve_and_validate(access_key, request)
        body = await request.json()
        result = await asyncio.to_thread(
            _invoke, handle_pull_commit, repo_manager, project_id, auth, body,
        )
    except HTTPException:
        raise
    except ClientTooOldError as e:
        _raise_too_old(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log_error(f"[AP] pull-commit failed: {e}")
        raise HTTPException(status_code=500, detail=f"Pull commit failed: {e}")

    log_info(f"[AP] pull-commit ap={access_key[:8]}... commit={result.get('commit_id')}")
    return JSONResponse(result)

"""Git protocol routes.

The router is intentionally thin: it resolves authentication and request
shape, then delegates protocol work to receive-pack/upload-pack modules.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from src.mut_engine.adapters.git.auth import (
    request_actor,
    resolve_git_project_auth,
    scope_excludes_for_auth,
    scope_path_for_auth,
)
from src.mut_engine.adapters.git.receive_pack import (
    parse_receive_pack_request as _parse_receive_pack_request,
    receive_pack_response,
)
from src.mut_engine.adapters.git.upload_pack import (
    info_refs_response,
    upload_pack_response,
)
from src.mut_engine.application.path_utils import normalize_path
from src.mut_engine.dependencies import get_repo_manager
from src.mut_engine.routers.access_point import resolve_access_point
from src.mut_engine.server.auth import enforce_channel_pause
from src.mut_engine.server.repo_manager import MutRepoManager

router = APIRouter(prefix="/git")


async def resolve_git_access_point(access_key: str, request: Request) -> tuple[str, dict]:
    """Resolve Access Point credentials for Git routes.

    Kept in this module as a stable injection seam for tests and local
    harnesses that monkeypatch access-point resolution without touching the
    production auth module.
    """

    project_id, auth = await asyncio.to_thread(resolve_access_point, access_key)
    bound_identity = auth.get("_user_identity", "")
    request_identity = request_actor(request, auth)
    if bound_identity and request_identity != bound_identity:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=401,
            detail="User identity mismatch: key is bound to a different user",
        )
    enforce_channel_pause(
        auth,
        request.headers.get("x-puppy-client"),
        log_prefix="[GitAP]",
    )
    return project_id, auth


def _git_audit_detail(
    *,
    auth: dict,
    entry_point: str,
    actor: str,
) -> dict:
    scope = auth.get("_scope") or {}
    return {
        "source_channel": "git",
        "protocol": "git",
        "entry_point": entry_point,
        "remote": (
            "Access key Git remote"
            if entry_point == "access_key_git_remote"
            else "Project Git remote"
        ),
        "scope": normalize_path(scope.get("path", "")),
        "scope_id": scope.get("id", ""),
        "actor": actor,
    }


async def _record_git_fetch_audit(
    *,
    repo,
    auth: dict,
    actor: str,
    entry_point: str,
) -> None:
    detail = {
        **_git_audit_detail(auth=auth, entry_point=entry_point, actor=actor),
        "service": "upload-pack",
    }
    await asyncio.to_thread(repo.record_audit, "git_fetch", actor, detail)


@router.get("/{project_id}.git/info/refs")
async def git_info_refs(
    project_id: str,
    service: str,
    request: Request,
    scope: str = "",
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Advertise the Git service endpoint for a PuppyOne project."""

    auth = await resolve_git_project_auth(project_id, request, scope)
    repo = repo_manager.get_server_repo(project_id)
    return info_refs_response(
        repo,
        service,
        scope_path_for_auth(auth),
        scope_excludes_for_auth(auth),
    )


@router.get("/ap/{access_key}.git/info/refs")
async def git_ap_info_refs(
    access_key: str,
    service: str,
    request: Request,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Advertise Git refs through an Access Point-bound scope."""

    project_id, auth = await resolve_git_access_point(access_key, request)
    repo = repo_manager.get_server_repo(project_id)
    return info_refs_response(
        repo,
        service,
        normalize_path(auth["_scope"].get("path", "")),
        scope_excludes_for_auth(auth),
    )


@router.post("/{project_id}.git/git-receive-pack")
async def git_receive_pack(
    project_id: str,
    request: Request,
    scope: str = "",
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Receive a Git push and publish it through the version engine."""

    auth = await resolve_git_project_auth(project_id, request, scope)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    return await receive_pack_response(
        repo_manager=repo_manager,
        repo=repo,
        project_id=project_id,
        scope_path=scope_path_for_auth(auth),
        scope_excludes=scope_excludes_for_auth(auth),
        actor=actor,
        body=body,
        read_only=(auth.get("_scope") or {}).get("mode", "rw") == "r",
        audit_detail=_git_audit_detail(
            auth=auth,
            entry_point="project_git_remote",
            actor=actor,
        ),
    )


@router.post("/ap/{access_key}.git/git-receive-pack")
async def git_ap_receive_pack(
    access_key: str,
    request: Request,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Receive a Git push through an Access Point-bound scope."""

    project_id, auth = await resolve_git_access_point(access_key, request)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    scope = auth["_scope"]
    actor = request_actor(request, auth)
    return await receive_pack_response(
        repo_manager=repo_manager,
        repo=repo,
        project_id=project_id,
        scope_path=normalize_path(scope.get("path", "")),
        scope_excludes=scope_excludes_for_auth(auth),
        actor=actor,
        body=body,
        read_only=scope.get("mode", "r") == "r",
        audit_detail=_git_audit_detail(
            auth=auth,
            entry_point="access_key_git_remote",
            actor=actor,
        ),
    )


@router.post("/{project_id}.git/git-upload-pack")
async def git_upload_pack(
    project_id: str,
    request: Request,
    scope: str = "",
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Serve a Git fetch/clone pack."""

    auth = await resolve_git_project_auth(project_id, request, scope)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    await _record_git_fetch_audit(
        repo=repo,
        auth=auth,
        actor=actor,
        entry_point="project_git_remote",
    )
    return upload_pack_response(
        repo,
        scope_path_for_auth(auth),
        scope_excludes_for_auth(auth),
        body,
    )


@router.post("/ap/{access_key}.git/git-upload-pack")
async def git_ap_upload_pack(
    access_key: str,
    request: Request,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
):
    """Serve a Git fetch/clone through an Access Point-bound scope."""

    project_id, auth = await resolve_git_access_point(access_key, request)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    await _record_git_fetch_audit(
        repo=repo,
        auth=auth,
        actor=actor,
        entry_point="access_key_git_remote",
    )
    return upload_pack_response(
        repo,
        normalize_path(auth["_scope"].get("path", "")),
        scope_excludes_for_auth(auth),
        body,
    )

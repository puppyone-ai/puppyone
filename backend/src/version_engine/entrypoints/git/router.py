"""Git protocol routes.

The router is intentionally thin: it resolves authentication and request
shape, then delegates protocol work to receive-pack/upload-pack modules.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from src.version_engine.entrypoints.git.auth import (
    request_actor,
    resolve_git_project_auth,
)
from src.version_engine.adapters.git.receive_pack import (
    parse_receive_pack_request as _parse_receive_pack_request,
    receive_pack_response,
)
from src.version_engine.adapters.git.upload_pack import (
    info_refs_response,
    upload_pack_response,
)
from src.version_engine.admission.repo_facade import repo_facade_from_auth
from src.version_engine.bootstrap.dependencies import get_repo_manager
from src.version_engine.entrypoints.http.access_point import resolve_access_point
from src.version_engine.admission.channel_pause import enforce_channel_pause
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager

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
    project_id: str = "",
) -> dict:
    facade = repo_facade_from_auth(
        project_id or auth.get("_project_id", ""),
        auth,
        kind=(
            "access_point"
            if entry_point == "access_key_git_remote"
            else "project_git_remote"
        ),
    )
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
        **facade.audit_detail(),
        "scope_id": scope.get("id", ""),
        "actor": actor,
    }


async def _record_git_fetch_audit(
    *,
    repo,
    auth: dict,
    actor: str,
    entry_point: str,
    project_id: str = "",
) -> None:
    detail = {
        **_git_audit_detail(
            auth=auth,
            entry_point=entry_point,
            actor=actor,
            project_id=project_id,
        ),
        "service": "upload-pack",
    }
    await asyncio.to_thread(repo.record_audit, "git_fetch", actor, detail)


@router.get("/{project_id}.git/info/refs")
async def git_info_refs(
    project_id: str,
    service: str,
    request: Request,
    scope: str = "",
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
):
    """Advertise the Git service endpoint for a PuppyOne project."""

    auth = await resolve_git_project_auth(project_id, request, scope)
    repo = repo_manager.get_server_repo(project_id)
    facade = repo_facade_from_auth(project_id, auth, kind="project_git_remote")
    return info_refs_response(
        repo,
        service,
        facade.scope_path,
        list(facade.excludes),
    )


@router.get("/ap/{access_key}.git/info/refs")
async def git_ap_info_refs(
    access_key: str,
    service: str,
    request: Request,
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
):
    """Advertise Git refs through an Access Point-bound scope."""

    project_id, auth = await resolve_git_access_point(access_key, request)
    repo = repo_manager.get_server_repo(project_id)
    facade = repo_facade_from_auth(project_id, auth, kind="access_point")
    return info_refs_response(
        repo,
        service,
        facade.scope_path,
        list(facade.excludes),
    )


@router.post("/{project_id}.git/git-receive-pack")
async def git_receive_pack(
    project_id: str,
    request: Request,
    scope: str = "",
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
):
    """Receive a Git push and publish it through the version engine."""

    auth = await resolve_git_project_auth(project_id, request, scope)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    facade = repo_facade_from_auth(project_id, auth, kind="project_git_remote")
    return await receive_pack_response(
        repo_manager=repo_manager,
        repo=repo,
        project_id=project_id,
        scope_path=facade.scope_path,
        scope_excludes=list(facade.excludes),
        actor=actor,
        body=body,
        read_only=facade.read_only,
        audit_detail=_git_audit_detail(
            auth=auth,
            entry_point="project_git_remote",
            actor=actor,
            project_id=project_id,
        ),
    )


@router.post("/ap/{access_key}.git/git-receive-pack")
async def git_ap_receive_pack(
    access_key: str,
    request: Request,
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
):
    """Receive a Git push through an Access Point-bound scope."""

    project_id, auth = await resolve_git_access_point(access_key, request)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    facade = repo_facade_from_auth(project_id, auth, kind="access_point")
    return await receive_pack_response(
        repo_manager=repo_manager,
        repo=repo,
        project_id=project_id,
        scope_path=facade.scope_path,
        scope_excludes=list(facade.excludes),
        actor=actor,
        body=body,
        read_only=facade.read_only,
        audit_detail=_git_audit_detail(
            auth=auth,
            entry_point="access_key_git_remote",
            actor=actor,
            project_id=project_id,
        ),
    )


@router.post("/{project_id}.git/git-upload-pack")
async def git_upload_pack(
    project_id: str,
    request: Request,
    scope: str = "",
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
):
    """Serve a Git fetch/clone pack."""

    auth = await resolve_git_project_auth(project_id, request, scope)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    facade = repo_facade_from_auth(project_id, auth, kind="project_git_remote")
    await _record_git_fetch_audit(
        repo=repo,
        auth=auth,
        actor=actor,
        entry_point="project_git_remote",
        project_id=project_id,
    )
    return upload_pack_response(
        repo,
        facade.scope_path,
        list(facade.excludes),
        body,
    )


@router.post("/ap/{access_key}.git/git-upload-pack")
async def git_ap_upload_pack(
    access_key: str,
    request: Request,
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
):
    """Serve a Git fetch/clone through an Access Point-bound scope."""

    project_id, auth = await resolve_git_access_point(access_key, request)
    repo = repo_manager.get_server_repo(project_id)
    body = await request.body()
    actor = request_actor(request, auth)
    facade = repo_facade_from_auth(project_id, auth, kind="access_point")
    await _record_git_fetch_audit(
        repo=repo,
        auth=auth,
        actor=actor,
        entry_point="access_key_git_remote",
        project_id=project_id,
    )
    return upload_pack_response(
        repo,
        facade.scope_path,
        list(facade.excludes),
        body,
    )

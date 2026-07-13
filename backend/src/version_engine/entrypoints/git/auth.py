"""Git access-point and project credential resolution."""

from __future__ import annotations

import asyncio
import base64

from fastapi import HTTPException, Request

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.platform.authorization.models import RuntimeGrant, RuntimeMode, RuntimePrincipal
from src.repo.access_credentials import AccessCredentialRepository
from src.repo.scope_repository import RepoScopeRepository
from src.version_engine.entrypoints.git.locator import validate_git_locator_id
from src.version_engine.entrypoints.http.access_point import resolve_access_point
from src.version_engine.admission.channel_pause import enforce_channel_pause
from src.version_engine.write_engine.path_utils import normalize_path


async def resolve_git_access_point(
    access_key: str,
    request: Request,
    *,
    resolver=None,
) -> tuple[str, dict]:
    # ``resolver`` preserves the router's long-standing test/integration seam
    # while keeping all legacy identity/pause checks in this one function.
    project_id, auth = await asyncio.to_thread(
        resolver or resolve_access_point,
        access_key,
    )
    bound_identity = auth.get("_user_identity", "")
    request_identity = request_actor(request, auth)
    if bound_identity and request_identity != bound_identity:
        raise HTTPException(
            status_code=401,
            detail="User identity mismatch: key is bound to a different user",
        )
    # Native Git clients do not reliably send custom headers, so infer the
    # Git Remote access surface from the route.
    enforce_channel_pause(auth, "git_remote", log_prefix="[GitAP]")
    return project_id, auth


async def resolve_git_project_auth(
    project_id: str,
    request: Request,
    requested_scope: str = "",
) -> dict:
    """Resolve the canonical Project-root Git route.

    ``requested_scope`` remains only as a compatibility guard for older
    internal callers. Query strings can never retarget a canonical locator.
    """
    if normalize_path(requested_scope):
        raise _git_unauthorized()
    return await resolve_canonical_git_auth(project_id, request)


async def resolve_git_scope_auth(
    project_id: str,
    scope_id: str,
    request: Request,
) -> dict:
    return await resolve_canonical_git_auth(project_id, request, scope_id=scope_id)


async def resolve_canonical_git_auth(
    project_id: str,
    request: Request,
    *,
    scope_id: str | None = None,
) -> dict:
    try:
        project_id = validate_git_locator_id(project_id, field="project_id")
        if scope_id is not None:
            scope_id = validate_git_locator_id(scope_id, field="scope_id")
    except ValueError:
        raise _git_unauthorized() from None

    # ASGI exposes the undecoded request target. Reject percent-encoded route
    # identity even when the framework would decode it to an otherwise valid
    # ID; canonical locators have exactly one textual representation.
    raw_path = getattr(request, "scope", {}).get("raw_path", b"")
    if isinstance(raw_path, str):
        raw_path = raw_path.encode("ascii", errors="ignore")
    if b"%" in raw_path:
        raise _git_unauthorized()

    header = request.headers.get("authorization", "")
    username, password = basic_auth_credentials(header)
    bearer_token = bearer_token_from_header(header)
    token = bearer_token or password
    if not token:
        raise _git_unauthorized()

    if settings.SKIP_AUTH:
        auth = await _mock_git_auth(project_id, scope_id, username)
        enforce_channel_pause(auth, "git_remote", log_prefix="[Git]")
        return auth

    user_identity = request.headers.get("x-puppyone-user", "") or username
    repository = AccessCredentialRepository(SupabaseClient().client)
    resolved = await asyncio.to_thread(
        repository.resolve_git_runtime_credential,
        token,
    )
    if not resolved:
        raise _git_unauthorized()
    try:
        resolved_project_id = _required_runtime_text(resolved, "project_id")
        resolved_scope_id = validate_git_locator_id(
            _required_runtime_text(resolved, "scope_id"),
            field="scope_id",
        )
        credential_id = _required_runtime_text(resolved, "credential_id")
        access_surface_id = _required_runtime_text(resolved, "access_surface_id")
        is_root = resolved["scope_is_root"]
        if not isinstance(is_root, bool):
            raise ValueError("scope_is_root must be a boolean")
        scope_path = normalize_path(str(resolved.get("scope_path") or ""))
        raw_excludes = resolved.get("scope_exclude") or []
        if not isinstance(raw_excludes, (list, tuple)) or not all(
            isinstance(item, str) for item in raw_excludes
        ):
            raise ValueError("scope_exclude must be a string list")
        excludes = tuple(
            normalized
            for item in raw_excludes
            if (normalized := normalize_path(item))
        )
        mode = RuntimeMode(_required_runtime_text(resolved, "effective_mode"))
    except (KeyError, TypeError, ValueError):
        # A malformed or partially migrated authorization fact set is not a
        # transport error.  Fail closed with the same response as an unknown
        # credential/target so callers cannot probe database state.
        raise _git_unauthorized() from None

    if resolved_project_id != project_id:
        raise _git_unauthorized()
    if scope_id is None:
        if not is_root or scope_path:
            raise _git_unauthorized()
    elif is_root or resolved_scope_id != scope_id or not scope_path:
        raise _git_unauthorized()

    runtime_grant = RuntimeGrant(
        principal=RuntimePrincipal(
            principal_id=credential_id,
            credential_kind="git_http_token",
        ),
        project_id=project_id,
        scope_id=resolved_scope_id,
        path=scope_path,
        excludes=excludes,
        mode=mode,
    )
    auth = {
        "agent": f"git-credential:{credential_id}",
        "_scope": {
            "id": resolved_scope_id,
            "path": runtime_grant.path,
            "exclude": list(excludes),
            "mode": mode.value,
        },
        "_runtime_grant": runtime_grant,
        "_user_identity": user_identity,
        "_credential_id": credential_id,
        "_access_surface_id": access_surface_id,
        "_workspace_binding_id": resolved.get("workspace_binding_id"),
    }
    # Native Git clients do not reliably send custom headers, so infer the
    # Git Remote access surface from the route.
    enforce_channel_pause(auth, "git_remote", log_prefix="[Git]")
    return auth


def _required_runtime_text(resolved: dict, field: str) -> str:
    value = resolved[field]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _git_unauthorized() -> HTTPException:
    # Keep route/project/scope/credential mismatches indistinguishable.
    return HTTPException(
        status_code=401,
        detail="Invalid Git credentials",
        headers={"WWW-Authenticate": 'Basic realm="PuppyOne Git"'},
    )


async def _mock_git_auth(
    project_id: str,
    scope_id: str | None,
    username: str,
) -> dict:
    """Bypass credential auth without bypassing canonical target geometry."""

    repository = RepoScopeRepository(SupabaseClient().client)
    scope = await asyncio.to_thread(
        repository.get if scope_id is not None else repository.get_root_scope,
        scope_id if scope_id is not None else project_id,
    )
    if (
        scope is None
        or scope.project_id != project_id
        or scope.is_root is not (scope_id is None)
    ):
        raise _git_unauthorized()
    path = normalize_path(scope.path)
    if (scope.is_root and path) or (not scope.is_root and not path):
        raise _git_unauthorized()
    try:
        mode = RuntimeMode(scope.mode)
    except ValueError:
        raise _git_unauthorized() from None
    excludes = tuple(
        normalized
        for item in scope.exclude
        if (normalized := normalize_path(item))
    )
    runtime_grant = RuntimeGrant(
        principal=RuntimePrincipal(
            principal_id="test-git-credential",
            credential_kind="git_http_token",
        ),
        project_id=project_id,
        scope_id=scope.id,
        path=path,
        excludes=excludes,
        mode=mode,
    )
    return {
        "agent": "git-credential:test-git-credential",
        "_scope": {
            "id": scope.id,
            "path": path,
            "exclude": list(excludes),
            "mode": mode.value,
        },
        "_runtime_grant": runtime_grant,
        "_user_identity": username,
    }


def scope_path_for_auth(auth: dict) -> str:
    return normalize_path((auth.get("_scope") or {}).get("path", ""))


def scope_excludes_for_auth(auth: dict) -> list[str]:
    raw = (auth.get("_scope") or {}).get("exclude") or []
    return [normalize_path(item) for item in raw if item]


def request_actor(request: Request, auth: dict) -> str:
    return (
        request.headers.get("x-puppyone-user")
        or request.headers.get("x-git-actor")
        or basic_auth_username(request.headers.get("authorization", ""))
        or auth.get("agent")
        or "git"
    )


def basic_auth_username(header: str) -> str:
    username, _password = basic_auth_credentials(header)
    return username


def basic_auth_credentials(header: str) -> tuple[str, str]:
    if not header.lower().startswith("basic "):
        return "", ""
    try:
        decoded = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8")
    except Exception:
        return "", ""
    username, _, password = decoded.partition(":")
    return username, password


def bearer_token_from_header(header: str) -> str:
    if not header.lower().startswith("bearer "):
        return ""
    return header.split(" ", 1)[1].strip()

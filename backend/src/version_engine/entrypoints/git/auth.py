"""Git access-point and project credential resolution."""

from __future__ import annotations

import asyncio
import base64

from fastapi import HTTPException, Request

from src.infra.supabase.client import SupabaseClient
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.entrypoints.http.access_point import resolve_access_point
from src.version_engine.admission.identity import PuppyOneAuthenticator
from src.version_engine.admission.channel_pause import enforce_channel_pause


async def resolve_git_access_point(access_key: str, request: Request) -> tuple[str, dict]:
    project_id, auth = await asyncio.to_thread(resolve_access_point, access_key)
    bound_identity = auth.get("_user_identity", "")
    request_identity = request_actor(request, auth)
    if bound_identity and request_identity != bound_identity:
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


async def resolve_git_project_auth(project_id: str, request: Request, requested_scope: str) -> dict:
    header = request.headers.get("authorization", "")
    username, password = basic_auth_credentials(header)
    bearer_token = bearer_token_from_header(header)
    token = bearer_token or password
    if not token:
        raise HTTPException(status_code=401, detail="Missing Git credentials")

    user_identity = request.headers.get("x-puppyone-user", "") or username
    authenticator = PuppyOneAuthenticator(SupabaseClient())
    auth = await asyncio.to_thread(
        authenticator.authenticate,
        token,
        project_id,
        user_identity,
    )
    requested = normalize_path(requested_scope)
    if requested and requested != scope_path_for_auth(auth):
        raise HTTPException(
            status_code=403,
            detail="Requested Git scope does not match credential scope",
        )
    enforce_channel_pause(
        auth,
        request.headers.get("x-puppy-client"),
        log_prefix="[Git]",
    )
    return auth


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

"""
PuppyOneAuthenticator — version access authentication adapter

Maps PuppyOne's authentication system to the version access context:
  - JWT Bearer → user + full project scope (mode=rw)
  - Access Key → connection + restricted repo scope

Supports:
  - Key revocation (revoked access points are rejected)
  - User identity binding via X-PuppyOne-User header
  - Channel pause enforcement via X-Puppy-Client header (cli / filesystem):
    when present, the resolved scope's connector for that channel is
    consulted and the request is rejected with 403 if status='paused'.
"""

from __future__ import annotations

import threading
import time

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.version_engine.server.backends import safe_data
from src.platform.auth.dependencies import security
from src.repo.connector_repository import ConnectorRepository
from src.utils.logger import log_error, log_warning


# Recognised channel headers. Anything else is silently ignored so that
# unknown / future client kinds don't break authentication — the worst
# case is that pause becomes informational for that client kind, never
# that a legitimate request gets rejected.
_KNOWN_CHANNELS = frozenset({"cli", "filesystem"})
_CHANNEL_PAUSE_CACHE_TTL_SECONDS = 2.0
_channel_pause_cache: dict[tuple[str, str], tuple[float, str | None, str | None]] = {}
_channel_pause_cache_lock = threading.Lock()


def _get_cached_channel_pause(scope_id: str, channel: str) -> tuple[str | None, str | None] | None:
    now = time.monotonic()
    key = (scope_id, channel)
    with _channel_pause_cache_lock:
        cached = _channel_pause_cache.get(key)
        if cached is None:
            return None
        expires_at, connector_id, status = cached
        if expires_at <= now:
            _channel_pause_cache.pop(key, None)
            return None
        return connector_id, status


def _set_cached_channel_pause(
    scope_id: str,
    channel: str,
    connector_id: str | None,
    status: str | None,
) -> None:
    key = (scope_id, channel)
    with _channel_pause_cache_lock:
        _channel_pause_cache[key] = (
            time.monotonic() + _CHANNEL_PAUSE_CACHE_TTL_SECONDS,
            connector_id,
            status,
        )


class PuppyOneAuthenticator:
    """Resolve PuppyOne credentials to a version access context."""

    def __init__(self, supabase: SupabaseClient):
        self._client = supabase.client

    def authenticate(self, token: str, project_id: str,
                     user_identity: str = "") -> dict:
        """Resolve a Bearer token to version access context.

        Args:
            token: Bearer token (JWT or access key)
            project_id: Target project ID
            user_identity: X-PuppyOne-User header value. Threaded onto the
                returned auth context as `_user_identity` so downstream
                handlers / hooks / audit logs can attribute the operation
                to the actual operator (the cli/agent identity behind the
                key). The strict per-key binding enforcement that this
                value used to drive moved to the new
                repo_user_permissions table; this parameter is now an
                identity HINT, not an auth gate.
            user_identity: X-PuppyOne-User header value (for identity binding)

        Returns:
            {"agent": str, "_scope": {"id", "path", "exclude", "mode"}}
        """
        if settings.SKIP_AUTH:
            # config.py.enforce_skip_auth_safety guarantees APP_ENV is
            # dev/test if SKIP_AUTH is True; this assert is deep-defense in
            # case the validator is ever bypassed (mock, monkey-patched test).
            if settings.APP_ENV not in {"development", "test"}:
                log_error(
                    f"[Auth] SKIP_AUTH=True with APP_ENV={settings.APP_ENV!r}: "
                    f"config validator was bypassed; refusing to skip auth"
                )
                raise HTTPException(
                    status_code=500,
                    detail="Server misconfigured: SKIP_AUTH must not be active in this environment",
                )
            log_warning("SKIP_AUTH enabled — version auth returning mock user")
            return {
                "agent": "user:mock",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
            }

        user = self._try_jwt(token)
        if user:
            # SECURITY (C-1): JWT alone is not sufficient — caller must also
            # be a member of the target project. Without this check, ANY
            # logged-in user could read/write the version tree of ANY project
            # by changing project_id in the URL.
            if not self._user_has_project_access(user["user_id"], project_id):
                log_warning(
                    f"[Auth] JWT user {user['user_id']} attempted version access "
                    f"to project {project_id} without membership"
                )
                raise HTTPException(
                    status_code=403,
                    detail="Not a member of this project",
                )
            return {
                "agent": f"user:{user['user_id']}",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
                "_user_identity": user_identity,
            }

        scope_row = self._try_access_key(token, project_id)
        if scope_row:
            # Access keys resolve to repo_scopes rows directly. The
            # "scope is the auth" mental model: the scope dict we return
            # IS the row that authenticated.
            return {
                "agent": f"scope:{scope_row['id']}",
                "_scope": {
                    "id": scope_row["id"],
                    "path": scope_row.get("path", ""),
                    "exclude": scope_row.get("exclude") or [],
                    "mode": scope_row.get("mode", "rw"),
                },
                "_user_identity": user_identity,
            }

        raise HTTPException(status_code=401, detail="Invalid version credentials")

    def _try_jwt(self, token: str) -> dict | None:
        try:
            from src.platform.auth.service import AuthService
            # AuthService expects the *underlying* supabase-py ``Client``
            # (which exposes ``.auth.get_claims`` for the JWKS fallback),
            # not our ``SupabaseClient`` wrapper. Passing the wrapper
            # silently falls back to the local JWT path until the JWKS
            # branch is reached, then crashes with
            # ``'SupabaseClient' object has no attribute 'auth'`` and the
            # caller treats every JWT as invalid.
            auth_svc = AuthService(SupabaseClient().client)
            user = auth_svc.get_current_user(token)
            return {"user_id": user.user_id}
        except HTTPException:
            # Expected: invalid/expired JWT → not a JWT, try next method
            return None
        except Exception as e:
            log_error(f"[Auth] Unexpected JWT auth error: {e}")
            return None

    def _user_has_project_access(self, user_id: str, project_id: str) -> bool:
        """Verify that user is a member of the project's organization.

        Reused from ProjectRepositorySupabase.verify_project_access. We avoid
        a full ProjectService instantiation here to keep version auth fast — we
        only need a boolean, not the project model.
        """
        try:
            from src.platform.project.repository import ProjectRepositorySupabase
            repo = ProjectRepositorySupabase()
            role = repo.verify_project_access(project_id, user_id)
            return role is not None
        except Exception as e:
            # Fail closed: if the access check itself errors, deny access.
            log_error(
                f"[Auth] Project access check failed user={user_id} "
                f"project={project_id}: {e}"
            )
            return False

    def _try_access_key(self, key: str, project_id: str) -> dict | None:
        """Resolve an access_key against the canonical repo_scopes table.

        Scopes own their keys directly. There is no config-scope fallback
        here because accepting two
        auth sources creates two policy models for the same credential.
        """
        try:
            resp = (
                self._client.table("repo_scopes")
                .select("id, project_id, path, exclude, mode, access_key_revoked_at")
                .eq("access_key", key)
                .limit(1)
                .execute()
            )
            rows = safe_data(resp)
            if rows:
                scope = rows[0]
                if scope.get("access_key_revoked_at"):
                    return None
                if scope.get("project_id") != project_id:
                    log_warning(
                        f"[Auth] access_key project mismatch (repo_scopes): "
                        f"url_project={project_id} key_project={scope.get('project_id')}"
                    )
                    return None
                return scope
        except Exception as e:
            log_error(f"[Auth] repo_scopes access key lookup failed: {e}")
            return None

    # ── Key management ──
    #
    # Key revocation uses repo_scopes.access_key_revoked_at. The public
    # endpoint is POST /api/v1/projects/{pid}/scopes/{sid}/regenerate-key
    # (see src/repo/scope_router.py).


def get_version_auth(
    request: Request,
    project_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """FastAPI dependency: extract and verify version access context.

    Two-stage gate:
      1. Resolve the Bearer token (JWT or access_key) → auth context with
         a scope binding. This is the existing identity check.
      2. If the request advertises a channel via X-Puppy-Client (e.g.
         'cli', 'filesystem'), consult that channel's connector for the
         resolved scope and reject with 403 when status='paused'.

    Stage 2 is deliberately opt-in via the header so that older
    CLI / daemon installs that don't send X-Puppy-Client continue to
    work unchanged. The "Pause" toggle in the access-page UI becomes a
    hard gate progressively as clients roll out the header — for the
    in-app agent path the same enforcement happens inside the agent
    chat router (see src/connectors/agent/chat/...).
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    user_identity = request.headers.get("x-puppyone-user", "")
    authenticator = PuppyOneAuthenticator(SupabaseClient())
    auth = authenticator.authenticate(
        credentials.credentials, project_id, user_identity=user_identity,
    )

    enforce_channel_pause(
        auth, request.headers.get("x-puppy-client"),
        log_prefix="[Auth]",
    )

    return auth


def enforce_channel_pause(
    auth: dict,
    channel: str | None,
    *,
    log_prefix: str = "[Auth]",
) -> None:
    """Reject requests for paused built-in connectors.

    Access keys resolve to a repo scope, while pause/resume is represented on
    the scope-bound connector row (``connectors.provider`` = ``cli`` or
    ``filesystem``). Keeping this gate in one helper makes Git smart HTTP,
    version WebSocket, and scoped ``/ap-fs`` routes enforce the same rule.
    """
    normalized_channel = (channel or "").strip().lower()
    scope = auth.get("_scope") or {}
    scope_id = scope.get("id")
    if normalized_channel in _KNOWN_CHANNELS and scope_id and scope_id != "_root":
        # JWT auth (member access) returns _scope.id='_root' as a virtual
        # scope marker, not a real repo_scopes row, so we skip the check
        # there — JWT users see the full project tree by membership and
        # aren't subject to per-channel pause. Access-key auth always
        # returns a real scope_id, which is the only case we enforce.
        cached = _get_cached_channel_pause(scope_id, normalized_channel)
        if cached is None:
            try:
                connector = ConnectorRepository().get_by_scope_provider(
                    scope_id, normalized_channel,
                )
            except Exception as e:
                # Defensive: if the lookup fails (e.g. transient DB blip), we
                # don't want to suddenly start 5xx-ing legitimate traffic.
                # Log and fail open — pause stays as informational on this
                # request, the next one re-tries.
                log_error(
                    f"{log_prefix} Channel-pause lookup failed for scope={scope_id} "
                    f"channel={normalized_channel}: {e}; failing open"
                )
                connector_id = None
                connector_status = None
            else:
                connector_id = connector.id if connector is not None else None
                connector_status = connector.status if connector is not None else None
                _set_cached_channel_pause(
                    scope_id,
                    normalized_channel,
                    connector_id,
                    connector_status,
                )
        else:
            connector_id, connector_status = cached

        if connector_status == "paused":
            log_warning(
                f"{log_prefix} Rejected {normalized_channel} request to scope={scope_id}: "
                f"connector {connector_id} is paused"
            )
            raise HTTPException(
                status_code=403,
                detail=(
                    f"The '{normalized_channel}' connector for this scope is paused. "
                    "Resume it from the Access page to re-enable this channel."
                ),
            )

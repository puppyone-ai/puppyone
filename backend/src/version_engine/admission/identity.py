"""
PuppyOneAuthenticator — version access authentication adapter

Maps PuppyOne's authentication system to the version access context:
  - JWT Bearer → human ProjectGrant + root scope bounded by role
  - Access Key → connection + restricted repo scope

Supports:
  - Key revocation (revoked access points are rejected)
  - User identity binding via X-PuppyOne-User header
  - Channel pause enforcement via X-Puppy-Client header (cli):
    when present, the resolved scope's connector for that channel is
    consulted and the request is rejected with 403 if status='paused'.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.version_engine.infrastructure.supabase.scope_repository import (
    find_scope_by_access_key,
)
from src.version_engine.admission.channel_pause import enforce_channel_pause
from src.platform.auth.dependencies import security
from src.platform.authorization.service import redacted_project_ref
from src.utils.logger import log_error, log_warning


class PuppyOneAuthenticator:
    """Resolve PuppyOne credentials to a version access context."""

    def __init__(self, supabase: SupabaseClient):
        # Held as the typed wrapper, not the raw supabase-py client, so
        # repository helpers (which take the wrapper) are usable here
        # without re-wrapping at every call site. L2 must not assemble
        # its own SQL; lookups go through infrastructure/.
        self._supabase = supabase

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
                Project authorization boundary; this value is an identity
                hint, not an authorization gate.
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
            grant = self._resolve_project_grant(user["user_id"], project_id)
            if grant is None:
                log_warning(
                    f"[Auth] JWT user {user['user_id']} attempted version access "
                    f"to project {project_id} without membership"
                )
                raise HTTPException(
                    status_code=403,
                    detail="Not a member of this project",
                )
            from src.platform.authorization.models import ProjectAction

            return {
                "agent": f"user:{user['user_id']}",
                "_scope": {
                    "id": "_root",
                    "path": "",
                    "exclude": [],
                    "mode": (
                        "rw" if grant.allows(ProjectAction.CONTENT_WRITE) else "r"
                    ),
                },
                "_project_grant": grant,
                "_user_identity": user_identity,
            }

        scope_row = self._try_access_key(token, project_id)
        if scope_row:
            # Access keys resolve to repo_scopes rows directly. The
            # "scope is the auth" mental model: the scope dict we return
            # IS the row that authenticated.
            from src.platform.authorization.models import (
                RuntimeGrant,
                RuntimeMode,
                RuntimePrincipal,
            )

            runtime_grant = RuntimeGrant(
                principal=RuntimePrincipal(
                    principal_id=str(scope_row["id"]),
                    credential_kind="access_surface_credential",
                ),
                project_id=str(scope_row["project_id"]),
                scope_id=str(scope_row["id"]),
                path=str(scope_row.get("path") or ""),
                excludes=tuple(scope_row.get("exclude") or ()),
                mode=RuntimeMode(scope_row.get("mode", "r")),
            )
            return {
                "agent": f"scope:{scope_row['id']}",
                "_scope": {
                    "id": scope_row["id"],
                    "path": scope_row.get("path", ""),
                    "exclude": scope_row.get("exclude") or [],
                    "mode": scope_row.get("mode", "rw"),
                },
                "_runtime_grant": runtime_grant,
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
            log_error(
                "[Auth] Unexpected JWT auth error "
                f"error_type={type(e).__name__}"
            )
            return None

    def _resolve_project_grant(self, user_id: str, project_id: str):
        """Resolve the canonical human ProjectGrant, failing closed."""
        try:
            from src.platform.authorization.factory import build_authorization_service

            return build_authorization_service(
                self._supabase.client
            ).resolve_project_grant(project_id, user_id)
        except Exception as e:
            # Fail closed: if the access check itself errors, deny access.
            log_error(
                "[Auth] Project access check failed "
                f"project_ref={redacted_project_ref(project_id)} "
                f"error_type={type(e).__name__}"
            )
            return None

    def _try_access_key(self, key: str, project_id: str) -> dict | None:
        """Resolve an access key through canonical access-surface credentials.

        Scopes own their keys directly. There is no config-scope fallback
        here because accepting two auth sources creates two policy models
        for the same credential. The actual SQL lives in
        ``infrastructure/supabase/scope_repository.find_scope_by_access_key``
        so identity is purely a policy layer.
        """
        scope = find_scope_by_access_key(self._supabase, key)
        if scope is None:
            return None
        if scope.get("access_key_revoked_at"):
            return None
        if scope.get("project_id") != project_id:
            log_warning(
                "[Auth] access_key project mismatch (access surface scope) "
                f"requested_project_ref={redacted_project_ref(project_id)} "
                f"credential_project_ref={redacted_project_ref(str(scope.get('project_id') or ''))}"
            )
            return None
        return scope

    # ── Key management ──
    #
    # Key revocation uses access_surface_credentials.status. The public
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
         'cli'), consult that channel's connector for the
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

"""
PuppyOneAuthenticator — MUT protocol authentication adapter

Maps PuppyOne's authentication system to the MUT (agent, _scope) model:
  - JWT Bearer → user + full project scope (mode=rw)
  - Access Key → connection + restricted scope (via ScopeManager)

Supports:
  - Key revocation (revoked access points are rejected)
  - User identity binding via X-Mut-User header
  - Channel pause enforcement via X-Puppy-Client header (cli / filesystem):
    when present, the resolved scope's connector for that channel is
    consulted and the request is rejected with 403 if status='paused'.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data
from src.platform.auth.dependencies import security
from src.repo.connector_repository import ConnectorRepository
from src.utils.logger import log_error, log_warning


# Recognised channel headers. Anything else is silently ignored so that
# unknown / future client kinds don't break authentication — the worst
# case is that pause becomes informational for that client kind, never
# that a legitimate request gets rejected.
_KNOWN_CHANNELS = frozenset({"cli", "filesystem"})


class PuppyOneAuthenticator:
    """Resolve PuppyOne credentials to MUT auth context."""

    def __init__(self, supabase: SupabaseClient):
        self._client = supabase.client

    def authenticate(self, token: str, project_id: str,
                     user_identity: str = "") -> dict:
        """Resolve a Bearer token to MUT auth context.

        Args:
            token: Bearer token (JWT or access key)
            project_id: Target project ID
            user_identity: X-Mut-User header value. Threaded onto the
                returned auth context as `_user_identity` so downstream
                handlers / hooks / audit logs can attribute the operation
                to the actual operator (the cli/agent identity behind the
                key). The strict per-key binding enforcement that this
                value used to drive moved to the new
                repo_user_permissions table; this parameter is now an
                identity HINT, not an auth gate.
            user_identity: X-Mut-User header value (for identity binding)

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
            log_warning("SKIP_AUTH enabled — MUT auth returning mock user")
            return {
                "agent": "user:mock",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
            }

        user = self._try_jwt(token)
        if user:
            # SECURITY (C-1): JWT alone is not sufficient — caller must also
            # be a member of the target project. Without this check, ANY
            # logged-in user could read/write the MUT tree of ANY project
            # by changing project_id in the URL.
            if not self._user_has_project_access(user["user_id"], project_id):
                log_warning(
                    f"[Auth] JWT user {user['user_id']} attempted MUT access "
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
            # Per the access-point-redesign, an access_key now resolves to a
            # repo_scopes row directly. The "scope is the auth" mental model:
            # the scope dict we return IS the row that authenticated.
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

        raise HTTPException(status_code=401, detail="Invalid MUT credentials")

    def _try_jwt(self, token: str) -> dict | None:
        try:
            from src.platform.auth.service import AuthService
            auth_svc = AuthService(SupabaseClient())
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
        a full ProjectService instantiation here to keep MUT auth fast — we
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
        """Resolve an access_key against the new repo_scopes table, falling
        back to legacy access_points during the redesign transition window.

        Per the access-point-redesign-2026-05-02, scopes own their keys
        directly — there's no separate "access point" row sitting between
        the key and the scope geometry. A successful lookup returns a
        scope-shaped dict (id, path, exclude, mode); the caller in
        authenticate() projects that into the auth context's _scope.

        Resolution order:
          1. repo_scopes.access_key (new model)
          2. access_points.access_key + config.scope (legacy)

        Why the fallback: between deploying this code and running the
        Python data migration that copies access_points rows into
        repo_scopes, every existing key still lives in access_points.
        Without this fallback, the deploy bricks every active
        `mut connect` setup until the migration runs.

        Once the migration completes and access_points is dropped, the
        fallback's first query returns nothing and execution flows
        through the same shape as the all-new path. No additional
        cleanup needed.

        Returns None for: unknown key, revoked key, or key whose scope
        belongs to a different project (defense in depth — the URL
        path's project_id MUST match the scope's project_id).
        """
        # ── Path A: new repo_scopes table ────────────────────────────
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
            # Don't return early — repo_scopes may not exist yet on a DB
            # where migrations haven't been applied. Fall through to
            # the legacy lookup; if THAT also errors, we 401.
            log_warning(f"[Auth] repo_scopes lookup error (will try legacy): {e}")

        # ── Path B: legacy access_points (transition fallback) ────────
        try:
            resp = (
                self._client.table("access_points")
                .select("id, project_id, config, revoked_at, status")
                .eq("access_key", key)
                .limit(1)
                .execute()
            )
            rows = safe_data(resp)
            if not rows:
                return None
            ap = rows[0]
            if ap.get("revoked_at"):
                return None
            if ap.get("status") not in (None, "active", "syncing"):
                return None
            if ap.get("project_id") != project_id:
                log_warning(
                    f"[Auth] access_key project mismatch (access_points): "
                    f"url_project={project_id} key_project={ap.get('project_id')}"
                )
                return None

            cfg = ap.get("config") or {}
            raw_scope = cfg.get("scope") or {}
            return {
                "id": ap["id"],
                "project_id": ap["project_id"],
                "path": raw_scope.get("path", ""),
                "exclude": raw_scope.get("exclude") or [],
                "mode": raw_scope.get("mode", "rw"),
                "access_key_revoked_at": None,
            }
        except Exception as e:
            log_error(f"[Auth] Access key lookup failed (both paths): {e}")
            return None

    # ── Key management ──
    #
    # The old revoke() and revoke_by_scope() methods used to live here.
    # They wrote to access_points.revoked_at which is the legacy column.
    # Per the access-point-redesign-2026-05-02, key revocation now uses
    # repo_scopes.access_key_revoked_at, and there's a dedicated public
    # endpoint for it: POST /api/v1/projects/{pid}/scopes/{sid}/regenerate-key
    # (see src/repo/scope_router.py). The old methods had no callers in
    # src/, so removing them rather than rewriting — there's nothing to
    # break, and the new endpoint is the One True way to rotate keys.


def get_mut_auth(
    request: Request,
    project_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """FastAPI dependency: extract and verify MUT auth context.

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

    user_identity = request.headers.get("x-mut-user", "")
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
    ``filesystem``). Keeping this gate in one helper makes the legacy
    ``/api/v1/mut/{project_id}``, access-key ``/mut/ap`` and scoped
    ``/ap-fs`` routes enforce the same rule.
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
            connector = None

        if connector is not None and connector.status == "paused":
            log_warning(
                f"{log_prefix} Rejected {normalized_channel} request to scope={scope_id}: "
                f"connector {connector.id} is paused"
            )
            raise HTTPException(
                status_code=403,
                detail=(
                    f"The '{normalized_channel}' connector for this scope is paused. "
                    "Resume it from the Access page to re-enable this channel."
                ),
            )

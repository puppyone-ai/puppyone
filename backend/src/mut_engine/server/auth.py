"""
PuppyOneAuthenticator — MUT protocol authentication adapter

Maps PuppyOne's authentication system to the MUT (agent, _scope) model:
  - JWT Bearer → user + full project scope (mode=rw)
  - Access Key → connection + restricted scope (via ScopeManager)

Supports:
  - Key revocation (revoked access points are rejected)
  - User identity binding via X-Mut-User header
"""

from __future__ import annotations

from datetime import UTC

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data
from src.platform.auth.dependencies import security
from src.utils.logger import log_error, log_warning


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
            user_identity: X-Mut-User header value (for identity binding)

        Returns:
            {"agent": str, "_scope": {"id", "path", "exclude", "mode"}}
        """
        if settings.SKIP_AUTH:
            log_warning("SKIP_AUTH enabled — MUT auth returning mock user")
            return {
                "agent": "user:mock",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
            }

        user = self._try_jwt(token)
        if user:
            return {
                "agent": f"user:{user['user_id']}",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
            }

        conn = self._try_access_key(token, project_id)
        if conn:
            # Check revocation
            if conn.get("revoked_at"):
                raise HTTPException(
                    status_code=401, detail="Access key has been revoked"
                )

            # Check user identity binding
            bound_identity = conn.get("config", {}).get("user_identity", "")
            if bound_identity and user_identity and user_identity != bound_identity:
                raise HTTPException(
                    status_code=401,
                    detail="User identity mismatch: key is bound to a different user",
                )

            scope = self._resolve_scope(conn, project_id)
            return {
                "agent": conn["id"],
                "_scope": scope,
            }

        raise HTTPException(status_code=401, detail="Invalid MUT credentials")

    def _resolve_scope(self, conn: dict, project_id: str) -> dict:
        """Read scope through ScopeManager (SupabaseScopeBackend)."""
        from mut.server.scope_manager import ScopeManager

        from src.mut_engine.server.backends.supabase_scope import SupabaseScopeBackend

        backend = SupabaseScopeBackend(SupabaseClient(), project_id)
        manager = ScopeManager(backend)
        scope = manager.get_by_id(conn["id"])

        if scope:
            scope.setdefault("mode", "rw")
            return scope

        return {"id": conn["id"], "path": "", "exclude": [], "mode": "rw"}

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

    def _try_access_key(self, key: str, project_id: str) -> dict | None:
        try:
            resp = (
                self._client.table("access_points")
                .select("id, project_id, provider, config, revoked_at")
                .eq("access_key", key)
                .limit(1)
                .execute()
            )
            rows = safe_data(resp)
            if not rows:
                return None
            conn = rows[0]
            if conn.get("project_id") != project_id:
                return None
            return conn
        except Exception as e:
            log_error(f"[Auth] Access key lookup failed: {e}")
            return None

    # ── Key management ──

    def revoke(self, access_key: str) -> bool:
        """Revoke an access key by setting revoked_at timestamp."""
        from datetime import datetime
        try:
            self._client.table("access_points").update(
                {"revoked_at": datetime.now(UTC).isoformat()}
            ).eq("access_key", access_key).execute()
            return True
        except Exception as e:
            log_error(f"[Auth] Failed to revoke key: {e}")
            return False

    def revoke_by_scope(self, scope_id: str, project_id: str) -> int:
        """Revoke all keys for a given scope within a project.

        Matches access points whose config->scope->id equals scope_id.
        """
        from datetime import datetime
        try:
            now = datetime.now(UTC).isoformat()
            resp = (
                self._client.table("access_points")
                .select("id, config")
                .eq("project_id", project_id)
                .is_("revoked_at", "null")
                .execute()
            )
            count = 0
            for row in (resp.data or []):
                cfg = row.get("config") or {}
                scope = cfg.get("scope") or {}
                if scope.get("id") == scope_id:
                    self._client.table("access_points").update(
                        {"revoked_at": now}
                    ).eq("id", row["id"]).execute()
                    count += 1
            return count
        except Exception as e:
            log_error(f"[Auth] Failed to revoke by scope {scope_id}: {e}")
            return 0


def get_mut_auth(
    request: Request,
    project_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """FastAPI dependency: extract and verify MUT auth context."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    user_identity = request.headers.get("x-mut-user", "")
    authenticator = PuppyOneAuthenticator(SupabaseClient())
    return authenticator.authenticate(
        credentials.credentials, project_id, user_identity=user_identity,
    )

"""
PuppyOneAuthenticator — MUT 协议认证适配器

将 PuppyOne 的认证体系映射到 MUT 的 (agent, _scope) 模型:
  - JWT Bearer → user + full project scope (mode=rw)
  - Access Key → connection + restricted scope (from connections.config)
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from src.auth.dependencies import get_auth_service, security
from src.config import settings
from src.supabase.client import SupabaseClient
from src.utils.logger import log_warning


class PuppyOneAuthenticator:
    """Resolve PuppyOne credentials to MUT auth context."""

    def __init__(self, supabase: SupabaseClient):
        self._client = supabase.client

    def authenticate(self, token: str, project_id: str) -> dict:
        """Resolve a Bearer token to MUT auth context.

        Returns:
            {"agent": str, "_scope": {"id": str, "path": str, "exclude": list, "mode": str}}
        """
        if settings.SKIP_AUTH:
            log_warning("SKIP_AUTH enabled — MUT auth returning mock user")
            return {
                "agent": "user:mock",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
            }

        # Try JWT first
        user = self._try_jwt(token)
        if user:
            return {
                "agent": f"user:{user['user_id']}",
                "_scope": {"id": "_root", "path": "", "exclude": [], "mode": "rw"},
            }

        # Try Access Key (connections table)
        conn = self._try_access_key(token, project_id)
        if conn:
            cfg = conn.get("config") or {}
            scope = cfg.get("scope", {})
            return {
                "agent": conn["id"],
                "_scope": {
                    "id": conn["id"],
                    "path": scope.get("path", ""),
                    "exclude": scope.get("exclude", []),
                    "mode": scope.get("mode", "rw"),
                },
            }

        raise HTTPException(status_code=401, detail="Invalid MUT credentials")

    def _try_jwt(self, token: str) -> Optional[dict]:
        try:
            from src.auth.service import AuthService
            auth_svc = AuthService(
                SupabaseClient()
            )
            user = auth_svc.get_current_user(token)
            return {"user_id": user.user_id}
        except Exception:
            return None

    def _try_access_key(self, key: str, project_id: str) -> Optional[dict]:
        try:
            resp = (
                self._client.table("connections")
                .select("id, project_id, config, provider")
                .eq("access_key", key)
                .maybe_single()
                .execute()
            )
            if not resp.data:
                return None
            if resp.data.get("project_id") != project_id:
                return None
            return resp.data
        except Exception:
            return None


async def get_mut_auth(
    request: Request,
    project_id: str,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """FastAPI dependency: extract and verify MUT auth context."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    authenticator = PuppyOneAuthenticator(SupabaseClient())
    return authenticator.authenticate(credentials.credentials, project_id)

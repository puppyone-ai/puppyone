"""Access surface credential hashing and persistence."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from src.config import settings


HASH_ALG = "hmac_sha256_v1"
CREDENTIALS_TABLE = "access_surface_credentials"


def generate_access_token(prefix: str) -> str:
    clean_prefix = (prefix or "key").strip().strip("_") or "key"
    return f"{clean_prefix}_{secrets.token_urlsafe(32)}"


def access_token_hash(raw_token: str) -> str:
    secret = settings.ACCESS_CREDENTIAL_HASH_SECRET
    if not secret:
        raise ValueError("ACCESS_CREDENTIAL_HASH_SECRET is required to hash access credentials")
    return hmac.new(
        secret.encode("utf-8"),
        raw_token.strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def access_token_metadata(raw_token: str) -> tuple[str, str]:
    token = raw_token.strip()
    prefix = token.split("_", 1)[0] if "_" in token else token[:3]
    return prefix, token[-4:] if len(token) >= 4 else token


def mask_access_token(prefix: str | None, last4: str | None) -> str:
    if not prefix or not last4:
        return ""
    return f"{prefix}_{'•' * 8}{last4}"


class AccessCredentialRepository:
    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.infra.supabase.dependencies import get_supabase_client

            self._client = get_supabase_client()
        else:
            self._client = supabase_client

    def list_active_by_surface(self, surface_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not surface_ids:
            return {}
        resp = (
            self._client.table(CREDENTIALS_TABLE)
            .select("*")
            .in_("access_surface_id", surface_ids)
            .eq("credential_type", "bearer_token")
            .eq("status", "active")
            .execute()
        )
        rows = resp.data or []
        by_surface: dict[str, dict[str, Any]] = {}
        for row in rows:
            by_surface.setdefault(row["access_surface_id"], row)
        return by_surface

    def get_active_by_token(self, raw_token: str) -> Optional[dict[str, Any]]:
        token_hash = access_token_hash(raw_token)
        resp = (
            self._client.table(CREDENTIALS_TABLE)
            .select("*")
            .eq("key_hash", token_hash)
            .eq("credential_type", "bearer_token")
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def get_active_by_surface(self, access_surface_id: str) -> Optional[dict[str, Any]]:
        resp = (
            self._client.table(CREDENTIALS_TABLE)
            .select("*")
            .eq("access_surface_id", access_surface_id)
            .eq("credential_type", "bearer_token")
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def store_bearer_token(
        self,
        *,
        access_surface_id: str,
        org_id: str | None,
        project_id: str,
        raw_token: str,
        created_by: str | None = None,
        revoke_existing: bool = True,
    ) -> None:
        """Persist a supplied bearer token as hash-only credential state.

        This is used by the idempotent legacy backfill and by compatibility
        callers that already generated a token. New product flows should call
        :meth:`issue_bearer_token` so generation stays inside this boundary.
        """
        if revoke_existing:
            self.revoke_active(access_surface_id, credential_type="bearer_token")

        key_prefix, key_last4 = access_token_metadata(raw_token)
        self._client.table(CREDENTIALS_TABLE).insert(
            {
                "org_id": org_id,
                "project_id": project_id,
                "access_surface_id": access_surface_id,
                "credential_type": "bearer_token",
                "key_prefix": key_prefix,
                "key_last4": key_last4,
                "key_hash": access_token_hash(raw_token),
                "hash_alg": HASH_ALG,
                "status": "active",
                "created_by": created_by,
            }
        ).execute()

    def issue_bearer_token(
        self,
        *,
        access_surface_id: str,
        org_id: str | None,
        project_id: str,
        prefix: str,
        created_by: str | None = None,
        revoke_existing: bool = True,
    ) -> str:
        token = generate_access_token(prefix)
        self.store_bearer_token(
            access_surface_id=access_surface_id,
            org_id=org_id,
            project_id=project_id,
            raw_token=token,
            created_by=created_by,
            revoke_existing=revoke_existing,
        )
        return token

    def revoke_active(self, access_surface_id: str, *, credential_type: str | None = None) -> None:
        patch = {"status": "revoked", "revoked_at": datetime.now(timezone.utc).isoformat()}
        query = (
            self._client.table(CREDENTIALS_TABLE)
            .update(patch)
            .eq("access_surface_id", access_surface_id)
            .eq("status", "active")
        )
        if credential_type:
            query = query.eq("credential_type", credential_type)
        query.execute()

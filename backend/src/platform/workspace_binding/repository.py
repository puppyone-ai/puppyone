"""Supabase persistence for explicit workspace bindings."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from src.platform.repository_target.models import (
    RepositoryTarget,
    repository_target_from_storage,
    repository_target_scope_id,
)
from src.platform.workspace_binding.models import (
    BindingMode,
    BindingStatus,
    WorkspaceBinding,
)
from src.repo.access_credentials import (
    HASH_ALG,
    access_token_hash,
    access_token_metadata,
    generate_access_token,
)
from src.utils.id_generator import generate_uuid_v7


def _datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _row_to_binding(row: dict[str, Any]) -> WorkspaceBinding:
    return WorkspaceBinding(
        id=str(row["id"]),
        org_id=str(row["org_id"]),
        target=repository_target_from_storage(
            str(row["project_id"]),
            str(row["scope_id"]) if row.get("scope_id") is not None else None,
        ),
        workspace_instance_id=str(row["workspace_instance_id"]),
        bound_user_id=str(row["bound_user_id"]),
        cloud_origin=str(row["cloud_origin"]),
        mode=BindingMode(row["mode"]),
        status=BindingStatus(row["status"]),
        created_at=_datetime(row["created_at"]),
        updated_at=_datetime(row["updated_at"]),
        last_seen_at=_datetime(row["last_seen_at"]),
        revoked_at=_datetime(row["revoked_at"]) if row.get("revoked_at") else None,
    )


class WorkspaceBindingRepository:
    TABLE = "project_workspace_bindings"

    def __init__(self, supabase_client: Any | None = None):
        if supabase_client is None:
            from src.infra.supabase.dependencies import get_supabase_client

            supabase_client = get_supabase_client()
        self._client = supabase_client

    def get_for_user(self, binding_id: str, user_id: str) -> WorkspaceBinding | None:
        response = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("id", binding_id)
            .eq("bound_user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return _row_to_binding(rows[0]) if rows else None

    def get_by_id(self, binding_id: str) -> WorkspaceBinding | None:
        rows = (
            self._client.table(self.TABLE).select("*").eq("id", binding_id).limit(1).execute()
        ).data or []
        return _row_to_binding(rows[0]) if rows else None

    def list_by_project(
        self, project_id: str, *, user_id: str | None = None
    ) -> list[WorkspaceBinding]:
        query = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .order("updated_at", desc=True)
        )
        if user_id is not None:
            query = query.eq("bound_user_id", user_id)
        return [_row_to_binding(row) for row in (query.execute().data or [])]

    def get_active_by_instance(self, workspace_instance_id: str) -> WorkspaceBinding | None:
        response = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("workspace_instance_id", workspace_instance_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return _row_to_binding(rows[0]) if rows else None

    def get_scope(self, project_id: str, scope_id: str) -> dict[str, Any] | None:
        rows = (
            self._client.table("repository_scopes")
            .select("*")
            .eq("project_id", project_id)
            .eq("id", scope_id)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def create_with_credential(
        self,
        *,
        org_id: str,
        project_id: str,
        target: RepositoryTarget,
        workspace_instance_id: str,
        bound_user_id: str,
        cloud_origin: str,
        mode: BindingMode,
    ) -> tuple[WorkspaceBinding, str]:
        binding_id = generate_uuid_v7()
        access_surface_id = generate_uuid_v7()
        credential_id = generate_uuid_v7()
        raw_token = generate_access_token("pwg")
        key_prefix, key_last4 = access_token_metadata(raw_token)
        response = self._client.rpc(
            "create_project_workspace_git_binding",
            {
                "p_binding_id": binding_id,
                "p_org_id": org_id,
                "p_project_id": project_id,
                "p_scope_id": repository_target_scope_id(target),
                "p_workspace_instance_id": workspace_instance_id,
                "p_bound_user_id": bound_user_id,
                "p_cloud_origin": cloud_origin,
                "p_mode": mode.value,
                "p_access_surface_id": access_surface_id,
                "p_credential_id": credential_id,
                "p_key_prefix": key_prefix,
                "p_key_last4": key_last4,
                "p_key_hash": access_token_hash(raw_token),
                "p_hash_alg": HASH_ALG,
            },
        ).execute()
        rows = response.data or []
        row = rows[0] if isinstance(rows, list) else rows
        if not row:
            raise RuntimeError("binding creation returned no row")
        return _row_to_binding(row), raw_token

    def heartbeat(self, binding_id: str, user_id: str) -> WorkspaceBinding | None:
        now = datetime.now(UTC).isoformat()
        rows = (
            self._client.table(self.TABLE)
            .update({"last_seen_at": now})
            .eq("id", binding_id)
            .eq("bound_user_id", user_id)
            .eq("status", "active")
            .execute()
        ).data or []
        return _row_to_binding(rows[0]) if rows else None

    def revoke(self, binding_id: str, user_id: str) -> bool:
        response = self._client.rpc(
            "revoke_project_workspace_binding",
            {"p_binding_id": binding_id, "p_bound_user_id": user_id},
        ).execute()
        data = response.data
        if isinstance(data, list):
            return bool(data and data[0])
        return bool(data)

    def revoke_admin(self, binding_id: str, project_id: str, actor_user_id: str) -> bool:
        data = (
            self._client.rpc(
                "revoke_project_workspace_binding_admin",
                {
                    "p_binding_id": binding_id,
                    "p_project_id": project_id,
                    "p_actor_user_id": actor_user_id,
                },
            )
            .execute()
            .data
        )
        if isinstance(data, list):
            return bool(data and data[0])
        return bool(data)

    def rotate_credential(self, binding_id: str, user_id: str) -> str | None:
        credential_id = generate_uuid_v7()
        raw_token = generate_access_token("pwg")
        key_prefix, key_last4 = access_token_metadata(raw_token)
        changed = (
            self._client.rpc(
                "rotate_project_workspace_binding_git_credential",
                {
                    "p_binding_id": binding_id,
                    "p_bound_user_id": user_id,
                    "p_credential_id": credential_id,
                    "p_key_prefix": key_prefix,
                    "p_key_last4": key_last4,
                    "p_key_hash": access_token_hash(raw_token),
                    "p_hash_alg": HASH_ALG,
                },
            )
            .execute()
            .data
        )
        if isinstance(changed, list):
            changed = changed[0] if changed else False
        return raw_token if changed else None

    def revoke_credential(self, binding_id: str, user_id: str) -> bool:
        changed = (
            self._client.rpc(
                "revoke_project_workspace_binding_git_credential",
                {
                    "p_binding_id": binding_id,
                    "p_bound_user_id": user_id,
                },
            )
            .execute()
            .data
        )
        if isinstance(changed, list):
            changed = changed[0] if changed else False
        return bool(changed)

    def resolve_credential(self, raw_token: str) -> dict[str, Any] | None:
        from src.repo.access_credentials import AccessCredentialRepository

        credential = AccessCredentialRepository(self._client).get_active_by_token(raw_token)
        if not credential:
            return None
        rows = (
            self._client.table("access_surfaces")
            .select("project_id, scope_id")
            .eq("id", credential["access_surface_id"])
            .eq("status", "active")
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

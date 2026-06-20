"""MCP endpoint repository over access_surfaces + repo_scopes."""

from typing import Any, Dict, List, Optional

from src.utils.id_generator import generate_uuid_v7
from src.repo.scope_service import ScopeService
from src.repo.access_credentials import (
    AccessCredentialRepository,
    mask_access_token,
)


PROVIDER = "mcp"
ACCESS_SURFACES_TABLE = "access_surfaces"
ACCESS_SURFACE_POLICIES_TABLE = "access_surface_policies"
SCOPES_TABLE = "repo_scopes"


def _default_policy(accesses: Optional[list] = None, tools_config: Any = None) -> dict[str, Any]:
    return {
        "version": 1,
        "fs_policy": {
            "accesses": accesses or [],
        },
        "tools_policy": tools_config if tools_config is not None else {},
        "shell_policy": {
            "enabled": False,
        },
        "network_policy": {},
    }


def _row_to_endpoint(
    row: dict,
    scope_path: Optional[str] = None,
    *,
    policy: Optional[dict] = None,
    credential: Optional[dict] = None,
    plaintext_api_key: str = "",
) -> dict:
    """Reshape an access_surfaces row into the endpoint dict the API exposes."""
    config = row.get("config") or {}
    policy = policy or {}
    fs_policy = policy.get("fs_policy") or {}
    tools_policy = policy.get("tools_policy")
    credential_hint = mask_access_token(
        (credential or {}).get("key_prefix"),
        (credential or {}).get("key_last4"),
    )
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "scope_id": row.get("scope_id"),
        "path": scope_path,
        "name": row.get("name") or config.get("name", "MCP Endpoint"),
        "description": config.get("description"),
        "api_key": plaintext_api_key,
        "api_key_hint": credential_hint,
        "api_key_revealed": bool(plaintext_api_key),
        "tools_config": tools_policy if tools_policy is not None else {},
        "accesses": fs_policy.get("accesses") or [],
        "created_by": row.get("created_by") or config.get("created_by"),
        "config": {k: v for k, v in config.items()
                   if k not in ("name", "description", "tools_config",
                                "accesses", "api_key", "mcp_api_key",
                                "access_key", "created_by")},
        "status": row.get("status", "active"),
        "created_at": row.get("created_at", ""),
        "updated_at": row.get("updated_at", ""),
    }


class McpEndpointRepository:

    TABLE = ACCESS_SURFACES_TABLE

    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.infra.supabase.dependencies import get_supabase_client
            self._client = get_supabase_client()
        else:
            self._client = supabase_client
        self._credentials = AccessCredentialRepository(self._client)

    def _project_org_id(self, project_id: str) -> str | None:
        resp = (
            self._client.table("projects")
            .select("org_id")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0].get("org_id") if rows else None

    def _query(self):
        return (
            self._client.table(ACCESS_SURFACES_TABLE)
            .select("*")
            .eq("kind", PROVIDER)
        )

    def _scope_path_lookup(self, scope_ids: List[Optional[str]]) -> Dict[str, Optional[str]]:
        unique = list({sid for sid in scope_ids if sid})
        if not unique:
            return {}
        resp = (
            self._client.table(SCOPES_TABLE)
            .select("id, path")
            .in_("id", unique)
            .execute()
        )
        return {s["id"]: s.get("path") for s in (resp.data or [])}

    def _policy_lookup(self, surface_ids: List[str]) -> Dict[str, dict]:
        if not surface_ids:
            return {}
        resp = (
            self._client.table(ACCESS_SURFACE_POLICIES_TABLE)
            .select("*")
            .in_("access_surface_id", surface_ids)
            .execute()
        )
        return {p["access_surface_id"]: p for p in (resp.data or [])}

    def _hydrate(self, rows: List[dict]) -> List[dict]:
        if not rows:
            return []
        path_by_scope = self._scope_path_lookup([r.get("scope_id") for r in rows])
        surface_ids = [r["id"] for r in rows]
        policy_by_surface = self._policy_lookup(surface_ids)
        credential_by_surface = self._credentials.list_active_by_surface(surface_ids)
        return [
            _row_to_endpoint(
                r,
                path_by_scope.get(r.get("scope_id")),
                policy=policy_by_surface.get(r["id"]),
                credential=credential_by_surface.get(r["id"]),
            )
            for r in rows
        ]

    def _scope_for_path(self, project_id: str, path: Optional[str]) -> dict:
        normalized = (path or "").strip("/")
        scope_svc = ScopeService()
        for scope in scope_svc.list_for_project(project_id):
            if (scope.path or "") == normalized:
                return {"id": scope.id, "path": scope.path}
        scope = scope_svc.create(
            project_id=project_id,
            name=normalized.rsplit("/", 1)[-1] if normalized else "Root",
            path=normalized,
            exclude=[],
            mode="rw",
        )
        return {"id": scope.id, "path": scope.path}

    def get_by_id(self, endpoint_id: str) -> Optional[dict]:
        resp = self._query().eq("id", endpoint_id).execute()
        rows = self._hydrate(resp.data or [])
        return rows[0] if rows else None

    def get_by_api_key(self, api_key: str) -> Optional[dict]:
        credential = self._credentials.get_active_by_token(api_key)
        if not credential:
            return None
        resp = self._query().eq("id", credential["access_surface_id"]).execute()
        rows = self._hydrate(resp.data or [])
        return rows[0] if rows else None

    def list_by_project(self, project_id: str) -> List[dict]:
        resp = (
            self._query()
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        return self._hydrate(resp.data or [])

    def get_by_path(self, path: str) -> Optional[dict]:
        # path lives on the scope, not the connector. Resolve scope first,
        # then fetch the connector attached to it.
        normalized = (path or "").strip("/")
        scope_resp = (
            self._client.table(SCOPES_TABLE)
            .select("id")
            .eq("path", normalized)
            .execute()
        )
        scope_ids = [s["id"] for s in (scope_resp.data or [])]
        if not scope_ids:
            return None
        # mcp is intentionally exempt from the one-surface-per-scope unique index,
        # so a scope can host several endpoints — return the most recent one
        # deterministically rather than whatever order the DB happens to yield.
        resp = (
            self._query()
            .in_("scope_id", scope_ids)
            .order("created_at", desc=True)
            .execute()
        )
        rows = self._hydrate(resp.data or [])
        return rows[0] if rows else None

    def _upsert_policy(self, surface_id: str, *, accesses: Optional[list], tools_config: Any) -> dict:
        payload = {
            "access_surface_id": surface_id,
            **_default_policy(accesses, tools_config),
        }
        resp = (
            self._client.table(ACCESS_SURFACE_POLICIES_TABLE)
            .upsert(payload, on_conflict="access_surface_id")
            .execute()
        )
        return (resp.data or [payload])[0]

    def create(
        self,
        project_id: str,
        name: str,
        path: Optional[str] = None,
        description: Optional[str] = None,
        accesses: Optional[list] = None,
        tools_config: Any = None,
        created_by: Optional[str] = None,
    ) -> dict:
        config = {
            "name": name,
            "description": description,
            "created_by": created_by,
        }
        scope = self._scope_for_path(project_id, path)
        row = {
            "id": generate_uuid_v7(),
            "org_id": self._project_org_id(project_id),
            "project_id": project_id,
            "scope_id": scope["id"],
            "kind": PROVIDER,
            "name": name,
            "config": config,
            "status": "active",
            "created_by": created_by,
        }
        resp = self._client.table(self.TABLE).insert(row).execute()
        inserted = resp.data[0]
        api_key = self._credentials.issue_bearer_token(
            access_surface_id=inserted["id"],
            org_id=inserted.get("org_id"),
            project_id=inserted["project_id"],
            prefix="mcp",
            created_by=created_by,
        )
        policy = self._upsert_policy(
            inserted["id"],
            accesses=accesses or [],
            tools_config=tools_config if tools_config is not None else {},
        )
        credential = {
            "key_prefix": "mcp",
            "key_last4": api_key[-4:],
        }
        return _row_to_endpoint(
            inserted,
            scope["path"],
            policy=policy,
            credential=credential,
            plaintext_api_key=api_key,
        )

    def update(self, endpoint_id: str, **kwargs) -> Optional[dict]:
        current = self._query().eq("id", endpoint_id).execute()
        if not current.data:
            return None

        row = current.data[0]
        config = dict(row.get("config") or {})
        update_data = {}

        config_keys = ("name", "description")
        for key in config_keys:
            if key in kwargs and kwargs[key] is not None:
                config[key] = kwargs[key]

        update_data["config"] = config

        if "path" in kwargs:
            scope = self._scope_for_path(row["project_id"], kwargs["path"])
            update_data["scope_id"] = scope["id"]
        if "status" in kwargs:
            update_data["status"] = kwargs["status"]

        resp = (
            self._client.table(self.TABLE)
            .update(update_data)
            .eq("id", endpoint_id)
            .execute()
        )
        updated = resp.data[0] if resp.data else None
        if not updated:
            return None
        if "accesses" in kwargs or "tools_config" in kwargs:
            current_policy = self._policy_lookup([endpoint_id]).get(endpoint_id) or {}
            current_fs = current_policy.get("fs_policy") or {}
            self._upsert_policy(
                endpoint_id,
                accesses=kwargs.get("accesses", current_fs.get("accesses") or []),
                tools_config=kwargs.get("tools_config", current_policy.get("tools_policy") or {}),
            )
        return self.get_by_id(endpoint_id)

    def delete(self, endpoint_id: str) -> bool:
        resp = (
            self._client.table(self.TABLE)
            .delete()
            .eq("id", endpoint_id)
            .execute()
        )
        return bool(resp.data)

    def regenerate_api_key(self, endpoint_id: str) -> Optional[dict]:
        current = self._query().eq("id", endpoint_id).execute()
        if not current.data:
            return None
        row = current.data[0]
        api_key = self._credentials.issue_bearer_token(
            access_surface_id=row["id"],
            org_id=row.get("org_id"),
            project_id=row["project_id"],
            prefix="mcp",
            created_by=row.get("created_by"),
            revoke_existing=True,
        )
        path_by_scope = self._scope_path_lookup([row.get("scope_id")])
        policy = self._policy_lookup([row["id"]]).get(row["id"])
        credential = {
            "key_prefix": "mcp",
            "key_last4": api_key[-4:],
        }
        return _row_to_endpoint(
            row,
            path_by_scope.get(row.get("scope_id")),
            policy=policy,
            credential=credential,
            plaintext_api_key=api_key,
        )

    def verify_access(self, endpoint_id: str, user_id: str) -> bool:
        endpoint = self.get_by_id(endpoint_id)
        if not endpoint:
            return False
        from src.platform.project.repository import ProjectRepositorySupabase
        project_repo = ProjectRepositorySupabase()
        role = project_repo.verify_project_access(endpoint["project_id"], user_id)
        return role is not None

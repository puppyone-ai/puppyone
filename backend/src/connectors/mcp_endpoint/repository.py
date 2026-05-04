"""
MCP Endpoint Repository.

Read methods (get_by_id / get_by_api_key / get_by_path / list_by_project)
were migrated post-redesign-2026-05-02 to the `connectors` table
(provider='mcp'); the legacy `access_points` table is gone. The connector
row's `config` JSONB carries the api_key, tools_config, and accesses
fields, while `path` is recovered via a join on `repo_scopes` keyed by
scope_id (the redesign moved path off connector rows onto the scope).

Write methods (create / update / delete / regenerate_api_key) still
target the legacy table — they will raise APIError if hit because the
table no longer exists. They are slated for a follow-up migration that
must also wire scope_id provisioning; rerouting them naively without a
scope_id design would create rows the rest of the system can't read back.
"""

from typing import Dict, List, Optional
import secrets

from src.utils.id_generator import generate_uuid_v7


PROVIDER = "mcp"
CONNECTORS_TABLE = "connectors"
SCOPES_TABLE = "repo_scopes"


def generate_mcp_api_key() -> str:
    return f"mcp_{secrets.token_urlsafe(32)}"


def _row_to_endpoint(row: dict, scope_path: Optional[str] = None) -> dict:
    """Reshape a connectors row (provider='mcp') into the legacy MCP endpoint
    dict the router / service / frontend already consume. `scope_path` is
    sourced from a joined repo_scopes lookup since the connectors table no
    longer carries a path column. `api_key` lives in `config.api_key` after
    the redesign moved it off the row's columns into the JSONB blob.
    """
    config = row.get("config") or {}
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "path": scope_path,
        "name": row.get("name") or config.get("name", "MCP Endpoint"),
        "description": config.get("description"),
        "api_key": config.get("api_key", ""),
        "tools_config": config.get("tools_config", []),
        "accesses": config.get("accesses", []),
        "config": {k: v for k, v in config.items()
                   if k not in ("name", "description", "tools_config",
                                "accesses", "api_key")},
        "status": row.get("status", "active"),
        "created_at": row.get("created_at", ""),
        "updated_at": row.get("updated_at", ""),
    }


class McpEndpointRepository:

    # Legacy field kept for code that introspects TABLE; actual queries go
    # through CONNECTORS_TABLE / SCOPES_TABLE module constants.
    TABLE = "access_points"

    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.infra.supabase.dependencies import get_supabase_client
            self._client = get_supabase_client()
        else:
            self._client = supabase_client

    def _query(self):
        return (
            self._client.table(CONNECTORS_TABLE)
            .select("*")
            .eq("provider", PROVIDER)
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

    def _hydrate(self, rows: List[dict]) -> List[dict]:
        if not rows:
            return []
        path_by_scope = self._scope_path_lookup([r.get("scope_id") for r in rows])
        return [
            _row_to_endpoint(r, path_by_scope.get(r.get("scope_id")))
            for r in rows
        ]

    def get_by_id(self, endpoint_id: str) -> Optional[dict]:
        resp = self._query().eq("id", endpoint_id).execute()
        rows = self._hydrate(resp.data or [])
        return rows[0] if rows else None

    def get_by_api_key(self, api_key: str) -> Optional[dict]:
        # api_key now lives in connector.config (jsonb). Use postgrest-py's
        # .filter(path, op, value) form for jsonb access — matches the
        # convention already used in src/repo/connector_repository.py.
        resp = self._query().filter("config->>api_key", "eq", api_key).execute()
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
        resp = self._query().in_("scope_id", scope_ids).execute()
        rows = self._hydrate(resp.data or [])
        return rows[0] if rows else None

    def create(
        self,
        project_id: str,
        name: str,
        path: Optional[str] = None,
        description: Optional[str] = None,
        accesses: Optional[list] = None,
        tools_config: Optional[list] = None,
    ) -> dict:
        config = {
            "name": name,
            "description": description,
            "tools_config": tools_config or [],
            "accesses": accesses or [],
        }
        row = {
            "id": generate_uuid_v7(),
            "project_id": project_id,
            "path": path,
            "provider": PROVIDER,
            "direction": "bidirectional",
            "access_key": generate_mcp_api_key(),
            "config": config,
            "status": "active",
        }
        resp = self._client.table(self.TABLE).insert(row).execute()
        return _row_to_endpoint(resp.data[0])

    def update(self, endpoint_id: str, **kwargs) -> Optional[dict]:
        current = self._query().eq("id", endpoint_id).execute()
        if not current.data:
            return None

        row = current.data[0]
        config = dict(row.get("config") or {})
        update_data = {}

        config_keys = ("name", "description", "tools_config", "accesses")
        for key in config_keys:
            if key in kwargs and kwargs[key] is not None:
                config[key] = kwargs[key]

        update_data["config"] = config

        if "api_key" in kwargs:
            update_data["access_key"] = kwargs["api_key"]
        if "path" in kwargs:
            update_data["path"] = kwargs["path"]
        if "status" in kwargs:
            update_data["status"] = kwargs["status"]

        resp = (
            self._client.table(self.TABLE)
            .update(update_data)
            .eq("id", endpoint_id)
            .execute()
        )
        return _row_to_endpoint(resp.data[0]) if resp.data else None

    def delete(self, endpoint_id: str) -> bool:
        resp = (
            self._client.table(self.TABLE)
            .delete()
            .eq("id", endpoint_id)
            .eq("provider", PROVIDER)
            .execute()
        )
        return bool(resp.data)

    def regenerate_api_key(self, endpoint_id: str) -> Optional[dict]:
        new_key = generate_mcp_api_key()
        return self.update(endpoint_id, api_key=new_key)

    def verify_access(self, endpoint_id: str, user_id: str) -> bool:
        endpoint = self.get_by_id(endpoint_id)
        if not endpoint:
            return False
        from src.platform.project.repository import ProjectRepositorySupabase
        project_repo = ProjectRepositorySupabase()
        role = project_repo.verify_project_access(endpoint["project_id"], user_id)
        return role is not None

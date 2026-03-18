"""
MCP Endpoint Repository — reads/writes `connections` table (provider='mcp').

Type-specific fields (name, description, tools_config, accesses) live in
the `config` JSONB column, following the same pattern as Agent.
"""

from typing import List, Optional
import secrets

from src.utils.id_generator import generate_uuid_v7


PROVIDER = "mcp"


def generate_mcp_api_key() -> str:
    return f"mcp_{secrets.token_urlsafe(32)}"


def _row_to_endpoint(row: dict) -> dict:
    """Flatten connections row into the shape the MCP router/service expects."""
    config = row.get("config") or {}
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "node_id": row.get("node_id"),
        "name": config.get("name", "MCP Endpoint"),
        "description": config.get("description"),
        "api_key": row.get("access_key", ""),
        "tools_config": config.get("tools_config", []),
        "accesses": config.get("accesses", []),
        "config": {k: v for k, v in config.items()
                   if k not in ("name", "description", "tools_config", "accesses")},
        "status": row.get("status", "active"),
        "created_at": row.get("created_at", ""),
        "updated_at": row.get("updated_at", ""),
    }


class McpEndpointRepository:

    TABLE = "connections"

    def __init__(self, supabase_client=None):
        if supabase_client is None:
            from src.supabase.dependencies import get_supabase_client
            self._client = get_supabase_client()
        else:
            self._client = supabase_client

    def _query(self):
        return self._client.table(self.TABLE).select("*").eq("provider", PROVIDER)

    def get_by_id(self, endpoint_id: str) -> Optional[dict]:
        resp = self._query().eq("id", endpoint_id).execute()
        return _row_to_endpoint(resp.data[0]) if resp.data else None

    def get_by_api_key(self, api_key: str) -> Optional[dict]:
        resp = self._query().eq("access_key", api_key).execute()
        return _row_to_endpoint(resp.data[0]) if resp.data else None

    def list_by_project(self, project_id: str) -> List[dict]:
        resp = (
            self._query()
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        return [_row_to_endpoint(r) for r in (resp.data or [])]

    def get_by_node_id(self, node_id: str) -> Optional[dict]:
        resp = self._query().eq("node_id", node_id).execute()
        return _row_to_endpoint(resp.data[0]) if resp.data else None

    def create(
        self,
        project_id: str,
        name: str,
        node_id: Optional[str] = None,
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
            "node_id": node_id,
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
        if "node_id" in kwargs:
            update_data["node_id"] = kwargs["node_id"]
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
        from src.project.repository import ProjectRepositorySupabase
        project_repo = ProjectRepositorySupabase()
        role = project_repo.verify_project_access(endpoint["project_id"], user_id)
        return role is not None

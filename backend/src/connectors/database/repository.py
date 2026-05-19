"""DB Connector Repository over connectors + repo_scopes."""

from datetime import datetime, timezone
from typing import Optional, List

from src.infra.supabase.client import SupabaseClient
from src.connectors.database.models import DBConnection
from src.infra.security.crypto import (
    decrypt_db_connection_config,
    encrypt_db_connection_config,
)
from src.utils.id_generator import generate_uuid_v7
from src.repo.scope_service import ScopeService

DB_PROVIDER = "database"


class DBConnectionRepository:
    """Database connector CRUD over the canonical connectors table."""

    TABLE = "connectors"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _query(self):
        return self.client.table(self.TABLE).select("*").eq("provider", DB_PROVIDER)

    def _row_to_model(self, row: dict) -> DBConnection:
        config = row.get("config") or {}
        db_config = config.get("db_config") or {}
        plain_config = decrypt_db_connection_config(db_config) if db_config else {}
        return DBConnection(
            id=str(row["id"]),
            created_by=config.get("created_by"),
            project_id=str(row["project_id"]),
            name=config.get("name", ""),
            provider=config.get("db_provider", "supabase"),
            config=plain_config,
            is_active=(row.get("status", "active") == "active"),
            last_used_at=row.get("last_run_at"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create(
        self,
        created_by: str,
        project_id: str,
        name: str,
        provider: str,
        config: dict,
    ) -> DBConnection:
        encrypted_config = encrypt_db_connection_config(config)
        scope = ScopeService().ensure_root_scope(project_id)
        data = {
            "id": generate_uuid_v7(),
            "project_id": project_id,
            "scope_id": scope.id,
            "provider": DB_PROVIDER,
            "name": name,
            "direction": "inbound",
            "status": "active",
            "config": {
                "name": name,
                "db_provider": provider,
                "db_config": encrypted_config,
                "created_by": created_by,
            },
        }
        response = self.client.table(self.TABLE).insert(data).execute()
        if not response.data:
            raise Exception("Failed to create db access")
        return self._row_to_model(response.data[0])

    def get_by_id(self, connection_id: str) -> Optional[DBConnection]:
        response = (
            self._query()
            .eq("id", connection_id)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def list_by_project(self, project_id: str) -> List[DBConnection]:
        response = (
            self._query()
            .eq("project_id", project_id)
            .eq("status", "active")
            .order("created_at", desc=True)
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def update_last_used(self, connection_id: str) -> None:
        self.client.table(self.TABLE).update(
            {"last_run_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", connection_id).execute()

    def delete(self, connection_id: str) -> bool:
        response = (
            self.client.table(self.TABLE)
            .delete()
            .eq("id", connection_id)
            .eq("provider", DB_PROVIDER)
            .execute()
        )
        return bool(response.data)

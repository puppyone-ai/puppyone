"""DB Connector Repository - Supabase CRUD"""

from datetime import datetime
from typing import Optional, List, Any

from src.supabase.client import SupabaseClient
from src.db_connector.models import DBConnection
from src.security.crypto import (
    decrypt_db_connection_config,
    encrypt_db_connection_config,
)


class DBConnectionRepository:
    """数据库连接 CRUD"""

    TABLE = "db_connections"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _normalize_plain_config(config: Any) -> dict[str, Any]:
        if not isinstance(config, dict):
            return {}
        return decrypt_db_connection_config(config)

    def _row_to_model(self, row: dict) -> DBConnection:
        created_by = row.get("created_by")
        return DBConnection(
            id=str(row["id"]),
            created_by=str(created_by) if created_by is not None else None,
            project_id=str(row["project_id"]),
            name=row["name"],
            provider=row["provider"],
            config=self._normalize_plain_config(row.get("config", {})),
            is_active=row.get("is_active", True),
            last_used_at=row.get("last_used_at"),
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
        data = {
            "created_by": created_by,
            "project_id": project_id,
            "name": name,
            "provider": provider,
            "config": encrypted_config,
        }
        response = self.client.table(self.TABLE).insert(data).execute()
        if not response.data:
            raise Exception("Failed to create db connection")
        return self._row_to_model(response.data[0])

    def get_by_id(self, connection_id: str) -> Optional[DBConnection]:
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("id", connection_id)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def list_by_project(self, project_id: str) -> List[DBConnection]:
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def update_last_used(self, connection_id: str) -> None:
        self.client.table(self.TABLE).update(
            {"last_used_at": datetime.utcnow().isoformat()}
        ).eq("id", connection_id).execute()

    def delete(self, connection_id: str) -> bool:
        response = (
            self.client.table(self.TABLE)
            .delete()
            .eq("id", connection_id)
            .execute()
        )
        return bool(response.data)

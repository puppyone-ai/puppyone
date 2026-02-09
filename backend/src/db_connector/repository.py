"""DB Connector Repository - Supabase CRUD"""

from datetime import datetime
from typing import Optional, List

from src.supabase.client import SupabaseClient
from src.db_connector.models import DBConnection


class DBConnectionRepository:
    """数据库连接 CRUD"""

    TABLE = "db_connections"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _row_to_model(self, row: dict) -> DBConnection:
        return DBConnection(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            project_id=str(row["project_id"]),
            name=row["name"],
            provider=row["provider"],
            config=row.get("config", {}),
            is_active=row.get("is_active", True),
            last_used_at=row.get("last_used_at"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create(
        self,
        user_id: str,
        project_id: str,
        name: str,
        provider: str,
        config: dict,
    ) -> DBConnection:
        data = {
            "user_id": user_id,
            "project_id": project_id,
            "name": name,
            "provider": provider,
            "config": config,
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

    def list_by_user_and_project(
        self, user_id: str, project_id: str
    ) -> List[DBConnection]:
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("user_id", user_id)
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

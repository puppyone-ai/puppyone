"""
Table Data Access Layer

Provides CRUD operations for the tables table.
"""


from supabase import Client

from src.content.table.supabase_schemas import (
    TableCreate,
    TableResponse,
    TableUpdate,
)
from src.infra.supabase.exceptions import handle_supabase_error


class TableRepository:
    """Table data access repository"""

    TABLE_NAME = "tables"

    def __init__(self, client: Client):
        self._client = client

    def create(self, table_data: TableCreate) -> TableResponse:
        try:
            data = table_data.model_dump(exclude_none=True)
            data.pop("created_at", None)
            response = self._client.table(self.TABLE_NAME).insert(data).execute()
            return TableResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "create table")

    def get_by_id(self, table_id: str) -> TableResponse | None:
        response = (
            self._client.table(self.TABLE_NAME).select("*").eq("id", table_id).execute()
        )
        if response.data:
            return TableResponse(**response.data[0])
        return None

    def get_list(
        self,
        skip: int = 0,
        limit: int = 100,
        project_id: str | None = None,
        name: str | None = None,
    ) -> list[TableResponse]:
        query = self._client.table(self.TABLE_NAME).select("*")

        if project_id is not None:
            query = query.eq("project_id", project_id)

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [TableResponse(**item) for item in response.data]

    def update(self, table_id: str, table_data: TableUpdate) -> TableResponse | None:
        try:
            data = table_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(table_id)

            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table(self.TABLE_NAME)
                .update(data)
                .eq("id", table_id)
                .execute()
            )
            if response.data:
                return TableResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "update table")

    def delete(self, table_id: str) -> bool:
        response = (
            self._client.table(self.TABLE_NAME).delete().eq("id", table_id).execute()
        )
        return len(response.data) > 0

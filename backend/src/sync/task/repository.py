"""
Import Task Repository - Database operations for import tasks.

Uses the `uploads` table with type='import'.
"""

from typing import Optional

from src.sync.task.models import ImportTask, ImportTaskStatus, ImportTaskType
from src.supabase import get_supabase_client
from src.utils.logger import log_info


class ImportTaskRepository:
    """Database operations for import tasks using the uploads table."""

    TABLE = "uploads"

    def __init__(self):
        self.client = get_supabase_client()

    def _to_db_dict(self, task: ImportTask) -> dict:
        """Convert ImportTask to uploads table format."""
        config = {
            **task.config,
            "task_type": task.task_type.value,
            "source_url": task.source_url,
            "source_file_key": task.source_file_key,
            "items_count": task.items_count,
        }
        data = {
            "user_id": task.user_id,
            "project_id": task.project_id,
            "node_id": task.node_id,
            "type": "import",
            "config": config,
            "status": task.status.value,
            "progress": task.progress,
            "message": task.message,
            "error": task.error,
            "result_node_id": task.result_node_id,
            "result": task.result or {},
        }
        if task.id:
            data["id"] = task.id
        return data

    def _from_db_dict(self, data: dict) -> ImportTask:
        """Convert uploads table row to ImportTask."""
        from datetime import datetime

        config = dict(data.get("config") or {})
        task_type_val = config.pop("task_type", "url")
        source_url = config.pop("source_url", None)
        source_file_key = config.pop("source_file_key", None)
        items_count = config.pop("items_count", 0)

        def parse_dt(val):
            if val is None:
                return None
            if isinstance(val, datetime):
                return val
            if isinstance(val, str):
                val = val.replace("Z", "+00:00")
                return datetime.fromisoformat(val)
            return None

        return ImportTask(
            id=data["id"],
            user_id=data["user_id"],
            project_id=data["project_id"],
            task_type=ImportTaskType(task_type_val),
            source_url=source_url,
            source_file_key=source_file_key,
            config=config,
            status=ImportTaskStatus(data.get("status", "pending")),
            progress=data.get("progress", 0),
            message=data.get("message"),
            error=data.get("error"),
            node_id=data.get("node_id"),
            result_node_id=data.get("result_node_id"),
            items_count=items_count or 0,
            result=data.get("result") or {},
            created_at=parse_dt(data.get("created_at")),
            updated_at=parse_dt(data.get("updated_at")),
            started_at=parse_dt(data.get("started_at")),
            completed_at=parse_dt(data.get("completed_at")),
        )

    async def create(self, task: ImportTask) -> ImportTask:
        """Create a new import task."""
        data = self._to_db_dict(task)

        result = self.client.table(self.TABLE).insert(data).execute()

        if result.data:
            task.id = result.data[0]["id"]
            log_info(f"Created import task: {task.id}")
        return task

    async def get(self, task_id: str) -> Optional[ImportTask]:
        """Get task by ID."""
        result = self.client.table(self.TABLE).select("*").eq("id", task_id).execute()

        if result.data:
            return self._from_db_dict(result.data[0])
        return None

    async def get_by_user(
        self, 
        user_id: str, 
        project_id: Optional[str] = None,
        limit: int = 50
    ) -> list[ImportTask]:
        """Get tasks by user (filtered to type='import')."""
        query = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("type", "import")
        )

        if project_id:
            query = query.eq("project_id", project_id)

        result = query.order("created_at", desc=True).limit(limit).execute()

        return [self._from_db_dict(row) for row in result.data]

    async def update(self, task: ImportTask) -> ImportTask:
        """Update task."""
        if not task.id:
            raise ValueError("Task ID is required for update")

        data = self._to_db_dict(task)

        self.client.table(self.TABLE).update(data).eq("id", task.id).execute()

        return task

    async def update_status(
        self,
        task_id: str,
        status: ImportTaskStatus,
        progress: Optional[int] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        node_id: Optional[str] = None,
        result_node_id: Optional[str] = None,
        items_count: Optional[int] = None,
    ) -> None:
        """Update task status fields."""
        data: dict = {
            "status": status.value,
            "updated_at": "now()",
        }

        if progress is not None:
            data["progress"] = progress
        if message is not None:
            data["message"] = message
        if error is not None:
            data["error"] = error
        if node_id is not None:
            data["node_id"] = node_id
        if result_node_id is not None:
            data["result_node_id"] = result_node_id
        if items_count is not None:
            data["result"] = {"items_count": items_count}

        if status == ImportTaskStatus.RUNNING:
            data["started_at"] = "now()"
        if status.is_terminal():
            data["completed_at"] = "now()"

        self.client.table(self.TABLE).update(data).eq("id", task_id).execute()

    async def delete(self, task_id: str) -> bool:
        """Delete task."""
        result = self.client.table(self.TABLE).delete().eq("id", task_id).execute()
        return len(result.data) > 0


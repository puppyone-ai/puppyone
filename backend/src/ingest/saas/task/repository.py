"""
Import Task Repository - Database operations for import tasks.

Uses the existing `sync_task` table to avoid creating a new table.
"""

from typing import Optional

from supabase import Client

from src.ingest.saas.task.models import ImportTask, ImportTaskStatus, ImportTaskType
from src.supabase import get_supabase_client
from src.utils.logger import log_error, log_info


class ImportTaskRepository:
    """
    Database operations for import tasks.
    
    Uses the existing `sync_task` table with field mapping:
    - task_type -> task_type
    - message -> progress_message
    - content_node_id -> root_node_id
    - items_count -> files_total
    """

    TABLE = "sync_task"  # Reuse existing table!

    def __init__(self):
        self.client = get_supabase_client()

    def _to_db_dict(self, task: ImportTask) -> dict:
        """Convert ImportTask to sync_task table format."""
        return {
            "user_id": task.user_id,
            "project_id": task.project_id,
            "task_type": task.task_type.value,
            "source_url": task.source_url or "",
            "status": self._map_status_to_db(task.status),
            "progress": task.progress,
            "progress_message": task.message,
            "root_node_id": task.content_node_id,
            "files_total": task.items_count or 0,
            "files_processed": task.items_count or 0,
            "metadata": task.config or {},
            "error": task.error,
        }

    def _from_db_dict(self, data: dict) -> ImportTask:
        """Convert sync_task table row to ImportTask."""
        from datetime import datetime
        
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
            id=str(data["id"]),  # sync_task uses int, convert to str
            user_id=data["user_id"],
            project_id=data["project_id"],
            task_type=ImportTaskType(data["task_type"]),
            source_url=data.get("source_url"),
            config=data.get("metadata", {}),
            status=self._map_status_from_db(data["status"]),
            progress=data.get("progress", 0),
            message=data.get("progress_message"),
            content_node_id=data.get("root_node_id"),
            items_count=data.get("files_total", 0),
            error=data.get("error"),
            created_at=parse_dt(data.get("created_at")),
            updated_at=parse_dt(data.get("updated_at")),
            completed_at=parse_dt(data.get("completed_at")),
        )

    def _map_status_to_db(self, status: ImportTaskStatus) -> str:
        """Map ImportTaskStatus to sync_task status values."""
        mapping = {
            ImportTaskStatus.PENDING: "pending",
            ImportTaskStatus.PROCESSING: "downloading",  # Use downloading as "processing"
            ImportTaskStatus.COMPLETED: "completed",
            ImportTaskStatus.FAILED: "failed",
            ImportTaskStatus.CANCELLED: "cancelled",
        }
        return mapping.get(status, "pending")

    def _map_status_from_db(self, db_status: str) -> ImportTaskStatus:
        """Map sync_task status to ImportTaskStatus."""
        mapping = {
            "pending": ImportTaskStatus.PENDING,
            "downloading": ImportTaskStatus.PROCESSING,
            "extracting": ImportTaskStatus.PROCESSING,
            "uploading": ImportTaskStatus.PROCESSING,
            "creating_nodes": ImportTaskStatus.PROCESSING,
            "completed": ImportTaskStatus.COMPLETED,
            "failed": ImportTaskStatus.FAILED,
            "cancelled": ImportTaskStatus.CANCELLED,
        }
        return mapping.get(db_status, ImportTaskStatus.PENDING)

    async def create(self, task: ImportTask) -> ImportTask:
        """Create a new import task."""
        data = self._to_db_dict(task)
        
        result = self.client.table(self.TABLE).insert(data).execute()
        
        if result.data:
            task.id = str(result.data[0]["id"])
            log_info(f"Created import task: {task.id}")
        return task

    async def get(self, task_id: str) -> Optional[ImportTask]:
        """Get task by ID."""
        # sync_task uses int ID
        try:
            int_id = int(task_id)
        except ValueError:
            return None
        
        result = self.client.table(self.TABLE).select("*").eq("id", int_id).execute()
        
        if result.data:
            return self._from_db_dict(result.data[0])
        return None

    async def get_by_user(
        self, 
        user_id: str, 
        project_id: Optional[str] = None,
        limit: int = 50
    ) -> list[ImportTask]:
        """Get tasks by user."""
        query = self.client.table(self.TABLE).select("*").eq("user_id", user_id)
        
        if project_id:
            query = query.eq("project_id", project_id)
        
        result = query.order("created_at", desc=True).limit(limit).execute()
        
        return [self._from_db_dict(row) for row in result.data]

    async def update(self, task: ImportTask) -> ImportTask:
        """Update task."""
        if not task.id:
            raise ValueError("Task ID is required for update")
        
        data = self._to_db_dict(task)
        int_id = int(task.id)
        
        self.client.table(self.TABLE).update(data).eq("id", int_id).execute()
        
        return task

    async def update_status(
        self,
        task_id: str,
        status: ImportTaskStatus,
        progress: Optional[int] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        content_node_id: Optional[str] = None,
        items_count: Optional[int] = None,
    ) -> None:
        """Update task status fields."""
        int_id = int(task_id)
        
        data = {
            "status": self._map_status_to_db(status),
            "updated_at": "now()",
        }
        
        if progress is not None:
            data["progress"] = progress
        if message is not None:
            data["progress_message"] = message
        if error is not None:
            data["error"] = error
        if content_node_id is not None:
            data["root_node_id"] = content_node_id
        if items_count is not None:
            data["files_total"] = items_count
            data["files_processed"] = items_count
        
        if status.is_terminal():
            data["completed_at"] = "now()"
        
        self.client.table(self.TABLE).update(data).eq("id", int_id).execute()

    async def delete(self, task_id: str) -> bool:
        """Delete task."""
        int_id = int(task_id)
        result = self.client.table(self.TABLE).delete().eq("id", int_id).execute()
        return len(result.data) > 0


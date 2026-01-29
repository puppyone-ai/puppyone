"""
Sync Task Repository

Database operations for sync tasks.
"""

from typing import Optional

from supabase import Client

from .models import SyncTask, SyncTaskStatus


class SyncTaskRepository:
    """Repository for sync task database operations."""

    TABLE_NAME = "sync_task"

    def __init__(self, supabase_client: Client):
        self.client = supabase_client

    async def create(self, task: SyncTask) -> SyncTask:
        """Create a new sync task."""
        data = task.to_dict()
        # Remove id for insert (auto-generated)
        data.pop("id", None)

        response = self.client.table(self.TABLE_NAME).insert(data).execute()

        if response.data and len(response.data) > 0:
            return SyncTask.from_dict(response.data[0])
        raise Exception("Failed to create sync task")

    async def get_by_id(self, task_id: int) -> Optional[SyncTask]:
        """Get a sync task by ID."""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("id", task_id)
            .execute()
        )

        if response.data and len(response.data) > 0:
            return SyncTask.from_dict(response.data[0])
        return None

    async def get_by_user(
        self,
        user_id: str,
        limit: int = 50,
        include_completed: bool = True,
    ) -> list[SyncTask]:
        """Get sync tasks for a user."""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
        )

        if not include_completed:
            query = query.not_.in_(
                "status",
                [s.value for s in SyncTaskStatus.terminal_statuses()],
            )

        response = query.execute()
        return [SyncTask.from_dict(row) for row in response.data]

    async def get_by_project(
        self,
        project_id: str,
        limit: int = 50,
    ) -> list[SyncTask]:
        """Get sync tasks for a project."""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [SyncTask.from_dict(row) for row in response.data]

    async def get_active_tasks(self, user_id: str) -> list[SyncTask]:
        """Get all non-terminal tasks for a user."""
        terminal_statuses = [s.value for s in SyncTaskStatus.terminal_statuses()]
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("user_id", user_id)
            .not_.in_("status", terminal_statuses)
            .order("created_at", desc=True)
            .execute()
        )
        return [SyncTask.from_dict(row) for row in response.data]

    async def update(self, task: SyncTask) -> SyncTask:
        """Update a sync task."""
        if task.id is None:
            raise ValueError("Cannot update task without id")

        data = task.to_dict()
        data.pop("id", None)  # Don't update id
        data.pop("created_at", None)  # Don't update created_at

        response = (
            self.client.table(self.TABLE_NAME)
            .update(data)
            .eq("id", task.id)
            .execute()
        )

        if response.data and len(response.data) > 0:
            return SyncTask.from_dict(response.data[0])
        raise Exception(f"Failed to update sync task {task.id}")

    async def update_progress(
        self,
        task_id: int,
        progress: int,
        progress_message: Optional[str] = None,
        status: Optional[SyncTaskStatus] = None,
        **kwargs,
    ) -> Optional[SyncTask]:
        """Update task progress efficiently."""
        data = {
            "progress": progress,
            "updated_at": "now()",
        }
        if progress_message is not None:
            data["progress_message"] = progress_message
        if status is not None:
            data["status"] = status.value

        # Allow additional fields
        for key in ["files_processed", "files_total", "bytes_downloaded", "bytes_total"]:
            if key in kwargs:
                data[key] = kwargs[key]

        response = (
            self.client.table(self.TABLE_NAME)
            .update(data)
            .eq("id", task_id)
            .execute()
        )

        if response.data and len(response.data) > 0:
            return SyncTask.from_dict(response.data[0])
        return None

    async def mark_completed(
        self, task_id: int, root_node_id: str
    ) -> Optional[SyncTask]:
        """Mark task as completed."""
        data = {
            "status": SyncTaskStatus.COMPLETED.value,
            "progress": 100,
            "progress_message": "Completed",
            "root_node_id": root_node_id,
            "completed_at": "now()",
            "updated_at": "now()",
        }

        response = (
            self.client.table(self.TABLE_NAME)
            .update(data)
            .eq("id", task_id)
            .execute()
        )

        if response.data and len(response.data) > 0:
            return SyncTask.from_dict(response.data[0])
        return None

    async def mark_failed(self, task_id: int, error: str) -> Optional[SyncTask]:
        """Mark task as failed."""
        data = {
            "status": SyncTaskStatus.FAILED.value,
            "error": error,
            "progress_message": f"Failed: {error[:100]}",
            "updated_at": "now()",
        }

        response = (
            self.client.table(self.TABLE_NAME)
            .update(data)
            .eq("id", task_id)
            .execute()
        )

        if response.data and len(response.data) > 0:
            return SyncTask.from_dict(response.data[0])
        return None

    async def delete(self, task_id: int) -> bool:
        """Delete a sync task."""
        response = (
            self.client.table(self.TABLE_NAME)
            .delete()
            .eq("id", task_id)
            .execute()
        )
        return len(response.data) > 0


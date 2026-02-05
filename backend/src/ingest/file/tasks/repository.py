"""
ETL Task Repository

Repository for managing ETL task persistence in Supabase.
"""

import logging
from abc import ABC, abstractmethod
from datetime import datetime, UTC
from typing import Optional

from src.ingest.file.tasks.models import ETLTask, ETLTaskStatus
from src.supabase.client import SupabaseClient
from src.supabase.exceptions import handle_supabase_error

logger = logging.getLogger(__name__)


class ETLTaskRepositoryBase(ABC):
    """Abstract base class for ETL task repository."""

    @abstractmethod
    def create_task(self, task: ETLTask) -> ETLTask:
        """
        Create a new task in storage.

        Args:
            task: Task to create (task_id will be assigned)

        Returns:
            Task with assigned task_id
        """
        pass

    @abstractmethod
    def get_task(self, task_id: int) -> Optional[ETLTask]:
        """
        Get task by ID.

        Args:
            task_id: Task identifier

        Returns:
            Task if found, None otherwise
        """
        pass

    @abstractmethod
    def update_task(self, task: ETLTask) -> Optional[ETLTask]:
        """
        Update existing task.

        Args:
            task: Task to update

        Returns:
            Updated task if found, None otherwise
        """
        pass

    @abstractmethod
    def list_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[int] = None,
        status: Optional[ETLTaskStatus] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ETLTask]:
        """
        List tasks with optional filters.

        Args:
            user_id: Filter by user ID
            project_id: Filter by project ID
            status: Filter by status
            limit: Maximum number of results
            offset: Number of results to skip

        Returns:
            List of tasks
        """
        pass

    @abstractmethod
    def count_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[int] = None,
        status: Optional[ETLTaskStatus] = None,
    ) -> int:
        """
        Count tasks with optional filters.

        Args:
            user_id: Filter by user ID
            project_id: Filter by project ID
            status: Filter by status

        Returns:
            Number of matching tasks
        """
        pass

    @abstractmethod
    def delete_task(self, task_id: int) -> bool:
        """
        Delete task by ID.

        Args:
            task_id: Task identifier

        Returns:
            True if deleted, False if not found
        """
        pass


class ETLTaskRepositorySupabase(ETLTaskRepositoryBase):
    """Supabase implementation of ETL task repository."""

    TABLE_NAME = "etl_task"

    def __init__(self):
        """Initialize Supabase task repository."""
        self.supabase = SupabaseClient().client
        logger.info("ETLTaskRepositorySupabase initialized")

    def create_task(self, task: ETLTask) -> ETLTask:
        """Create a new task in Supabase."""
        try:
            # Convert task to dict for insertion
            insert_data = task.to_dict()

            # Remove id field as it will be auto-generated
            if "id" in insert_data:
                del insert_data["id"]

            # Insert to database
            response = (
                self.supabase.table(self.TABLE_NAME).insert(insert_data).execute()
            )

            if not response.data or len(response.data) == 0:
                raise Exception("Failed to create task: no data returned")

            # Get inserted record
            row = response.data[0]

            # Create task from database record
            created_task = ETLTask.from_dict(row)

            logger.info(
                f"Created task: {created_task.task_id} for user {created_task.user_id}"
            )
            return created_task

        except Exception as e:
            handle_supabase_error(e, "创建 ETL 任务")

    def get_task(self, task_id: int) -> Optional[ETLTask]:
        """Get task by ID from Supabase."""
        try:
            response = (
                self.supabase.table(self.TABLE_NAME)
                .select("*")
                .eq("id", task_id)
                .execute()
            )

            if not response.data or len(response.data) == 0:
                logger.debug(f"Task not found: {task_id}")
                return None

            row = response.data[0]
            task = ETLTask.from_dict(row)

            return task

        except Exception as e:
            logger.error(f"Error getting task {task_id}: {e}")
            return None

    def update_task(self, task: ETLTask) -> Optional[ETLTask]:
        """Update existing task in Supabase."""
        if task.task_id is None:
            logger.error("Cannot update task without task_id")
            return None

        try:
            # Convert task to dict
            update_data = task.to_dict()

            # Remove id field (not updatable)
            if "id" in update_data:
                del update_data["id"]

            # Update timestamp
            update_data["updated_at"] = datetime.now(UTC).isoformat()

            # Update in database
            response = (
                self.supabase.table(self.TABLE_NAME)
                .update(update_data)
                .eq("id", task.task_id)
                .execute()
            )

            if not response.data or len(response.data) == 0:
                logger.warning(f"Task not found for update: {task.task_id}")
                return None

            row = response.data[0]
            updated_task = ETLTask.from_dict(row)

            logger.info(f"Updated task: {task.task_id}")
            return updated_task

        except Exception as e:
            handle_supabase_error(e, "更新 ETL 任务")

    def list_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[int] = None,
        status: Optional[ETLTaskStatus] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ETLTask]:
        """List tasks with optional filters."""
        try:
            query = self.supabase.table(self.TABLE_NAME).select("*")

            # Apply filters
            if user_id is not None:
                query = query.eq("user_id", user_id)
            if project_id is not None:
                query = query.eq("project_id", project_id)
            if status is not None:
                query = query.eq("status", status.value)

            # Apply pagination and ordering
            query = query.range(offset, offset + limit - 1).order(
                "created_at", desc=True
            )

            response = query.execute()

            tasks = []
            for row in response.data:
                task = ETLTask.from_dict(row)
                tasks.append(task)

            logger.info(
                f"Listed {len(tasks)} tasks "
                f"(user_id={user_id}, project_id={project_id}, status={status}, "
                f"offset={offset}, limit={limit})"
            )
            return tasks

        except Exception as e:
            logger.error(f"Error listing tasks: {e}")
            return []

    def count_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[int] = None,
        status: Optional[ETLTaskStatus] = None,
    ) -> int:
        """Count tasks with optional filters."""
        try:
            query = self.supabase.table(self.TABLE_NAME).select("id", count="exact")

            # Apply filters
            if user_id is not None:
                query = query.eq("user_id", user_id)
            if project_id is not None:
                query = query.eq("project_id", project_id)
            if status is not None:
                query = query.eq("status", status.value)

            response = query.execute()

            count = response.count if response.count is not None else 0
            return count

        except Exception as e:
            logger.error(f"Error counting tasks: {e}")
            return 0

    def delete_task(self, task_id: int) -> bool:
        """Delete task by ID."""
        try:
            response = (
                self.supabase.table(self.TABLE_NAME)
                .delete()
                .eq("id", task_id)
                .execute()
            )

            if not response.data or len(response.data) == 0:
                logger.warning(f"Task not found for deletion: {task_id}")
                return False

            logger.info(f"Deleted task: {task_id}")
            return True

        except Exception as e:
            handle_supabase_error(e, "删除 ETL 任务")

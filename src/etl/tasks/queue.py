"""
ETL Task Queue

Manages asynchronous ETL task queue and workers.
"""

import asyncio
import logging
from typing import Callable, Optional

from src.etl.tasks.models import ETLTask

logger = logging.getLogger(__name__)


class ETLQueue:
    """Asynchronous task queue for ETL processing."""

    def __init__(self, max_size: int = 1000, worker_count: int = 3):
        """
        Initialize ETL queue.

        Args:
            max_size: Maximum queue size
            worker_count: Number of worker tasks
        """
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=max_size)
        self.tasks: dict[str, ETLTask] = {}
        self.worker_count = worker_count
        self.workers: list[asyncio.Task] = []
        self.executor: Optional[Callable[[ETLTask], None]] = None
        self.is_running = False

        logger.info(
            f"ETLQueue initialized with max_size={max_size}, "
            f"worker_count={worker_count}"
        )

    def set_executor(self, executor: Callable[[ETLTask], None]):
        """
        Set the executor function for processing tasks.

        Args:
            executor: Async function that takes ETLTask and processes it
        """
        self.executor = executor
        logger.info("ETL queue executor set")

    async def submit(self, task: ETLTask) -> None:
        """
        Submit a task to the queue.

        Args:
            task: ETL task to submit

        Raises:
            asyncio.QueueFull: If queue is full
        """
        self.tasks[task.task_id] = task
        await self.queue.put(task.task_id)
        logger.info(f"Task {task.task_id} submitted to queue")

    def get_task(self, task_id: str) -> Optional[ETLTask]:
        """
        Get task by ID.

        Args:
            task_id: Task identifier

        Returns:
            ETLTask if found, None otherwise
        """
        return self.tasks.get(task_id)

    def list_tasks(
        self,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[ETLTask]:
        """
        List tasks with optional filters.

        Args:
            user_id: Filter by user ID
            project_id: Filter by project ID
            status: Filter by status

        Returns:
            List of matching tasks
        """
        tasks = list(self.tasks.values())

        if user_id:
            tasks = [t for t in tasks if t.user_id == user_id]
        if project_id:
            tasks = [t for t in tasks if t.project_id == project_id]
        if status:
            tasks = [t for t in tasks if t.status == status]

        return tasks

    async def start_workers(self):
        """Start worker tasks."""
        if self.is_running:
            logger.warning("Workers already running")
            return

        if not self.executor:
            raise RuntimeError("Executor not set. Call set_executor() first.")

        self.is_running = True
        logger.info(f"Starting {self.worker_count} workers")

        for i in range(self.worker_count):
            worker = asyncio.create_task(self._worker(i))
            self.workers.append(worker)

        logger.info(f"{self.worker_count} workers started")

    async def stop_workers(self):
        """Stop all worker tasks gracefully."""
        if not self.is_running:
            logger.warning("Workers not running")
            return

        logger.info("Stopping workers...")
        self.is_running = False

        # Cancel all workers
        for worker in self.workers:
            worker.cancel()

        # Wait for workers to finish
        await asyncio.gather(*self.workers, return_exceptions=True)

        self.workers.clear()
        logger.info("All workers stopped")

    async def _worker(self, worker_id: int):
        """
        Worker task that processes items from the queue.

        Args:
            worker_id: Worker identifier for logging
        """
        logger.info(f"Worker {worker_id} started")

        while self.is_running:
            try:
                # Get task from queue with timeout
                try:
                    task_id = await asyncio.wait_for(
                        self.queue.get(),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue

                task = self.tasks.get(task_id)
                if not task:
                    logger.error(f"Worker {worker_id}: Task {task_id} not found")
                    self.queue.task_done()
                    continue

                logger.info(
                    f"Worker {worker_id} processing task {task_id} "
                    f"(user_id={task.user_id}, filename={task.filename})"
                )

                # Execute task
                try:
                    if self.executor:
                        await self.executor(task)
                except Exception as e:
                    logger.error(
                        f"Worker {worker_id}: Error processing task {task_id}: {e}",
                        exc_info=True
                    )
                    task.mark_failed(f"Worker error: {str(e)}")

                self.queue.task_done()

            except asyncio.CancelledError:
                logger.info(f"Worker {worker_id} cancelled")
                break
            except Exception as e:
                logger.error(
                    f"Worker {worker_id}: Unexpected error: {e}",
                    exc_info=True
                )
                await asyncio.sleep(1)

        logger.info(f"Worker {worker_id} stopped")

    async def wait_empty(self):
        """Wait for queue to be empty."""
        await self.queue.join()

    def queue_size(self) -> int:
        """Get current queue size."""
        return self.queue.qsize()

    def task_count(self) -> int:
        """Get total number of tasks."""
        return len(self.tasks)


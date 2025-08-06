import json
import time
from threading import Lock, Thread
from collections import defaultdict
from typing import Optional, Dict, Any, TYPE_CHECKING

"""
DataStore Module - In-Memory Task and Workflow Management

Provides centralized storage and management for workflow tasks with:
- Thread-safe concurrent access
- Task-level locking mechanism
- Automatic cleanup of expired tasks
- Workflow lifecycle management

Key Features:
- Task data isolation through dedicated locks
- Background cleanup thread for expired tasks
- Resource management with delayed cleanup
- Type-safe workflow operations
"""

# Import logging functions
from Utils.logger import log_info, log_error, log_warning, log_debug

# Forward reference for WorkFlow to avoid circular imports
if TYPE_CHECKING:
    from .WorkFlow import WorkFlow

class DataStore:
    """
    Thread-safe in-memory storage for workflow tasks and metadata.
    
    Manages task lifecycle from creation to cleanup with automatic
    resource management and background cleanup processes.
    """
    
    def __init__(self):
        """Initialize DataStore with default settings and background cleanup."""
        self.data_store = defaultdict(lambda: {
            "blocks": {}, 
            "edges": {},
            "workflow": None,
            "created_at": time.time(),
            "marked_for_cleanup": False,
            "expire_at": 0
        })
        self.lock = Lock()
        self.task_locks = {}  # 每个task_id的专用锁
        self.task_locks_lock = Lock()  # 保护task_locks字典的访问
        
        # 启动后台清理线程
        self.cleanup_interval = 10  # 每10秒清理一次
        self.cleanup_thread = Thread(target=self._cleanup_expired_tasks_loop, daemon=True)
        self.cleanup_thread.start()
        
        log_info("DataStore initialized with background cleanup thread")

    def get_data(self, task_id: str) -> Dict[str, Any]:
        """
        Get task data (blocks and edges) for a specific task.
        
        Args:
            task_id: The task identifier
            
        Returns:
            Dict containing blocks and edges data
        """
        with self.lock:
            return {
                "blocks": self.data_store[task_id]["blocks"],
                "edges": self.data_store[task_id]["edges"]
            }

    def get_workflow(self, task_id: str) -> Optional['WorkFlow']:
        """
        Get workflow object for a specific task.
        
        Args:
            task_id: The task identifier
            
        Returns:
            WorkFlow object if found, None otherwise
        """
        with self.lock:
            # 检查任务是否存在
            if task_id not in self.data_store:
                log_warning(f"Task {task_id} does not exist in data store")
                return None
                
            task_data = self.data_store[task_id]
            
            # 检查任务是否已标记为清理
            if task_data.get("marked_for_cleanup", False):
                log_warning(f"Task {task_id} is marked for cleanup, but still accessible")
            
            # 更新访问时间以延长生命周期
            task_data["last_accessed"] = time.time()
            
            # 获取工作流对象
            workflow = task_data.get("workflow")
            
            if workflow:
                log_info(f"Retrieved workflow for task {task_id}")
            else:
                log_warning(f"Workflow object missing for task {task_id}")
                
            return workflow

    def set_workflow(self, task_id: str, workflow: 'WorkFlow') -> None:
        """
        Set workflow object for task (maintains its own data copy).
        
        Args:
            task_id: The task identifier
            workflow: The WorkFlow object to store
        """
        with self.lock:
            log_info(f"Storing workflow for task {task_id}")
            
            # 关联任务ID
            workflow.task_id = task_id
            
            # 简单存储工作流对象引用，不改变其内部数据
            self.data_store[task_id]["workflow"] = workflow
            self.data_store[task_id]["created_at"] = time.time()
            self.data_store[task_id]["last_accessed"] = time.time()
            
            log_info(f"Workflow successfully stored for task {task_id}")
            
    def set_data(self, task_id: str, blocks: Optional[Dict] = None, edges: Optional[Dict] = None) -> None:
        """
        Set task data (blocks and/or edges).
        
        Args:
            task_id: The task identifier
            blocks: Block data dictionary (optional)
            edges: Edge data dictionary (optional)
        """
        with self.lock:
            if blocks:
                if isinstance(blocks, str):
                    blocks = json.loads(blocks)
                self.data_store[task_id]["blocks"] = blocks

            if edges:
                if isinstance(edges, str):
                    edges = json.loads(edges)
                self.data_store[task_id]["edges"] = edges
            
            # 更新访问时间
            self.data_store[task_id]["last_accessed"] = time.time()

    def acquire_task_lock(self, task_id: str, blocking: bool = True, timeout: Optional[float] = None) -> bool:
        """
        Acquire a task-specific lock for exclusive access.
        
        Args:
            task_id: The task identifier
            blocking: Whether to block waiting for lock release
            timeout: Wait timeout in seconds (None for unlimited)
            
        Returns:
            bool: Whether the lock was successfully acquired
        """
        with self.task_locks_lock:
            # 如果任务锁不存在，创建一个新锁
            if task_id not in self.task_locks:
                self.task_locks[task_id] = Lock()
            
            # 使用指定的阻塞模式和超时时间尝试获取锁
            acquired = self.task_locks[task_id].acquire(blocking=blocking, timeout=timeout)
            return acquired
    
    def release_task_lock(self, task_id: str) -> None:
        """
        Release a task-specific lock.
        
        Args:
            task_id: The task identifier
        """
        with self.task_locks_lock:
            if task_id in self.task_locks:
                try:
                    self.task_locks[task_id].release()
                except RuntimeError:
                    # 锁可能已经被释放，忽略异常
                    pass
                
    def cleanup_task(self, task_id: str) -> None:
        """
        Safely cleanup task resources with delayed removal.
        
        Args:
            task_id: The task identifier
        """
        with self.lock:
            if task_id not in self.data_store:
                log_warning(f"Task {task_id} not found or already cleaned up")
                return
            
            # 清理工作流资源但保留任务记录
            workflow = self.data_store[task_id].get("workflow")
            if workflow:
                try:
                    workflow.cleanup_resources()
                except Exception as e:
                    log_error(f"Error cleaning workflow resources: {str(e)}")
                self.data_store[task_id]["workflow"] = None
            
            # 标记为等待清理，设置30秒后过期
            self.data_store[task_id]["marked_for_cleanup"] = True
            self.data_store[task_id]["expire_at"] = time.time() + 30
            
            log_info(f"Task {task_id} marked for delayed cleanup (expires in 30s)")
    
    def _cleanup_expired_tasks_loop(self) -> None:
        """Background thread: periodically cleanup expired tasks."""
        while True:
            try:
                time.sleep(self.cleanup_interval)
                self._cleanup_expired_tasks()
            except Exception as e:
                log_error(f"Error in cleanup thread: {str(e)}")
    
    def _cleanup_expired_tasks(self) -> None:
        """Cleanup expired tasks from memory."""
        now = time.time()
        expired_tasks = []
        
        # 获取过期任务列表
        with self.lock:
            for task_id in list(self.data_store.keys()):
                task_data = self.data_store[task_id]
                if task_data.get("marked_for_cleanup", False) and task_data.get("expire_at", 0) <= now:
                    expired_tasks.append(task_id)
        
        # 清理每个过期任务
        for task_id in expired_tasks:
            with self.lock:
                if task_id in self.data_store:
                    del self.data_store[task_id]
                    log_info(f"Expired task {task_id} removed from data store")
            
            # 清理任务锁
            with self.task_locks_lock:
                if task_id in self.task_locks:
                    del self.task_locks[task_id]
                    log_info(f"Task lock for {task_id} removed")
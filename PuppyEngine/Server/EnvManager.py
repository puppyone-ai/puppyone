"""
Environment Manager - 管理工作流执行环境的生命周期

职责：
1. 接收工作流提交请求，分配task_id
2. 在后台异步执行工作流环境(Env)
3. 管理任务状态和结果队列
4. 提供流式结果查询接口
"""

import asyncio
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, AsyncGenerator
import logging
from contextlib import asynccontextmanager

from Server.Env import Env
from clients.storage_client import StorageClient

logger = logging.getLogger(__name__)


class TaskState:
    """任务状态数据类"""
    def __init__(self, user_info: Dict[str, Any]):
        self.status: str = "PENDING"  # PENDING -> RUNNING -> COMPLETED/FAILED
        self.result_queue: asyncio.Queue = asyncio.Queue()
        self.start_time: datetime = datetime.now()
        self.end_time: Optional[datetime] = None
        self.error_message: Optional[str] = None
        self.user_info: Dict[str, Any] = user_info
        self.total_blocks: int = 0
        self.processed_blocks: int = 0


class EnvManager:
    """
    环境管理器 - 协调API层、执行环境(Env)和状态管理
    
    设计为单例模式，整个应用共享一个实例
    """
    
    def __init__(self):
        self._tasks: Dict[str, TaskState] = {}
        self._storage_client: Optional[StorageClient] = None
        self._background_tasks: Dict[str, asyncio.Task] = {}
        logger.info("EnvManager initialized")
    
    def set_storage_client(self, storage_client: StorageClient):
        """设置存储客户端"""
        self._storage_client = storage_client
        logger.info("Storage client configured for EnvManager")
    
    async def submit_workflow(self, workflow_data: Dict[str, Any], user_info: Dict[str, Any], edge_usage_callback=None) -> str:
        """
        提交新的工作流任务
        
        Args:
            workflow_data: 完整的workflow.json内容
            user_info: 提交用户的信息
            edge_usage_callback: 可选的边执行usage回调函数
            
        Returns:
            task_id: 用于查询结果的任务ID
        """
        # 生成唯一的task_id
        task_id = str(uuid.uuid4())
        
        # 创建任务状态
        task_state = TaskState(user_info)
        self._tasks[task_id] = task_state
        
        # 创建后台任务执行工作流
        background_task = asyncio.create_task(
            self._execute_workflow(task_id, workflow_data, task_state, edge_usage_callback)
        )
        self._background_tasks[task_id] = background_task
        
        logger.info(f"Workflow submitted with task_id: {task_id}, user: {user_info.get('user_id', 'unknown')}")
        
        return task_id
    
    async def _execute_workflow(self, task_id: str, workflow_data: Dict[str, Any], task_state: TaskState, edge_usage_callback=None):
        """
        在后台执行工作流
        
        这个方法运行在独立的asyncio任务中，与HTTP请求生命周期无关
        """
        try:
            # 更新状态为运行中
            task_state.status = "RUNNING"
            logger.info(f"Starting workflow execution for task {task_id}")
            
            # 创建Env实例
            env = Env(
                env_id=task_id,
                workflow_json=workflow_data,
                user_info=task_state.user_info,
                storage_client=self._storage_client
            )
            
            # 设置edge usage callback
            if edge_usage_callback:
                env.set_edge_usage_callback(edge_usage_callback)
            
            # 获取总块数用于进度跟踪
            task_state.total_blocks = len(env.blocks)
            
            # 运行环境并处理事件流
            async for event in env.run():
                # 将事件放入队列
                await task_state.result_queue.put(event)
                
                # 更新进度（如果是块结果）
                if isinstance(event, dict) and 'data' in event:
                    task_state.processed_blocks += len(event.get('data', {}))
                    logger.debug(f"Task {task_id}: Processed batch with {len(event.get('data', {}))} blocks")
            
            # 标记任务完成
            task_state.status = "COMPLETED"
            task_state.end_time = datetime.now()
            
            # 放入一个特殊的结束标记
            await task_state.result_queue.put({"__end__": True})
            
            logger.info(f"Workflow {task_id} completed successfully. Total blocks processed: {task_state.processed_blocks}")
            
        except Exception as e:
            # 记录错误
            task_state.status = "FAILED"
            task_state.end_time = datetime.now()
            task_state.error_message = str(e)
            
            # 放入错误信息
            await task_state.result_queue.put({
                "__error__": True,
                "error": str(e)
            })
            
            logger.error(f"Workflow {task_id} failed with error: {e}", exc_info=True)
        
        finally:
            # 清理后台任务引用
            self._background_tasks.pop(task_id, None)
    
    async def get_results_stream(self, task_id: str, user_info: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        获取任务结果的异步生成器
        
        Args:
            task_id: 任务ID
            user_info: 请求用户的信息
            
        Yields:
            结果批次或错误信息
            
        Raises:
            ValueError: 如果task_id不存在或用户无权限
        """
        # 检查任务是否存在
        if task_id not in self._tasks:
            raise ValueError(f"Task {task_id} not found")
        
        task_state = self._tasks[task_id]
        
        # 简单的权限检查（可以根据需要增强）
        if task_state.user_info.get("user_id") != user_info.get("user_id"):
            raise ValueError(f"Unauthorized access to task {task_id}")
        
        logger.info(f"Starting result stream for task {task_id}")
        
        # 从队列中流式读取结果
        while True:
            try:
                # 使用超时避免永久等待
                result = await asyncio.wait_for(
                    task_state.result_queue.get(),
                    timeout=1.0
                )
                
                # 检查是否是结束标记
                if isinstance(result, dict):
                    if result.get("__end__"):
                        logger.info(f"Result stream ended for task {task_id}")
                        break
                    elif result.get("__error__"):
                        logger.error(f"Yielding error for task {task_id}: {result.get('error')}")
                        yield result
                        break
                    
                    # 转换新事件格式为旧格式（向后兼容）
                    event_type = result.get("event_type")
                    
                    # 只传递包含数据的事件（向后兼容）
                    if event_type is None and "data" in result:
                        # 这是旧格式，直接传递
                        yield result
                    elif event_type in ["STREAM_STARTED", "STREAM_ENDED"]:
                        # 这些事件在v1 API中被忽略
                        logger.debug(f"Skipping {event_type} event for v1 compatibility")
                        continue
                    elif "data" in result:
                        # 提取数据部分，保持向后兼容
                        yield result
                    else:
                        # 其他事件类型在v1中被忽略
                        logger.debug(f"Skipping event type {event_type} for v1 compatibility")
                        continue
                else:
                    # 非字典结果，直接传递
                    yield result
                
            except asyncio.TimeoutError:
                # 检查任务是否已经结束
                if task_state.status in ["COMPLETED", "FAILED"] and task_state.result_queue.empty():
                    logger.info(f"No more results for task {task_id}, status: {task_state.status}")
                    break
                # 否则继续等待
                continue
    
    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        获取任务的当前状态
        
        Returns:
            包含状态信息的字典，如果任务不存在则返回None
        """
        if task_id not in self._tasks:
            return None
        
        task_state = self._tasks[task_id]
        
        return {
            "task_id": task_id,
            "status": task_state.status,
            "start_time": task_state.start_time.isoformat(),
            "end_time": task_state.end_time.isoformat() if task_state.end_time else None,
            "error_message": task_state.error_message,
            "total_blocks": task_state.total_blocks,
            "processed_blocks": task_state.processed_blocks,
            "progress_percentage": (
                task_state.processed_blocks / task_state.total_blocks * 100
                if task_state.total_blocks > 0 else 0
            )
        }
    
    def cleanup_old_tasks(self, hours: int = 24):
        """
        清理超过指定时间的已完成任务
        
        Args:
            hours: 保留任务的小时数
        """
        current_time = datetime.now()
        tasks_to_remove = []
        
        for task_id, task_state in self._tasks.items():
            if task_state.status in ["COMPLETED", "FAILED"] and task_state.end_time:
                if (current_time - task_state.end_time).total_seconds() > hours * 3600:
                    tasks_to_remove.append(task_id)
        
        for task_id in tasks_to_remove:
            del self._tasks[task_id]
            logger.info(f"Cleaned up old task: {task_id}")
        
        if tasks_to_remove:
            logger.info(f"Cleaned up {len(tasks_to_remove)} old tasks")


# 创建全局单例实例
env_manager = EnvManager()
"""
Engine Server - FastAPI Implementation with Concurrency Controls

Core Design Patterns:
--------------------
1. Task-Level Locking Mechanism:
   - Each task_id gets a dedicated lock to prevent concurrent processing
   - Non-blocking lock acquisition prevents deadlocks
   - Returns 409 Conflict when a task is already being processed
   - Ensures resources aren't modified by multiple requests simultaneously

2. Streaming Response Architecture:
   - Nested stream_data() generator provides separation of concerns:
     * Outer function (get_data): Request validation, parameter processing, lock management
     * Inner function (stream_data): Data generation, error handling, resource cleanup
   - Enables clean coupling between async FastAPI handlers and sync workflow processing
   - Delays execution until the response is consumed by the client

3. Resource Management:
   - Centralized cleanup in finally blocks ensures resources are released in all scenarios
   - Context managers (with workflow:) handle proper workflow cleanup
   - Hierarchical cleanup: workflow resources first, then task data, finally task locks
   - Exception handling at multiple levels prevents resource leaks

4. Concurrency Safety:
   - DataStore uses fine-grained locks for concurrent access safety
   - Task locks provide exclusive access to prevent race conditions
   - Workflow object assumes single-threaded access after task lock acquisition

5. Retry Mechanism:
   - Automatic retries for workflow retrieval handle potential timing issues
   - Short delays between retries allow for asynchronous data processing
   - Detailed diagnostic information when retries are exhausted
   - Avoids unnecessary complexity of explicit "ready" state tracking

6. Task ID Association:
   - WorkFlow instances are associated with their task_id during creation
   - Each workflow maintains its own data copy for processing independence
   - Ensures clear object boundaries and simplifies resource management
   - Prepares for future signature-based authorization mechanisms

7. Data Ownership Model:
   - Clear separation: DataStore owns task metadata, WorkFlow owns processing data
   - WorkFlow maintains its own copy of blocks and edges
   - No shared mutable state between components
   - Follows object-oriented principles of encapsulation and responsibility

Engineering Decisions:
---------------------
1. Minimal State Design:
   - Task existence and workflow existence are the only states tracked
   - No explicit "ready" or "processing" flags to avoid state complexity
   - State transitions are implicit and tied to concrete operations
   - Follows "Occam's Razor" principle - minimum necessary complexity

2. Error Handling Strategy:
   - Clear separation between client errors (4xx) and server errors (5xx)
   - Detailed error messages with context about task state
   - Structured error responses with error codes and descriptive messages
   - Comprehensive error logging for diagnosis

3. Validation:
   - Input validation in send_data ensures data integrity
   - Workflow creation validation prevents null/invalid workflows
   - Task existence validation before processing

4. Copy vs Reference Pattern:
   - Chose copy-based model over reference-based for future extensibility
   - Each WorkFlow maintains its own data copy allowing for independent operations
   - Simplifies future implementation of signature-based permissions
   - Easier to migrate to distributed processing in the future
   - Reduces tight coupling between system components

Future Expansion Architecture:
----------------------------
The system is designed to evolve toward more advanced patterns:

1. Signature-Based Authorization:
   - Each workflow will have a cryptographic signature for authorization
   - Signatures will define fine-grained read/write permissions on blocks
   - Block modifications verified against signature permissions
   - Support for time-limited or scoped access credentials
   - Current copy-based design prepares for this security model

2. Event Sourcing Upgrade Path:
   - Evolution to event-based architecture with command/query separation
   - Workflows will generate signed update commands
   - DataStore will validate, merge and apply updates
   - Central event bus will decouple producers and consumers
   - Support for conflict resolution and version history

3. Multi-Tenant Data Isolation:
   - Signature-based data partitioning for multi-tenant scenarios
   - Cryptographic isolation between different users' workflows
   - Central data store with logical tenant separation
   - Cross-tenant workflows with explicit permission boundaries

The copy-based model provides better encapsulation and clearer boundaries for these
future enhancements, especially for security and distributed processing features.

The server implements a straightforward synchronous workflow processor with concurrent
request handling capabilities through FastAPI's asynchronous model.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import uuid
import time
from threading import Lock, Thread
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from Server.WorkFlow import WorkFlow
from Server.JsonValidation import JsonValidator
from Utils.puppy_exception import PuppyException
from Utils.logger import log_info, log_error, log_warning, log_debug

class DataStore:
    def __init__(
        self
    ):
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

    def get_data(
        self,
        task_id: str
    ) -> dict:
        with self.lock:
            return {
                "blocks": self.data_store[task_id]["blocks"],
                "edges": self.data_store[task_id]["edges"]
            }

    def get_workflow(
        self,
        task_id: str
    ) -> WorkFlow:
        """获取工作流"""
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

    def set_workflow(
        self,
        task_id: str,
        workflow: WorkFlow
    ) -> None:
        """Set workflow object for task (maintains its own data copy)"""
        with self.lock:
            log_info(f"Storing workflow for task {task_id}")
            
            # 关联任务ID
            workflow.task_id = task_id
            
            # 简单存储工作流对象引用，不改变其内部数据
            self.data_store[task_id]["workflow"] = workflow
            self.data_store[task_id]["created_at"] = time.time()
            self.data_store[task_id]["last_accessed"] = time.time()
            
            log_info(f"Workflow successfully stored for task {task_id}")
            
    def set_data(
        self,
        task_id: str,
        blocks: dict = None,
        edges: dict = None
    ) -> None:
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

    # def set_input(
    #     self,
    #     task_id: str,
    #     blocks: dict
    # ) -> None:
    #     with self.lock:
    #         stored_blocks = self.data_store.get(task_id, {}).get("blocks", {})
    #         # Get existing input blocks
    #         input_blocks = {
    #             block_id: block
    #             for block_id, block in stored_blocks.items()
    #             if block.get("isInput")
    #         }
    #         input_block_ids = set(input_blocks.keys())

    #         # Verify incoming blocks match input blocks
    #         incoming_block_ids = set(blocks.keys())
    #         if incoming_block_ids != input_block_ids:
    #             raise PuppyException(
    #                 7302,
    #                 "Input Block Mismatch",
    #                 f"Incoming blocks {incoming_block_ids} do not match expected input blocks {input_block_ids}",
    #             )

    #         # Update only the input blocks while preserving other blocks
    #         for block_id, block in stored_blocks.items():
    #             if block_id in input_block_ids:
    #                 # Find and replace with the matching incoming block
    #                 new_block = blocks.get(block_id)
    #                 block.update(new_block)

    # def update_data(
    #     self,
    #     task_id: str,
    #     blocks: dict
    # ) -> None:
    #     with self.lock:
    #         block_map = self.data_store.get(task_id, {}).get("blocks", {})
    #         for new_block_id, new_block in blocks.items():
    #             if new_block_id in block_map:
    #                 block_map[new_block_id] = new_block

    #         # Update the blocks list
    #         self.data_store[task_id]["blocks"] = block_map

    def acquire_task_lock(self, task_id: str, blocking: bool = True, timeout: float = None) -> bool:
        """获取特定任务的锁
        
        Args:
            task_id: 任务ID
            blocking: 是否阻塞等待锁释放
            timeout: 等待超时时间(秒)，None表示无限等待
            
        Returns:
            bool: 是否成功获取锁
        """
        with self.task_locks_lock:
            # 如果任务锁不存在，创建一个新锁
            if task_id not in self.task_locks:
                self.task_locks[task_id] = Lock()
            
            # 使用指定的阻塞模式和超时时间尝试获取锁
            acquired = self.task_locks[task_id].acquire(blocking=blocking, timeout=timeout)
            return acquired
    
    def release_task_lock(self, task_id: str) -> None:
        """释放特定任务的锁"""
        with self.task_locks_lock:
            if task_id in self.task_locks:
                try:
                    self.task_locks[task_id].release()
                except RuntimeError:
                    # 锁可能已经被释放，忽略异常
                    pass
                
    def cleanup_task(self, task_id: str):
        """安全清理任务资源，但不立即删除"""
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
    
    def _cleanup_expired_tasks_loop(self):
        """后台线程：定期清理已过期的任务"""
        while True:
            try:
                time.sleep(self.cleanup_interval)
                self._cleanup_expired_tasks()
            except Exception as e:
                log_error(f"Error in cleanup thread: {str(e)}")
    
    def _cleanup_expired_tasks(self):
        """清理已过期的任务"""
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

try:
    app = FastAPI()

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=600  # Cache preflight for 10 minutes
    )

    data_store = DataStore()
except PuppyException as e:
    raise
except Exception as e:
    log_error(f"Server Initialization Error: {str(e)}")
    raise PuppyException(6301, "Server Initialization Error", str(e))


@app.get("/health")
async def health_check():
    try:
        log_info("Health check endpoint accessed!")
        return JSONResponse(content={"status": "healthy"}, status_code=200)
    except Exception as e:
        log_error(f"Health check error: {str(e)}!")
        raise PuppyException(6000, "Health Check Failed", str(e))

@app.get("/get_data/{task_id}")
async def get_data(
    task_id: str,
    wait: bool = True,  # 是否等待锁释放
    timeout: float = 60.0,  # 等待超时时间(秒)
    retry_attempts: int = 5,  # 重试次数
    retry_delay: float = 0.5  # 每次重试间隔(秒)
):
    try:
        # 尝试获取任务锁，根据wait参数决定是否阻塞等待
        if not data_store.acquire_task_lock(task_id, blocking=wait, timeout=timeout if wait else None):
            raise PuppyException(
                7304,
                "Task Lock Acquisition Failed",
                f"Task {task_id} is currently being processed and wait timed out or was not requested"
            )
        
        connection_id = f"{task_id}-{uuid.uuid4().hex[:8]}"
        log_info(f"Connection {connection_id}: Starting EventSource stream for task {task_id}")
        
        async def stream_data():          
            try:
                log_info(f"Connection {connection_id}: Stream generator initialized")
                
                # 尝试获取工作流，如果不存在则重试几次
                workflow = None
                attempts = 0
                
                while attempts < retry_attempts:
                    workflow = data_store.get_workflow(task_id)
                    
                    if workflow:
                        break
                    
                    # 首次重试使用info级别，后续重试使用warning级别表示可能存在问题    
                    if attempts == 0:
                        log_info(f"Connection {connection_id}: Workflow for task {task_id} not ready yet, initial retry")
                    else:
                        log_warning(f"Connection {connection_id}: Workflow for task {task_id} still not ready, retry {attempts+1}/{retry_attempts}")
                    
                    attempts += 1
                    
                    # 最后一次尝试不需要等待
                    if attempts < retry_attempts:
                        import asyncio
                        await asyncio.sleep(retry_delay)
                
                # 如果所有重试都失败
                if not workflow:
                    # 在记录错误前检查任务是否存在
                    task_exists = task_id in data_store.data_store
                    error_msg = f"Workflow with task_id {task_id} not found after {retry_attempts} attempts"
                    
                    if task_exists:
                        # 检查数据结构
                        task_data = data_store.data_store[task_id]
                        has_blocks = len(task_data.get("blocks", {})) > 0
                        has_edges = len(task_data.get("edges", {})) > 0
                        has_workflow = task_data.get("workflow") is not None
                        is_marked = task_data.get("marked_for_cleanup", False)
                        
                        error_msg += f". Task exists with blocks={has_blocks}, edges={has_edges}, workflow={has_workflow}, marked_for_cleanup={is_marked}"
                    else:
                        error_msg += f". Task does not exist in data store."
                    
                    log_error(error_msg)
                    raise PuppyException(
                        7303,
                        "Workflow Not Found",
                        error_msg
                    )
                
                log_info(f"Connection {connection_id}: Workflow found, beginning processing")
                
                # 记录开始时间
                start_time = time.time()
                last_yield_time = start_time
                yield_count = 0
                log_debug(f"Connection {connection_id}: Starting data streaming at {start_time}")
                
                # 使用上下文管理器自动管理资源
                with workflow:
                    for yielded_blocks in workflow.process():
                        if not yielded_blocks:
                            continue
                        
                        log_info(f"Connection {connection_id}: Yielding data block with {len(yielded_blocks)} blocks")
                        
                        # 记录 yield 前的时间
                        current_time = time.time()
                        time_since_last = current_time - last_yield_time
                        time_since_start = current_time - start_time
                        yield_count += 1
                        
                        log_debug(f"Connection {connection_id}: Yield #{yield_count} - Time since last yield: {time_since_last:.3f}s, Total time: {time_since_start:.3f}s")
                        
                        # 使用自定义序列化函数处理datetime等特殊类型
                        yield f"data: {json.dumps({'data': yielded_blocks, 'is_complete': False}, default=json_serializer)}\n\n"
                        
                        # 更新最后一次 yield 的时间
                        last_yield_time = time.time()
                        yield_after_time = last_yield_time - current_time
                        log_debug(f"Connection {connection_id}: Yield #{yield_count} completed - Yield operation took: {yield_after_time:.3f}s")
                    
                    # 记录最终完成信号的时间
                    final_time = time.time()
                    time_since_last = final_time - last_yield_time
                    total_time = final_time - start_time
                    
                    log_info(f"Connection {connection_id}: Processing complete, sending completion signal")
                    log_debug(f"Connection {connection_id}: Final completion signal - Time since last yield: {time_since_last:.3f}s, Total processing time: {total_time:.3f}s")
                    
                    yield f"data: {json.dumps({'is_complete': True})}\n\n"
                    
                    completion_after_time = time.time() - final_time
                    log_debug(f"Connection {connection_id}: Completion signal sent - Operation took: {completion_after_time:.3f}s, Total yields: {yield_count}")
                
            except PuppyException as e:
                log_error(f"Connection {connection_id}: Error during streaming: {str(e)}")
                yield f"data: {json.dumps({'error': str(e), 'code': e.code, 'message': e.message})}\n\n"
            except Exception as e:
                log_error(f"Connection {connection_id}: Unexpected error during streaming: {str(e)}")
                yield f"data: {json.dumps({'error': 'Internal server error', 'message': 'An unexpected error occurred'})}\n\n"
            finally:
                # 记录连接关闭
                log_info(f"Connection {connection_id}: Stream closing, marking task for delayed cleanup")
                
                # 所有资源清理集中在finally中
                try:
                    # 标记任务待清理，但不会立即删除
                    data_store.cleanup_task(task_id)
                except Exception as e:
                    log_error(f"Connection {connection_id}: Error during task cleanup: {str(e)}")
                
                # 确保锁一定被释放
                data_store.release_task_lock(task_id)
                log_info(f"Connection {connection_id}: Stream closed, task lock released")
        
        return StreamingResponse(stream_data(), media_type="text/event-stream")
    
    except PuppyException as e:
        # 确保在异常情况下也释放锁
        data_store.release_task_lock(task_id)
        log_error(f"PuppyEngine error: {str(e)}")
        return JSONResponse(
            content={"error": str(e), "code": e.code, "message": e.message}, 
            status_code=409 if e.code == 7304 else 400
        )
    except Exception as e:
        # 确保在异常情况下也释放锁
        data_store.release_task_lock(task_id)
        log_error(f"Unexpected error: {str(e)}")
        return JSONResponse(
            content={"error": "Internal server error", "message": str(e)},
            status_code=500
        )

@app.post("/send_data")
async def send_data(
    request: Request
):
    log_info("Sending data to server")
    task_id = None
    try:
        data = await request.json()
        task_id = str(uuid.uuid4())
        
        if not data or "blocks" not in data or "edges" not in data:
            log_warning("Invalid data received: missing blocks or edges")
            raise PuppyException(
                6210, 
                "Invalid Request Format",
                "Request data must contain 'blocks' and 'edges' fields"
            )
            
        blocks = data.get("blocks", {})
        edges = data.get("edges", {})
        
        if not blocks:
            log_warning("Invalid data: empty blocks")
            raise PuppyException(
                6211,
                "Empty Blocks",
                "The 'blocks' field cannot be empty"
            )
        
        log_info(f"Creating new task {task_id} with {len(blocks)} blocks and {len(edges)} edges")
        
        try:
            # 1. 在DataStore中存储数据副本
            log_info(f"Storing data copy in DataStore for task {task_id}")
            data_store.set_data(task_id, blocks, edges)
            
            # 2. 创建工作流并传入完整数据和任务ID
            # WorkFlow将维护自己的数据副本
            log_info(f"Creating workflow with its own data copy for task {task_id}")
            workflow = WorkFlow(data, task_id=task_id)
            
            # 3. 存储工作流对象引用
            data_store.set_workflow(task_id, workflow)
            
            # 4. 验证数据完整性
            stored_data = data_store.get_data(task_id)
            if not stored_data.get("blocks"):
                log_warning(f"Data validation failed for task {task_id}: Blocks were not stored correctly")
                raise PuppyException(6202, "Data validation failed", "Blocks were not stored correctly")
            
            log_info(f"Task {task_id} successfully created and workflow initialized")
            return JSONResponse(content={"task_id": task_id}, status_code=200)
            
        except Exception as e:
            log_error(f"Error during task creation {task_id}: {str(e)}")
            # 清理任何部分创建的数据
            if task_id:
                data_store.cleanup_task(task_id)
            raise
            
    except PuppyException as e:
        log_error(f"PuppyEngine error: {str(e)}")
        return JSONResponse(
            content={"error": str(e), "code": e.code, "message": e.message}, 
            status_code=400
        )
    except Exception as e:
        log_error(f"Unexpected error: {str(e)}")
        return JSONResponse(
            content={"error": f"Internal server error", "message": str(e)}, 
            status_code=500
        )

# 添加用于处理datetime等特殊类型的JSON序列化函数
def json_serializer(obj):
    """
    Custom JSON serializer for handling objects that default json encoder cannot process.
    
    Handles:
    - datetime and date objects -> ISO format string
    - objects with isoformat() method -> calls that method
    - pandas.Timestamp objects -> ISO format string
    - any other non-serializable objects -> string representation
    
    Args:
        obj: The object to serialize
        
    Returns:
        A JSON-serializable version of the object
    """
    from datetime import datetime, date
    import pandas as pd
    
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    if pd and hasattr(pd, 'Timestamp') and isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    # Handle other types that might not be JSON serializable
    return str(obj)

if __name__ == "__main__":
    try:
        # Use Hypercorn for ASGI server
        import asyncio
        import hypercorn.asyncio
        config = hypercorn.Config()
        config.bind = ["127.0.0.1:8001"]
        asyncio.run(hypercorn.asyncio.serve(app, config))
    except PuppyException as e:
        raise
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyException(6000, "Unexpected Error in Launching Server", str(e))

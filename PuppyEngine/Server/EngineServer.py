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
   - Workflow object assumes single-threaded access after task lock acquisition
   - State machine transitions protected by internal locks

Engineering Considerations:
--------------------------
- CPU cache effects may cause concurrent requests to execute in unpredictable order
- Lock acquisition before workflow processing prevents race conditions
- Timeout mechanisms could be added for long-running workflows
- Error responses are normalized to maintain consistent API contract

The server implements a straightforward synchronous workflow processor with concurrent
request handling capabilities through FastAPI's asynchronous model.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
import uuid
from threading import Lock
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from Server.WorkFlow import WorkFlow
from Server.JsonValidation import JsonValidator
from Utils.puppy_exception import PuppyException
from Utils.logger import log_info, log_error

class DataStore:
    def __init__(
        self
    ):
        self.data_store = defaultdict(lambda: {
            "blocks": {}, 
            "edges": {},
            "workflow": None,
            "cleanup_status": False,
            "processing_status": False  # 添加处理状态标记
        })
        self.lock = Lock()
        self.task_locks = {}  # 每个task_id的专用锁
        self.task_locks_lock = Lock()  # 保护task_locks字典的访问

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
        """获取工作流并检查处理状态"""
        with self.lock:
            task_data = self.data_store.get(task_id, {})
            if task_data.get("processing_status", False):
                # 返回None表示该工作流已在处理中
                return None
            
            workflow = task_data.get("workflow")
            if workflow:
                # 标记为处理中，防止重复处理
                task_data["processing_status"] = True
            return workflow

    def set_workflow(
        self,
        task_id: str,
        workflow: WorkFlow
    ) -> None:
        """Set workflow object for task"""
        with self.lock:
            self.data_store[task_id]["workflow"] = workflow

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

    def set_input(
        self,
        task_id: str,
        blocks: dict
    ) -> None:
        with self.lock:
            stored_blocks = self.data_store.get(task_id, {}).get("blocks", {})
            # Get existing input blocks
            input_blocks = {
                block_id: block
                for block_id, block in stored_blocks.items()
                if block.get("isInput")
            }
            input_block_ids = set(input_blocks.keys())

            # Verify incoming blocks match input blocks
            incoming_block_ids = set(blocks.keys())
            if incoming_block_ids != input_block_ids:
                raise PuppyException(
                    7302,
                    "Input Block Mismatch",
                    f"Incoming blocks {incoming_block_ids} do not match expected input blocks {input_block_ids}",
                )

            # Update only the input blocks while preserving other blocks
            for block_id, block in stored_blocks.items():
                if block_id in input_block_ids:
                    # Find and replace with the matching incoming block
                    new_block = blocks.get(block_id)
                    block.update(new_block)

    def update_data(
        self,
        task_id: str,
        blocks: dict
    ) -> None:
        with self.lock:
            block_map = self.data_store.get(task_id, {}).get("blocks", {})
            for new_block_id, new_block in blocks.items():
                if new_block_id in block_map:
                    block_map[new_block_id] = new_block

            # Update the blocks list
            self.data_store[task_id]["blocks"] = block_map

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
        """安全清理任务资源，防止重复清理"""
        with self.lock:
            # 1. 检查任务是否存在
            if task_id not in self.data_store:
                log_info(f"Task {task_id} not found or already cleaned up")
                return
            
            # 2. 检查任务是否有清理状态标记
            task_data = self.data_store[task_id]
            if task_data.get("_cleaning", False):
                log_info(f"Task {task_id} already being cleaned up")
                return
            
            # 3. 标记开始清理
            task_data["_cleaning"] = True
        
        # 4. 获取工作流对象并清理
        workflow = self.data_store[task_id].get("workflow")
        if workflow:
            try:
                log_info(f"Cleaning up workflow resources for task {task_id}")
                workflow.cleanup_resources()
            except Exception as e:
                log_error(f"Error cleaning up workflow: {str(e)}")
        
        # 5. 最后移除任务数据
        with self.lock:
            if task_id in self.data_store:
                del self.data_store[task_id]
        
        # 清理任务锁
        with self.task_locks_lock:
            if task_id in self.task_locks:
                del self.task_locks[task_id]

try:
    app = FastAPI()

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
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
        return JSONResponse(content={"status": "unhealthy", "error": str(e)}, status_code=500)

@app.get("/get_data/{task_id}")
async def get_data(
    task_id: str,
    wait: bool = True,  # 新参数：是否等待锁释放
    timeout: float = 60.0  # 新参数：等待超时时间(秒)
):
    try:
        # 尝试获取任务锁，根据wait参数决定是否阻塞等待
        if not data_store.acquire_task_lock(task_id, blocking=wait, timeout=timeout if wait else None):
            return JSONResponse(
                content={
                    "error": "Task already being processed", 
                    "code": 7304,
                    "message": f"Task {task_id} is currently being processed and wait timed out or was not requested"
                }, 
                status_code=409  # 冲突状态码
            )
        
        def stream_data():          
            try:
                # 获取工作流，如果返回None表示已在处理中
                workflow = data_store.get_workflow(task_id)
                if not workflow:
                    raise PuppyException(
                        7303,
                        "Workflow Not Found",
                        f"Workflow with task_id {task_id} not found"
                    )
                
                # 使用上下文管理器自动管理资源
                with workflow:
                    for yielded_blocks in workflow.process():
                        if not yielded_blocks:
                            continue
                        yield f"data: {json.dumps({'data': yielded_blocks, 'is_complete': False})}\n\n"
                    
                    yield f"data: {json.dumps({'is_complete': True})}\n\n"
                
            except Exception as e:
                log_error(f"Error during streaming: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
            finally:
                # 所有资源清理集中在finally中
                try:
                    data_store.cleanup_task(task_id)
                except Exception as e:
                    log_error(f"Error during task cleanup: {str(e)}")
                
                # 确保锁一定被释放
                data_store.release_task_lock(task_id)
        
        return StreamingResponse(stream_data(), media_type="text/event-stream")
    
    except Exception as e:
        # 确保在异常情况下也释放锁
        data_store.release_task_lock(task_id)
        log_error(f"Error Getting Data from Server: {str(e)}")
        raise PuppyException(6100, "Error Getting Data from Server", str(e))

@app.post("/send_data")
async def send_data(
    request: Request
):
    log_info("Sending data to server")
    try:
        data = await request.json()
        task_id = str(uuid.uuid4())
        if data and "blocks" in data and "edges" in data:
            blocks = data.get("blocks", {})
            edges = data.get("edges", {})
            data_store.set_data(task_id, blocks, edges)
            data_store.set_workflow(task_id, WorkFlow(data))  # Store workflow in DataStore
            log_info(f"Data sent to server for task {task_id}")
            return JSONResponse(content={"data": data, "task_id": task_id}, status_code=200)

        return JSONResponse(content={"error": "Exceptionally got invalid data"}, status_code=400)
    except PuppyException as e:
        log_error(f"Error Sending Data to Server: {str(e)}")
        raise PuppyException(6200, "Error Sending Data to Server", str(e))
    except Exception as e:
        log_error(f"Server Internal Error: {str(e)}")
        raise PuppyException(6300, "Server Internal Error", str(e))


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

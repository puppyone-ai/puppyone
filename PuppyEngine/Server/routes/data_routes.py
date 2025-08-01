"""
Data processing routes for Engine Server
"""

import json
import uuid
import time
import os
from typing import Optional

from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse

from Server.middleware.auth_middleware import authenticate_user, AuthenticationResult
from Server.middleware.usage_middleware import check_usage_limit, consume_usage_for_edge
from Server.utils.response_utils import (
    create_error_response, 
    create_success_response,
    create_usage_insufficient_response, 
    create_usage_service_error_response
)
from Server.utils.serializers import json_serializer, safe_json_serialize
from Server.WorkFlow import WorkFlow
from Server.usage_module import UsageError
from Server.dependencies import get_storage_client
from Utils.puppy_exception import PuppyException
from Utils.logger import log_info, log_error, log_warning, log_debug

# Create router instance
data_router = APIRouter()

@data_router.get("/get_data/{task_id}")
async def get_data(
    task_id: str,
    request: Request,
    wait: bool = True,  # 是否等待锁释放
    timeout: float = 60.0,  # 等待超时时间(秒)
    retry_attempts: int = 5,  # 重试次数
    retry_delay: float = 0.5,  # 每次重试间隔(秒)
    streaming_mode: bool = False,  # 是否使用流式处理模式
    auth_result: AuthenticationResult = Depends(authenticate_user),
    storage_client = Depends(get_storage_client)
):
    """
    Get data stream for a task.
    
    Args:
        task_id: Task identifier
        request: FastAPI request object
        wait: Whether to wait for lock release
        timeout: Wait timeout in seconds
        retry_attempts: Number of retry attempts
        retry_delay: Delay between retries in seconds
        auth_result: Authentication result from middleware
        
    Returns:
        StreamingResponse: Server-sent events stream
    """
    data_store = request.app.state.data_store
    try:
        # 尝试获取任务锁，根据wait参数决定是否阻塞等待
        if not data_store.acquire_task_lock(task_id, blocking=wait, timeout=timeout if wait else None):
            raise PuppyException(
                7304,
                "Task Lock Acquisition Failed",
                f"Task {task_id} is currently being processed and wait timed out or was not requested"
            )
        
        connection_id = f"{task_id}-{uuid.uuid4().hex[:8]}"
        log_info(f"Connection {connection_id}: Starting EventSource stream for task {task_id} (用户: {auth_result.user.user_id})")
        
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
                
                log_info(f"Connection {connection_id}: Workflow found, beginning processing (用户: {auth_result.user.user_id})")
                
                # 记录开始时间
                start_time = time.time()
                last_yield_time = start_time
                yield_count = 0
                total_runs_consumed = 0
                log_debug(f"Connection {connection_id}: Starting data streaming at {start_time}")
                
                # Check if streaming mode is enabled
                enable_streaming = streaming_mode or os.getenv("ENABLE_STREAMING_STORAGE", "false").lower() == "true"
                
                # 定义edge级别的usage消费回调
                async def edge_usage_callback(edge_metadata):
                    nonlocal total_runs_consumed
                    
                    try:
                        # 添加任务和连接信息到metadata
                        edge_metadata["task_id"] = task_id
                        edge_metadata["connection_id"] = connection_id
                        
                        # 使用中间件处理usage消费
                        await consume_usage_for_edge(auth_result, edge_metadata)
                        
                        if edge_metadata.get("execution_success", False):
                            total_runs_consumed += 1
                            log_debug(f"Connection {connection_id}: Usage consumed for successful edge {edge_metadata['edge_id']} ({edge_metadata['edge_type']})")
                        else:
                            log_warning(f"Connection {connection_id}: Edge execution failed, no usage consumed for edge {edge_metadata['edge_id']} ({edge_metadata['edge_type']}). Error: {edge_metadata.get('error_info', {}).get('error_message', 'Unknown error')}")
                            
                    except UsageError as ue:
                        log_error(f"Connection {connection_id}: Usage error during edge execution: {ue.message}")
                        # Usage不足，抛出异常中断整个workflow
                        raise ue
                    except Exception as ue:
                        log_error(f"Connection {connection_id}: Unexpected usage error: {str(ue)}")
                        # 意外的usage错误，继续执行但记录警告
                        log_warning(f"Connection {connection_id}: Continuing execution despite usage error")
                
                # 使用上下文管理器自动管理资源
                with workflow:
                    if enable_streaming and hasattr(workflow, 'process_streaming'):
                        # Use streaming mode
                        log_info(f"Connection {connection_id}: Using streaming mode")
                        
                        # Process with streaming signals
                        async for signal in workflow.process_streaming(storage_client, edge_usage_callback):
                            current_time = time.time()
                            yield_count += 1
                            
                            # Convert signal to SSE format
                            signal_data = {
                                'type': 'streaming_signal',
                                'signal': signal,
                                'is_complete': False,
                                'runs_consumed': total_runs_consumed
                            }
                            
                            # Special handling for batch_completed signals
                            if signal.get('type') == 'batch_completed':
                                signal_data['data'] = signal.get('outputs', {})
                            
                            json_data = safe_json_serialize(signal_data)
                            yield f"data: {json_data}\n\n"
                            
                            log_debug(f"Connection {connection_id}: Streaming signal #{yield_count}: {signal.get('type')}")
                    else:
                        # Use traditional processing mode
                        for yielded_blocks in workflow.process(edge_usage_callback):
                            if not yielded_blocks:
                                continue
                            
                            log_info(f"Connection {connection_id}: Yielding data block with {len(yielded_blocks)} blocks (total runs consumed: {total_runs_consumed})")
                            
                            # 记录 yield 前的时间
                            current_time = time.time()
                            time_since_last = current_time - last_yield_time
                            time_since_start = current_time - start_time
                            yield_count += 1
                            
                            log_debug(f"Connection {connection_id}: Yield #{yield_count} - Time since last yield: {time_since_last:.3f}s, Total time: {time_since_start:.3f}s")
                            
                            # 使用安全的JSON序列化函数处理大文本内容和特殊字符
                            json_data = safe_json_serialize({'data': yielded_blocks, 'is_complete': False, 'runs_consumed': total_runs_consumed})
                            yield f"data: {json_data}\n\n"
                            
                            # 更新最后一次 yield 的时间
                            last_yield_time = time.time()
                            yield_after_time = last_yield_time - current_time
                            log_debug(f"Connection {connection_id}: Yield #{yield_count} completed - Yield operation took: {yield_after_time:.3f}s")
                    
                    # 记录最终完成信号的时间
                    final_time = time.time()
                    time_since_last = final_time - last_yield_time
                    total_time = final_time - start_time
                    
                    log_info(f"Connection {connection_id}: Processing complete, sending completion signal (总计消费 {total_runs_consumed} runs)")
                    log_debug(f"Connection {connection_id}: Final completion signal - Time since last yield: {time_since_last:.3f}s, Total processing time: {total_time:.3f}s")
                    
                    final_data = safe_json_serialize({'is_complete': True, 'total_runs_consumed': total_runs_consumed, 'user_id': auth_result.user.user_id})
                    yield f"data: {final_data}\n\n"
                    
                    completion_after_time = time.time() - final_time
                    log_debug(f"Connection {connection_id}: Completion signal sent - Operation took: {completion_after_time:.3f}s, Total yields: {yield_count}")
                
            except Exception as e:
                log_error(f"Connection {connection_id}: Error during streaming: {str(e)}")
                error_data = safe_json_serialize({'error': str(e), 'message': 'Stream processing error'})
                yield f"data: {error_data}\n\n"
            finally:
                # 记录连接关闭
                log_info(f"Connection {connection_id}: Stream closing, marking task for delayed cleanup (用户: {auth_result.user.user_id})")
                
                # 所有资源清理集中在finally中
                try:
                    # 标记任务待清理，但不会立即删除
                    data_store.cleanup_task(task_id)
                except Exception as e:
                    log_error(f"Connection {connection_id}: Error during task cleanup: {str(e)}")
                
                # 确保锁一定被释放
                data_store.release_task_lock(task_id)
                log_info(f"Connection {connection_id}: Stream closed, task lock released")
        
        return StreamingResponse(
            stream_data(), 
            media_type="text/event-stream",
            headers={'X-Accel-Buffering': 'no'}
        )
    
    except Exception as e:
        # 确保在异常情况下也释放锁
        data_store.release_task_lock(task_id)
        return create_error_response(e, task_id)


@data_router.post("/send_data")
async def send_data(
    request: Request,
    auth_result: AuthenticationResult = Depends(authenticate_user),
    storage_client = Depends(get_storage_client)
):
    """
    Send data to create a new task.
    
    Args:
        request: FastAPI request object
        auth_result: Authentication result from middleware
        
    Returns:
        JSONResponse: Task creation result
    """
    log_info("Sending data to server")
    task_id = None
    data_store = request.app.state.data_store
    
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
        
        # Usage预检查
        try:
            estimated_runs = len(blocks)
            usage_check_result = await check_usage_limit(auth_result, estimated_runs)
            
        except UsageError as ue:
            return create_usage_insufficient_response(
                ue.message, 
                ue.available, 
                estimated_runs
            )
        except Exception as ue:
            return create_usage_service_error_response()
        
        log_info(f"Creating new task {task_id} with {len(blocks)} blocks and {len(edges)} edges (用户: {auth_result.user.user_id})")
        
        try:
            # 1. 在DataStore中存储数据副本
            log_info(f"Storing data copy in DataStore for task {task_id}")
            data_store.set_data(task_id, blocks, edges)
            
            # 2. 创建工作流并传入完整数据和任务ID
            # WorkFlow将维护自己的数据副本
            log_info(f"Creating workflow with its own data copy for task {task_id}")
            
            # Always pass storage client if available - WorkFlow will decide based on content size
            workflow = WorkFlow(
                data, 
                task_id=task_id,
                storage_client=storage_client
            )
            
            # 3. 存储工作流对象引用，并关联用户信息
            data_store.set_workflow(task_id, workflow)
            
            # 4. 在DataStore中记录用户信息
            if task_id in data_store.data_store:
                data_store.data_store[task_id]["user_id"] = auth_result.user.user_id
                data_store.data_store[task_id]["user_token"] = auth_result.user_token
            
            # 5. 验证数据完整性
            stored_data = data_store.get_data(task_id)
            if not stored_data.get("blocks"):
                log_warning(f"Data validation failed for task {task_id}: Blocks were not stored correctly")
                raise PuppyException(6202, "Data validation failed", "Blocks were not stored correctly")
            
            log_info(f"Task {task_id} successfully created and workflow initialized (用户: {auth_result.user.user_id})")
            return create_success_response({"task_id": task_id, "user_id": auth_result.user.user_id})
            
        except Exception as e:
            log_error(f"Error during task creation {task_id}: {str(e)}")
            # 清理任何部分创建的数据
            if task_id:
                data_store.cleanup_task(task_id)
            raise
            
    except Exception as e:
        return create_error_response(e, task_id) 
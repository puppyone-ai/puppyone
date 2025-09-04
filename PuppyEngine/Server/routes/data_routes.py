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
from Server.usage_module import UsageError
from Server.dependencies import get_storage_client
from Server.EnvManager import env_manager
from Utils.puppy_exception import PuppyException
from Utils.logger import log_info, log_error, log_warning, log_debug

# Create router instance
data_router = APIRouter()

@data_router.get("/get_data/{task_id}")
async def get_data(
    task_id: str,
    request: Request,
    auth_result: AuthenticationResult = Depends(authenticate_user),
    storage_client = Depends(get_storage_client)
):
    """
    Get data stream for a task using Server-Sent Events.
    
    Args:
        task_id: Task identifier
        request: FastAPI request object
        auth_result: Authentication result from middleware
        storage_client: Storage client (passed to env_manager if needed)
        
    Returns:
        StreamingResponse: Server-sent events stream with task results
    """
    connection_id = f"{task_id}-{uuid.uuid4().hex[:8]}"
    log_info(f"Connection {connection_id}: Starting EventSource stream for task {task_id} (用户: {auth_result.user.user_id})")
    
    try:
        # 准备用户信息用于权限验证
        user_info = {
            "user_id": auth_result.user.user_id,
            "user_token": auth_result.user_token
        }
        
        async def stream_data():          
            """从Orchestrator获取结果并流式传输给客户端"""
            try:
                log_info(f"Connection {connection_id}: Stream generator initialized")
                
                # 记录开始时间
                start_time = time.time()
                yield_count = 0
                
                # 从env_manager获取结果流
                async for result_batch in env_manager.get_results_stream(task_id, user_info):
                    current_time = time.time()
                    yield_count += 1
                    
                    # 检查是否是错误信息
                    if isinstance(result_batch, dict) and result_batch.get("__error__"):
                        log_error(f"Connection {connection_id}: Task failed with error: {result_batch.get('error')}")
                        error_data = safe_json_serialize({
                            'error': result_batch.get('error'),
                            'message': 'Task execution failed',
                            'is_complete': True
                        })
                        yield f"data: {error_data}\n\n"
                        break
                    
                    # 正常的结果批次
                    log_info(f"Connection {connection_id}: Yielding result batch #{yield_count} with {len(result_batch)} blocks")
                    
                    # 使用安全的JSON序列化函数处理大文本内容和特殊字符
                    json_data = safe_json_serialize({
                        'data': result_batch, 
                        'is_complete': False,
                        'yield_count': yield_count
                    })
                    yield f"data: {json_data}\n\n"
                
                # 发送完成信号
                total_time = time.time() - start_time
                log_info(f"Connection {connection_id}: Processing complete, sending completion signal")
                log_debug(f"Connection {connection_id}: Total processing time: {total_time:.3f}s, Total yields: {yield_count}")
                
                # 获取任务最终状态
                task_status = env_manager.get_task_status(task_id)
                
                final_data = safe_json_serialize({
                    'is_complete': True,
                    'user_id': auth_result.user.user_id,
                    'total_yields': yield_count,
                    'task_status': task_status
                })
                yield f"data: {final_data}\n\n"
                
            except ValueError as ve:
                # 处理权限错误或任务不存在
                log_error(f"Connection {connection_id}: Access error: {str(ve)}")
                error_data = safe_json_serialize({
                    'error': str(ve),
                    'message': 'Access denied or task not found',
                    'is_complete': True
                })
                yield f"data: {error_data}\n\n"
                
            except Exception as e:
                log_error(f"Connection {connection_id}: Error during streaming: {str(e)}")
                error_data = safe_json_serialize({
                    'error': str(e),
                    'message': 'Stream processing error',
                    'is_complete': True
                })
                yield f"data: {error_data}\n\n"
                
            finally:
                log_info(f"Connection {connection_id}: Stream closed")
        
        return StreamingResponse(
            stream_data(), 
            media_type="text/event-stream",
            headers={'X-Accel-Buffering': 'no'}
        )
    
    except Exception as e:
        return create_error_response(e, task_id)


@data_router.get("/task_status/{task_id}")
async def get_task_status(
    task_id: str,
    auth_result: AuthenticationResult = Depends(authenticate_user)
):
    """
    Get the current status of a task.
    
    Args:
        task_id: Task identifier
        auth_result: Authentication result from middleware
        
    Returns:
        JSONResponse: Task status information
    """
    try:
        # 准备用户信息用于权限验证
        user_info = {
            "user_id": auth_result.user.user_id,
            "user_token": auth_result.user_token
        }
        
        # 获取任务状态
        task_status = env_manager.get_task_status(task_id)
        
        if task_status is None:
            raise PuppyException(
                7303,
                "Task Not Found",
                f"Task {task_id} not found"
            )
        
        # 简单的权限检查（可以根据需要增强）
        # 注意：这里我们需要从env_manager获取任务的用户信息
        # 暂时跳过权限检查，因为get_task_status不返回用户信息
        
        log_info(f"Task status retrieved for {task_id} by user {auth_result.user.user_id}")
        
        return create_success_response(task_status)
        
    except Exception as e:
        return create_error_response(e, task_id)


@data_router.post("/send_data")
async def send_data(
    request: Request,
    auth_result: AuthenticationResult = Depends(authenticate_user),
    storage_client = Depends(get_storage_client)
):
    """
    Send data to create a new task (async, non-blocking).
    
    Args:
        request: FastAPI request object
        auth_result: Authentication result from middleware
        storage_client: Storage client for external storage
        
    Returns:
        JSONResponse: Task creation result with task_id (202 Accepted)
    """
    log_info("Receiving workflow submission request")
    
    try:
        data = await request.json()
        
        # 基本验证
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
        
        # Usage预检查：runs ≈ 预计会执行的基础 edges 数（包含 llm）
        try:
            estimated_runs = len(edges) or 1
            usage_check_result = await check_usage_limit(auth_result, estimated_runs)
            
        except UsageError as ue:
            return create_usage_insufficient_response(
                ue.message, 
                ue.available, 
                estimated_runs
            )
        except Exception as ue:
            return create_usage_service_error_response()
        
        log_info(f"Submitting workflow with {len(blocks)} blocks and {len(edges)} edges (用户: {auth_result.user.user_id})")
        
        # 准备用户信息
        user_info = {
            "user_id": auth_result.user.user_id,
            "user_token": auth_result.user_token
        }
        
        # 设置storage client到env_manager
        env_manager.set_storage_client(storage_client)
        
        # 创建edge usage callback
        async def edge_usage_callback(edge_metadata):
            """处理每个edge的usage消费"""
            try:
                # 使用中间件处理usage消费
                await consume_usage_for_edge(auth_result, edge_metadata)
                
                if edge_metadata.get("execution_success", False):
                    log_debug(f"Usage consumed for successful edge {edge_metadata['edge_id']} ({edge_metadata['edge_type']})")
                else:
                    log_warning(f"Edge execution failed, no usage consumed for edge {edge_metadata['edge_id']} ({edge_metadata['edge_type']})")
                    
            except UsageError as ue:
                log_error(f"Usage error during edge execution: {ue.message}")
                # Usage不足，抛出异常中断整个workflow
                raise ue
            except Exception as ue:
                log_error(f"Unexpected usage error: {str(ue)}")
                # 意外的usage错误，继续执行但记录警告
                log_warning(f"Continuing execution despite usage error")
        
        # 提交工作流到env_manager，立即返回task_id
        task_id = await env_manager.submit_workflow(data, user_info, edge_usage_callback)
        
        log_info(f"Workflow submitted successfully with task_id: {task_id} (用户: {auth_result.user.user_id})")
        
        # 返回202 Accepted，表示请求已接受但还在处理中
        return create_success_response(
            {"task_id": task_id, "user_id": auth_result.user.user_id}, 
            status_code=202
        )
            
    except Exception as e:
        return create_error_response(e, None) 
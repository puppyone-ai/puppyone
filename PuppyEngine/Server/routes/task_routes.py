"""
Task API routes (v2) - Event-driven workflow execution
"""

import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import StreamingResponse

from Server.middleware.auth_middleware import authenticate_user, AuthenticationResult
from Server.middleware.usage_middleware import check_usage_limit, consume_usage_for_edge
from Server.utils.response_utils import (
    create_error_response, 
    create_success_response,
    create_usage_insufficient_response, 
    create_usage_service_error_response
)
from Server.utils.serializers import safe_json_serialize
from Server.usage_module import UsageError
from Server.dependencies import get_storage_client
from Server.EnvManager import env_manager
from Utils.puppy_exception import PuppyException
from Utils.logger import log_info, log_error, log_warning, log_debug

# Create router instance with prefix
task_router = APIRouter(prefix="/task", tags=["Task API (v2)"])

@task_router.post("")
async def create_task(
    request: Request,
    auth_result: AuthenticationResult = Depends(authenticate_user),
    storage_client = Depends(get_storage_client)
):
    """
    Create a new task by submitting a workflow definition.
    
    This is the v2 equivalent of /send_data, providing a cleaner API
    and returning more structured response.
    
    Args:
        request: FastAPI request object containing workflow JSON
        auth_result: Authentication result from middleware
        storage_client: Storage client for external storage
        
    Returns:
        JSONResponse: Task creation result with task_id and initial metadata
    """
    log_info(f"[v2] Creating new task for user: {auth_result.user.user_id}")
    
    try:
        # Parse workflow data
        workflow_data = await request.json()
        
        # Validate workflow structure
        if not workflow_data or "blocks" not in workflow_data or "edges" not in workflow_data:
            raise PuppyException(
                6210, 
                "Invalid Workflow Format",
                "Workflow must contain 'blocks' and 'edges' fields"
            )
            
        blocks = workflow_data.get("blocks", {})
        edges = workflow_data.get("edges", {})
        
        if not blocks:
            raise PuppyException(
                6211,
                "Empty Blocks",
                "The 'blocks' field cannot be empty"
            )
        
        # Check usage limits: runs ≈ 预计会执行的基础 edges 数（包含 llm）
        try:
            estimated_runs = len(edges) or 1
            usage_check_result = await check_usage_limit(auth_result, estimated_runs)
        except UsageError as ue:
            return create_usage_insufficient_response(
                ue.message, 
                ue.available, 
                estimated_runs
            )
        except Exception:
            return create_usage_service_error_response()
        
        log_info(f"[v2] Submitting workflow with {len(blocks)} blocks and {len(edges)} edges")
        
        # Prepare user info
        user_info = {
            "user_id": auth_result.user.user_id,
            "user_token": auth_result.user_token
        }
        
        # Set storage client
        env_manager.set_storage_client(storage_client)
        
        # Create edge usage callback
        async def edge_usage_callback(edge_metadata):
            """Handle usage consumption for each edge"""
            try:
                await consume_usage_for_edge(auth_result, edge_metadata)
                
                if edge_metadata.get("execution_success", False):
                    log_debug(f"[v2] Usage consumed for edge {edge_metadata['edge_id']}")
                else:
                    log_warning(f"[v2] Edge failed, no usage consumed for {edge_metadata['edge_id']}")
                    
            except UsageError as ue:
                log_error(f"[v2] Usage error: {ue.message}")
                raise ue
            except Exception as e:
                log_error(f"[v2] Unexpected usage error: {str(e)}")
                log_warning(f"[v2] Continuing despite usage error")
        
        # Submit workflow
        task_id = await env_manager.submit_workflow(workflow_data, user_info, edge_usage_callback)
        
        log_info(f"[v2] Task created successfully: {task_id}")
        
        # Return structured response
        return create_success_response(
            {
                "task_id": task_id,
                "created_at": datetime.utcnow().isoformat(),
                "blocks_count": len(blocks),
                "edges_count": len(edges),
                "estimated_usage": estimated_runs
            }, 
            status_code=202  # Accepted
        )
            
    except Exception as e:
        return create_error_response(e, None)


@task_router.get("/{task_id}/stream")
async def stream_task_events(
    task_id: str,
    request: Request,
    auth_result: AuthenticationResult = Depends(authenticate_user)
):
    """
    Get a real-time event stream for a task.
    
    This endpoint provides detailed execution events using Server-Sent Events (SSE).
    Events include task lifecycle, edge execution, block updates, and errors.
    
    Args:
        task_id: Task identifier
        request: FastAPI request object
        auth_result: Authentication result from middleware
        
    Returns:
        StreamingResponse: Server-sent events stream with detailed task events
    """
    connection_id = f"{task_id}-{uuid.uuid4().hex[:8]}"
    log_info(f"[v2] Starting event stream {connection_id} for task {task_id} (user: {auth_result.user.user_id})")
    
    try:
        # Prepare user info for authorization
        user_info = {
            "user_id": auth_result.user.user_id,
            "user_token": auth_result.user_token
        }
        
        async def event_generator():
            """Generate SSE events from task execution"""
            try:
                log_info(f"[v2] Event generator started for {connection_id}")
                
                # Get raw events from EnvManager
                event_count = 0
                async for event in env_manager.get_raw_events_stream(task_id, user_info):
                    event_count += 1
                    
                    # Add consistent timestamp if not present
                    if "timestamp" not in event:
                        event["timestamp"] = datetime.utcnow().isoformat()
                    
                    # Add task_id to all events
                    event["task_id"] = task_id
                    
                    # Log significant events
                    event_type = event.get("event_type", "UNKNOWN")
                    if event_type in ["TASK_STARTED", "TASK_COMPLETED", "TASK_FAILED"]:
                        log_info(f"[v2] {connection_id}: {event_type}")
                    elif event_type == "EDGE_ERROR":
                        log_error(f"[v2] {connection_id}: Edge error - {event.get('data', {}).get('error_message', 'Unknown error')}")
                    
                    # Format as SSE
                    event_data = safe_json_serialize(event)
                    yield f"data: {event_data}\n\n"
                    
                    # Check for terminal events
                    if event_type in ["TASK_COMPLETED", "TASK_FAILED"]:
                        log_info(f"[v2] {connection_id}: Stream complete after {event_count} events")
                        break
                
            except ValueError as ve:
                # Access denied or task not found
                log_error(f"[v2] {connection_id}: Access error - {str(ve)}")
                error_event = {
                    "event_type": "ERROR",
                    "task_id": task_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "data": {
                        "error_code": "ACCESS_DENIED",
                        "error_message": str(ve)
                    }
                }
                yield f"data: {safe_json_serialize(error_event)}\n\n"
                
            except Exception as e:
                log_error(f"[v2] {connection_id}: Stream error - {str(e)}")
                error_event = {
                    "event_type": "ERROR",
                    "task_id": task_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "data": {
                        "error_code": "STREAM_ERROR",
                        "error_message": str(e)
                    }
                }
                yield f"data: {safe_json_serialize(error_event)}\n\n"
                
            finally:
                log_info(f"[v2] {connection_id}: Event stream closed")
        
        return StreamingResponse(
            event_generator(), 
            media_type="text/event-stream",
            headers={
                'X-Accel-Buffering': 'no',  # Disable nginx buffering
                'Cache-Control': 'no-cache',  # Prevent caching
                'Connection': 'keep-alive'    # Keep connection alive
            }
        )
    
    except Exception as e:
        return create_error_response(e, task_id)


@task_router.get("/{task_id}/status")
async def get_task_status(
    task_id: str,
    auth_result: AuthenticationResult = Depends(authenticate_user)
):
    """
    Get the current status of a task.
    
    This endpoint provides a snapshot of the task's current state,
    useful for polling or checking status after stream disconnection.
    
    Args:
        task_id: Task identifier
        auth_result: Authentication result from middleware
        
    Returns:
        JSONResponse: Task status information
    """
    try:
        # Get task status from EnvManager
        task_status = env_manager.get_task_status(task_id)
        
        if task_status is None:
            raise PuppyException(
                7303,
                "Task Not Found",
                f"Task {task_id} not found"
            )
        
        # TODO: Add proper authorization check once EnvManager returns user info
        # For now, we'll return the status (similar to v1 behavior)
        
        log_info(f"[v2] Task status retrieved for {task_id} by user {auth_result.user.user_id}")
        
        # Enhance status with additional v2 information
        enhanced_status = {
            **task_status,
            "api_version": "v2",
            "retrieved_at": datetime.utcnow().isoformat()
        }
        
        return create_success_response(enhanced_status)
        
    except Exception as e:
        return create_error_response(e, task_id)
"""
Response utilities for the Engine Server
"""

from fastapi.responses import JSONResponse
from Server.auth_module import AuthenticationError
from Server.usage_module import UsageError
from Utils.puppy_exception import PuppyException
from Utils.logger import log_error
from fastapi import HTTPException

def create_error_response(error, task_id=None):
    """
    Create a standardized error response based on the error type.
    
    Args:
        error: The exception that occurred
        task_id: Optional task ID for context
        
    Returns:
        JSONResponse: Standardized error response
    """
    if isinstance(error, AuthenticationError):
        log_error(f"Authentication error{f' for task {task_id}' if task_id else ''}: {error.message}")
        return JSONResponse(
            content={"error": error.message, "code": "AUTH_ERROR"}, 
            status_code=error.status_code
        )
    elif isinstance(error, HTTPException):
        log_error(f"HTTP error{f' for task {task_id}' if task_id else ''}: {error.detail}")
        return JSONResponse(
            content={"error": error.detail, "code": "HTTP_ERROR"}, 
            status_code=error.status_code
        )
    elif isinstance(error, UsageError):
        log_error(f"Usage error{f' for task {task_id}' if task_id else ''}: {error.message}")
        return JSONResponse(
            content={"error": error.message, "code": "USAGE_ERROR", "available": error.available}, 
            status_code=error.status_code
        )
    elif isinstance(error, PuppyException):
        log_error(f"PuppyEngine error{f' for task {task_id}' if task_id else ''}: {str(error)}")
        status_code = 409 if error.code == 7304 else 400
        return JSONResponse(
            content={"error": str(error), "code": error.code, "message": error.message}, 
            status_code=status_code
        )
    else:
        log_error(f"Unexpected error{f' for task {task_id}' if task_id else ''}: {str(error)}")
        return JSONResponse(
            content={"error": "Internal server error", "message": str(error)},
            status_code=500
        )

def create_success_response(data, status_code=200):
    """
    Create a standardized success response.
    
    Args:
        data: The data to return
        status_code: HTTP status code (default 200)
        
    Returns:
        JSONResponse: Standardized success response
    """
    return JSONResponse(content=data, status_code=status_code)

def create_usage_insufficient_response(error_message, available, estimated_required):
    """
    Create a specialized response for usage insufficient errors.
    
    Args:
        error_message: The error message
        available: Available usage amount
        estimated_required: Estimated required usage
        
    Returns:
        JSONResponse: Specialized usage error response
    """
    log_error(f"Usage预检查失败: {error_message}")
    return JSONResponse(
        content={
            "error": error_message, 
            "code": "USAGE_INSUFFICIENT", 
            "available": available,
            "estimated_required": estimated_required
        }, 
        status_code=429
    )

def create_usage_service_error_response():
    """
    Create a response for usage service errors.
    
    Returns:
        JSONResponse: Usage service error response
    """
    log_error("Usage预检查发生未预期错误")
    return JSONResponse(
        content={"error": "Usage服务错误", "code": "USAGE_SERVICE_ERROR"}, 
        status_code=503
    ) 
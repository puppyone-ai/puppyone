"""
Dependency injection functions for PuppyEngine

This module provides FastAPI dependency functions that can be used
to inject common services and resources into route handlers.
"""

import os
from fastapi import Depends, Request
from Server.middleware.auth_middleware import authenticate_user, AuthenticationResult
from clients.storage_client import StorageClient
from Utils.logger import log_info, log_error


def get_storage_client(
    request: Request,
    auth_result: AuthenticationResult = Depends(authenticate_user)
) -> StorageClient:
    """
    Get a request-scoped StorageClient instance
    
    This dependency:
    - Uses the shared httpx client from app state
    - Extracts JWT token from authentication result
    - Creates a configured StorageClient for the request
    
    Args:
        request: FastAPI request object
        auth_result: Authentication result from middleware
        
    Returns:
        StorageClient: Configured storage client instance
        
    Raises:
        Exception: If httpx_client is not available in app state
    """
    # Get shared httpx client from app state
    if not hasattr(request.app.state, 'httpx_client'):
        log_error("httpx_client not found in app state - check server initialization")
        raise Exception("Storage client not available - server misconfiguration")
    
    httpx_client = request.app.state.httpx_client
    jwt_token = auth_result.user_token
    
    # Get storage server URL from environment
    storage_server_url = os.getenv("STORAGE_SERVER_URL", "http://localhost:8002")
    
    log_info(f"Creating StorageClient for user {auth_result.user.user_id}")
    
    return StorageClient(
        httpx_client=httpx_client,
        jwt_token=jwt_token,
        storage_server_url=storage_server_url
    )
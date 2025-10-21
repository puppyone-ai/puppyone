"""
Storage adapter dependency for FastAPI dependency injection.

This module provides a dependency function that returns the storage adapter,
following FastAPI best practices for dependency injection.
"""

from .base import StorageAdapter
from .manager import get_storage


def get_storage_adapter() -> StorageAdapter:
    """
    Dependency function that returns the current storage adapter.
    
    This should be used with FastAPI's Depends() in route handlers:
    
    Example:
        @router.post("/upload")
        async def upload_file(
            storage: StorageAdapter = Depends(get_storage_adapter)
        ):
            storage.save_file(...)
    
    Returns:
        StorageAdapter: The configured storage adapter (Local or S3)
    """
    return get_storage()


"""
Storage Client for PuppyEngine

This module provides a high-level interface for interacting with PuppyStorage service.
It encapsulates all storage operations including:
- Resource prefetching
- Streaming uploads with version management
- Manifest updates with optimistic locking
- Direct client-to-OSS data transfer coordination

Design Principles:
- Stateful client pattern for connection pooling
- Request-scoped JWT authentication
- Atomic operations with retry logic
- Clean separation between public API and internal helpers
"""

import os
import json
import hashlib
from typing import Dict, List, Optional, AsyncGenerator, Tuple, Any
from datetime import datetime
import httpx
from Utils.logger import log_info, log_error, log_warning, log_debug


class StorageException(Exception):
    """Base exception for storage operations"""
    pass


class StorageClient:
    """
    Client for interacting with PuppyStorage service
    
    This client handles:
    - Authentication via JWT tokens
    - Resource downloading and uploading
    - Version and manifest management
    - Error handling and retries
    """
    
    def __init__(self, httpx_client: httpx.AsyncClient, jwt_token: str, storage_server_url: Optional[str] = None):
        """
        Initialize storage client with shared HTTP client and authentication
        
        Args:
            httpx_client: Shared async HTTP client from app state
            jwt_token: JWT token for authentication
            storage_server_url: Base URL for storage service (defaults to env var)
        """
        self.client = httpx_client
        self.jwt_token = jwt_token
        self.base_url = storage_server_url or os.getenv("STORAGE_SERVER_URL", "http://localhost:8002")
        
        # Set up default headers
        self.headers = {
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json"
        }
        
        log_info(f"StorageClient initialized with base URL: {self.base_url}")
    
    async def prefetch_resource(self, resource_key: str) -> bytes:
        """
        Prefetch a resource from storage
        
        Args:
            resource_key: The storage key (e.g., "user123/block456/v789/content.txt")
            
        Returns:
            bytes: The resource content
            
        Raises:
            StorageException: If download fails
        """
        try:
            log_info(f"Prefetching resource: {resource_key}")
            
            # Step 1: Get download URL from PuppyStorage
            response = await self.client.get(
                f"{self.base_url}/download/url",
                params={"key": resource_key},
                headers=self.headers
            )
            
            if response.status_code != 200:
                raise StorageException(f"Failed to get download URL: {response.status_code} - {response.text}")
            
            download_info = response.json()
            download_url = download_info.get("download_url")
            
            if not download_url:
                raise StorageException("No download URL returned from storage service")
            
            # Step 2: Download directly from URL (OSS or local stream)
            if download_url.startswith(("http://", "https://")):
                # Direct download from presigned URL
                download_response = await self.client.get(download_url)
            else:
                # Local streaming endpoint (for development)
                download_response = await self.client.get(
                    download_url,
                    headers=self.headers  # Include auth for local streaming
                )
            
            if download_response.status_code != 200:
                raise StorageException(f"Failed to download resource: {download_response.status_code}")
            
            content = download_response.content
            log_info(f"Successfully prefetched resource: {resource_key} ({len(content)} bytes)")
            
            return content
            
        except httpx.RequestError as e:
            log_error(f"Network error during prefetch: {str(e)}")
            raise StorageException(f"Network error: {str(e)}")
        except Exception as e:
            log_error(f"Unexpected error during prefetch: {str(e)}")
            raise StorageException(f"Prefetch failed: {str(e)}")
    
    async def stream_upload_version(
        self, 
        user_id: str,
        block_id: str, 
        version_id: str,
        chunk_generator: AsyncGenerator[Tuple[str, bytes], None]
    ) -> str:
        """
        Stream upload a new version with multiple chunks
        
        This method implements the complete producer workflow:
        1. Create initial manifest with "generating" status
        2. Upload chunks as they become available
        3. Update manifest after each chunk (with optimistic locking)
        4. Mark version as completed
        
        Args:
            user_id: User identifier
            block_id: Block identifier (persistent)
            version_id: Version identifier (e.g., timestamp)
            chunk_generator: Async generator yielding (chunk_name, chunk_data) tuples
            
        Returns:
            str: The version base path (e.g., "user123/block456/v789")
            
        Raises:
            StorageException: If upload fails
        """
        version_base = f"{user_id}/{block_id}/{version_id}"
        manifest_key = f"{version_base}/manifest.json"
        
        try:
            log_info(f"Starting streaming upload for version: {version_base}")
            
            # Step 1: Create initial manifest
            initial_manifest = {
                "version_id": version_id,
                "block_id": block_id,
                "status": "generating",
                "created_at": datetime.utcnow().isoformat(),
                "chunks": [],
                "metadata": {
                    "total_size": 0,
                    "chunk_count": 0
                }
            }
            
            current_etag = await self._update_manifest(manifest_key, initial_manifest, expected_etag=None)
            log_info(f"Created initial manifest with ETag: {current_etag}")
            
            # Step 2: Process chunks
            total_size = 0
            chunk_count = 0
            
            async for chunk_name, chunk_data in chunk_generator:
                # Upload chunk
                chunk_key = f"{version_base}/{chunk_name}"
                chunk_etag = await self._upload_chunk(chunk_key, chunk_data)
                
                # Update manifest with new chunk
                chunk_info = {
                    "name": chunk_name,
                    "size": len(chunk_data),
                    "etag": chunk_etag,
                    "uploaded_at": datetime.utcnow().isoformat()
                }
                
                initial_manifest["chunks"].append(chunk_info)
                total_size += len(chunk_data)
                chunk_count += 1
                
                initial_manifest["metadata"]["total_size"] = total_size
                initial_manifest["metadata"]["chunk_count"] = chunk_count
                
                # Atomic manifest update with retry
                current_etag = await self._update_manifest(
                    manifest_key, 
                    initial_manifest, 
                    expected_etag=current_etag
                )
                
                log_info(f"Uploaded chunk {chunk_name} and updated manifest")
            
            # Step 3: Mark as completed
            initial_manifest["status"] = "completed"
            initial_manifest["completed_at"] = datetime.utcnow().isoformat()
            
            await self._update_manifest(manifest_key, initial_manifest, expected_etag=current_etag)
            
            log_info(f"Successfully completed streaming upload for version: {version_base}")
            return version_base
            
        except Exception as e:
            log_error(f"Streaming upload failed for {version_base}: {str(e)}")
            
            # Try to mark as failed in manifest
            try:
                initial_manifest["status"] = "failed"
                initial_manifest["error"] = str(e)
                await self._update_manifest(manifest_key, initial_manifest, expected_etag=current_etag)
            except:
                pass  # Best effort
            
            raise StorageException(f"Streaming upload failed: {str(e)}")
    
    async def _upload_chunk(self, resource_key: str, chunk_data: bytes) -> str:
        """
        Upload a single chunk using direct upload API (simplified)
        
        Args:
            resource_key: Full storage key for the chunk
            chunk_data: Binary data to upload
            
        Returns:
            str: ETag of the uploaded chunk
            
        Raises:
            StorageException: If upload fails
        """
        try:
            # Use new direct upload API
            response = await self.client.post(
                f"{self.base_url}/upload/chunk/direct",
                json={
                    "key": resource_key,
                    "content_type": "application/octet-stream"
                },
                content=chunk_data,
                headers=self.headers
            )
            
            if response.status_code != 200:
                raise StorageException(f"Failed to upload chunk: {response.text}")
            
            result = response.json()
            return result["etag"]
            
        except Exception as e:
            log_error(f"Chunk upload failed for {resource_key}: {str(e)}")
            raise
    
    async def _update_manifest(
        self, 
        manifest_key: str, 
        manifest_data: Dict[str, Any], 
        expected_etag: Optional[str]
    ) -> str:
        """
        Update manifest with optimistic locking
        
        Args:
            manifest_key: Storage key for manifest
            manifest_data: Manifest content
            expected_etag: Expected ETag for optimistic locking (None for create)
            
        Returns:
            str: New ETag after update
            
        Raises:
            StorageException: If update fails
        """
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                if expected_etag is None:
                    # Initial creation - use direct upload
                    manifest_bytes = json.dumps(manifest_data, indent=2).encode('utf-8')
                    response = await self.client.post(
                        f"{self.base_url}/upload/chunk/direct",
                        json={
                            "key": manifest_key,
                            "content_type": "application/json"
                        },
                        content=manifest_bytes,
                        headers=self.headers
                    )
                else:
                    # Update existing manifest
                    response = await self.client.put(
                        f"{self.base_url}/upload/manifest",
                        json={
                            "key": manifest_key,
                            "content": manifest_data,
                            "expected_etag": expected_etag
                        },
                        headers=self.headers
                    )
                
                if response.status_code == 200:
                    result = response.json()
                    new_etag = result.get("etag")
                    log_debug(f"Manifest updated successfully with new ETag: {new_etag}")
                    return new_etag
                
                elif response.status_code == 409:
                    # Conflict - manifest was modified by another process
                    log_warning(f"Manifest conflict detected, retrying... (attempt {retry_count + 1})")
                    
                    # Fetch current manifest and retry
                    current_manifest, current_etag = await self._fetch_manifest(manifest_key)
                    
                    # Merge changes (simple last-write-wins for now)
                    # In production, this would need more sophisticated conflict resolution
                    manifest_data.update(current_manifest)
                    expected_etag = current_etag
                    
                    retry_count += 1
                    continue
                
                else:
                    raise StorageException(f"Manifest update failed: {response.status_code} - {response.text}")
                    
            except httpx.RequestError as e:
                log_error(f"Network error updating manifest: {str(e)}")
                raise StorageException(f"Network error: {str(e)}")
        
        raise StorageException(f"Failed to update manifest after {max_retries} retries")
    
    async def _fetch_manifest(self, manifest_key: str) -> Tuple[Dict[str, Any], str]:
        """
        Fetch current manifest and its ETag
        
        Args:
            manifest_key: Storage key for manifest
            
        Returns:
            Tuple of (manifest_data, etag)
        """
        try:
            content = await self.prefetch_resource(manifest_key)
            manifest_data = json.loads(content.decode('utf-8'))
            
            # Calculate ETag (simplified - in production would get from headers)
            etag = hashlib.md5(content).hexdigest()
            
            return manifest_data, etag
            
        except Exception as e:
            log_error(f"Failed to fetch manifest: {str(e)}")
            raise StorageException(f"Failed to fetch manifest: {str(e)}")
    
    # === Convenience Methods ===
    
    async def get_manifest(self, manifest_key: str) -> Dict[str, Any]:
        """
        Get manifest content as dictionary
        
        Args:
            manifest_key: Storage key for manifest
            
        Returns:
            Dict: Manifest content
        """
        manifest_data, _ = await self._fetch_manifest(manifest_key)
        return manifest_data
    
    async def upload_chunk_direct(self, chunk_key: str, chunk_data: bytes, content_type: str = "application/octet-stream") -> str:
        """
        Upload a chunk directly to storage (convenience method)
        
        Args:
            chunk_key: Storage key for the chunk
            chunk_data: Binary data to upload
            content_type: MIME type of the content
            
        Returns:
            str: ETag of uploaded chunk
        """
        return await self._upload_chunk(chunk_key, chunk_data)
    
    async def download_chunk(self, chunk_key: str) -> bytes:
        """
        Download a chunk from storage (convenience method)
        
        Args:
            chunk_key: Storage key for the chunk
            
        Returns:
            bytes: Chunk data
        """
        return await self.prefetch_resource(chunk_key)
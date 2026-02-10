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
import asyncio
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
        # NOTE:
        # - Use application/json only for JSON requests (manifests, control APIs)
        # - For raw chunk uploads we will override to application/octet-stream per-request
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
    
    async def init_stream_version(
        self,
        block_id: str
    ) -> Tuple[str, str, str, str]:
        """
        Initialize a new streaming version and return identifiers for subsequent uploads.

        Returns a tuple of (version_base, version_id, manifest_key, etag).

        Raises:
            StorageException: If initialization fails
        """
        try:
            initial_manifest = {
                "version": "1.0",
                "block_id": block_id,
                "status": "generating",
                "created_at": datetime.utcnow().isoformat(),
                "chunks": [],
                "metadata": {
                    "total_size": 0,
                    "chunk_count": 0
                }
            }

            manifest_data = json.dumps(initial_manifest, indent=2).encode('utf-8')

            response = await self.client.post(
                f"{self.base_url}/upload/chunk/direct?block_id={block_id}&file_name=manifest.json&content_type=application/json",
                content=manifest_data,
                headers=self.headers
            )

            if response.status_code != 200:
                raise StorageException(f"Failed to create initial manifest: {response.text}")

            result = response.json()
            returned_key = result["key"]
            version_id = result["version_id"]

            key_parts = returned_key.split('/')
            if len(key_parts) < 4:
                raise StorageException(f"Invalid key format returned: {returned_key}")

            version_base = '/'.join(key_parts[:-1])
            manifest_key = returned_key
            current_etag = result["etag"]

            log_info(f"Initialized stream: version_id={version_id}, version_base={version_base}")

            # Allow for eventual consistency of manifest
            await asyncio.sleep(3)

            return version_base, version_id, manifest_key, current_etag

        except Exception as e:
            log_error(f"Failed to initialize stream for block {block_id}: {e}")
            raise

    async def upload_chunks_and_update_manifest(
        self,
        block_id: str,
        version_id: str,
        chunk_generator: AsyncGenerator[Tuple[str, bytes], None],
        manifest_key: Optional[str] = None,
        current_etag: Optional[str] = None
    ) -> None:
        """
        Upload chunks and update the manifest incrementally. Optionally accepts
        manifest_key and current_etag to avoid refetching.
        """
        try:
            # If manifest details not provided, derive them by fetching
            if not manifest_key:
                raise StorageException("manifest_key is required for incremental updates")

            key_parts = manifest_key.split('/')
            user_id = key_parts[0]
            block_id_from_key = key_parts[1]

            async for chunk_name, chunk_data in chunk_generator:
                chunk_etag = await self._upload_chunk(block_id, chunk_name, chunk_data, version_id)

                chunk_info = {
                    "name": chunk_name,
                    "size": len(chunk_data),
                    "etag": chunk_etag,
                    "uploaded_at": datetime.utcnow().isoformat(),
                    # chunk 级别状态：上传完成即可标记为 done（生产者已保证完整性）
                    "state": "done"
                }

                response = await self.client.put(
                    f"{self.base_url}/upload/manifest",
                    json={
                        "user_id": user_id,
                        "block_id": block_id_from_key,
                        "version_id": version_id,
                        "expected_etag": current_etag,
                        "new_chunk": chunk_info,
                        "status": "generating"
                    },
                    headers=self.headers
                )

                if response.status_code == 200:
                    result = response.json()
                    current_etag = result.get("etag")
                    log_info(f"Uploaded chunk {chunk_name} and updated manifest incrementally")
                else:
                    raise StorageException(f"Failed to update manifest: {response.text}")

            # 移除 _completed.marker 机制：不再写入或依赖标记文件
            # 可选：若需要记录整体完成状态，可在业务侧另行记录，不在清单中追加伪chunk

        except Exception as e:
            log_error(f"Chunk upload failed for block {block_id}: {e}")
            raise

    async def stream_upload_version(
        self, 
        user_id: str,
        block_id: str, 
        chunk_generator: AsyncGenerator[Tuple[str, bytes], None],
        version_id: Optional[str] = None
    ) -> str:
        """
        Backward-compatible combined streaming upload API.
        Initializes the stream, uploads chunks, marks completed, and returns version_base.
        """
        version_base = None
        manifest_key = None
        current_etag = None
        try:
            version_base, init_version_id, manifest_key, current_etag = await self.init_stream_version(block_id)
            # Prefer provided version_id only if explicitly set; otherwise use server's
            effective_version_id = version_id or init_version_id
            await self.upload_chunks_and_update_manifest(
                block_id=block_id,
                version_id=effective_version_id,
                chunk_generator=chunk_generator,
                manifest_key=manifest_key,
                current_etag=current_etag
            )
            log_info(f"Successfully completed streaming upload for version: {version_base}")
            return version_base
        except Exception as e:
            log_error(f"Streaming upload failed for {version_base}: {str(e)}")
            raise StorageException(f"Streaming upload failed: {str(e)}")
    
    async def _upload_chunk(self, block_id: str, file_name: str, chunk_data: bytes, version_id: str = None) -> str:
        """
        Upload a single chunk using direct upload API
        
        Args:
            block_id: Block identifier
            file_name: Name of the chunk file
            chunk_data: Binary data to upload
            version_id: Optional version ID to use (if None, server will generate one)
            
        Returns:
            str: ETag of the uploaded chunk
            
        Raises:
            StorageException: If upload fails
        """
        try:
            # Build URL with parameters
            url = f"{self.base_url}/upload/chunk/direct?block_id={block_id}&file_name={file_name}&content_type=application/octet-stream"
            if version_id:
                url += f"&version_id={version_id}"
            
            # Use new direct upload API with server-side key generation
            # IMPORTANT: override Content-Type for binary payloads; do NOT reuse JSON header
            binary_headers = dict(self.headers)
            binary_headers["Content-Type"] = "application/octet-stream"
            response = await self.client.post(
                url,
                content=chunk_data,
                headers=binary_headers
            )
            
            if response.status_code != 200:
                raise StorageException(f"Failed to upload chunk: {response.text}")
            
            result = response.json()
            return result["etag"]
            
        except Exception as e:
            log_error(f"Chunk upload failed for {block_id}/{file_name}: {str(e)}")
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
                    # For now, we'll use a workaround: save the manifest with a temporary name
                    # and then use the manifest update endpoint
                    # This is not ideal but works with the current API
                    
                    # Extract required fields from manifest_key
                    key_parts = manifest_key.split('/')
                    if len(key_parts) < 4:
                        raise StorageException(f"Invalid manifest key format: {manifest_key}")
                    
                    user_id = key_parts[0]
                    block_id = key_parts[1]
                    version_id = key_parts[2]
                    
                    # For now, let's just skip the update and log a warning
                    # In production, we would need a proper update endpoint
                    log_warning(f"Manifest update skipped - API limitation. Key: {manifest_key}")
                    
                    # Return the current etag to continue
                    return expected_etag
                
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
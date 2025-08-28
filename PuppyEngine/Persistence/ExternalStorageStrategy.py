"""
External Storage Persistence Strategy

This module implements the persistence strategy for blocks that use external storage.
It handles both uploading (persist) and downloading (resolve) of block content.
"""

from typing import Any, Dict, AsyncGenerator, Tuple, TYPE_CHECKING
import json
import uuid
from datetime import datetime
from Utils.logger import log_info, log_error, log_debug, log_warning
from Utils.file_type import decide_file_type
from clients.streaming_json_handler import StreamingJSONHandler, StreamingJSONAggregator

if TYPE_CHECKING:
    from Blocks.BaseBlock import BaseBlock


class ExternalStorageStrategy:
    """
    Persistence strategy for blocks using external storage
    
    This strategy handles:
    - Uploading block content to PuppyStorage (with streaming support)
    - Downloading and reconstructing content from PuppyStorage
    - Content type detection and appropriate chunking
    """
    
    def __init__(self):
        self.json_handler = StreamingJSONHandler(mode="jsonl")
        self.chunk_size = 1024 * 1024  # 1MB default chunk size
    
    async def resolve(self, storage_client: Any, block: 'BaseBlock') -> None:
        """
        🚀 优化：不再从外部存储下载内容，直接使用JSON中传递的content
        
        前端已经通过防抖机制确保了数据一致性，后端直接使用传递的内容即可。
        这样可以大幅减少网络请求，提升性能。
        
        Args:
            storage_client: Client for accessing external storage (unused)
            block: The block to resolve
        """
        # 检查是否已经有内容
        if block.get_content() is not None:
            log_debug(f"Block {block.id} already has content, marking as resolved")
            block.is_resolved = True
            return
        
        # 如果没有内容，检查是否有external_metadata（用于文件类型）
        external_metadata = block.data.get('external_metadata', {})
        content_type = external_metadata.get('content_type', 'text')
        
        # 特殊处理：仅对文件类型进行下载（因为文件需要实际的本地路径）
        if content_type == 'files' and external_metadata.get('resource_key'):
            log_info(f"File block {block.id} requires actual file download, proceeding with download")
            resource_key = external_metadata.get('resource_key')
            
            try:
                # Get manifest
                manifest_key = f"{resource_key}/manifest.json"
                manifest = await storage_client.get_manifest(manifest_key)
                
                # Download files to local directory
                import os
                import tempfile
                
                version_id = manifest.get('version_id') or resource_key.strip('/').split('/')[-1]
                base_tmp = tempfile.gettempdir()
                local_dir = os.path.join(base_tmp, 'puppy', 'env_files', block.id, version_id)
                os.makedirs(local_dir, exist_ok=True)

                files = []
                for chunk_info in manifest.get('chunks', []):
                    if isinstance(chunk_info, dict) and chunk_info.get('state') and chunk_info.get('state') != 'done':
                        continue
                    name = chunk_info.get('name')
                    if not name:
                        continue
                    chunk_key = f"{resource_key}/{name}"
                    try:
                        data = await storage_client.download_chunk(chunk_key)
                        local_path = os.path.join(local_dir, name)
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                        with open(local_path, 'wb') as f:
                            f.write(data)
                        files.append({
                            'local_path': local_path,
                            'file_name': chunk_info.get('file_name') or name,
                            'mime_type': chunk_info.get('mime_type'),
                            'file_type': decide_file_type(
                                chunk_info.get('file_type'),
                                chunk_info.get('mime_type'),
                                name
                            ),
                            'size': chunk_info.get('size'),
                            'etag': chunk_info.get('etag'),
                        })
                        log_debug(f"Downloaded file to {local_path}")
                    except Exception as de:
                        log_warning(f"Failed to download file {chunk_key}: {de}")
                        files.append({
                            'local_path': None,
                            'file_name': chunk_info.get('file_name') or name,
                            'error': str(de)
                        })

                block.data.setdefault('external_metadata', {})['local_dir'] = local_dir
                block.set_content(files)
                log_info(f"Downloaded {len(files)} files for block {block.id}")
                
            except Exception as e:
                log_error(f"Failed to download files for block {block.id}: {str(e)}")
                raise
        else:
            # 对于text和structured类型，不进行任何下载
            # 内容应该已经通过JSON传递过来了
            log_debug(f"Block {block.id} content should be provided via JSON, no download needed")
        
        block.is_resolved = True
    
    async def persist(self, storage_client: Any, user_id: str, block: 'BaseBlock') -> AsyncGenerator[Dict, None]:
        """
        Persist block content to external storage
        
        Uploads content to PuppyStorage with appropriate chunking based on content type.
        Yields events during the upload process.
        
        Args:
            storage_client: Client for accessing external storage
            user_id: ID of the user who owns this data
            block: The block to persist
            
        Yields:
            Dict: Events during persistence (STREAM_STARTED, STREAM_ENDED, etc.)
        """
        content = block.get_content()
        if content is None:
            log_debug(f"Block {block.id} has no content, skipping persist")
            block.is_persisted = True
            return
        
        # Determine content type
        content_type = self._determine_content_type(content)
        
        log_info(f"Starting external storage for block {block.id} (type: {content_type})")
        
        try:
            # Initialize stream to obtain version identifiers and resource key early
            version_base, version_id, manifest_key, current_etag = await storage_client.init_stream_version(block.id)
            
            # Prepare metadata and emit start event before upload
            block.data['external_metadata'] = {
                'resource_key': version_base,
                'content_type': content_type,
                'chunked': True,
                'uploaded_at': datetime.utcnow().isoformat(),
                'version_id': version_id
            }
            
            yield {
                "event_type": "STREAM_STARTED",
                "block_id": block.id,
                "version_id": version_id,
                "content_type": content_type,
                "resource_key": version_base,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            # Create chunk generator and perform incremental upload
            chunk_generator = self._create_chunk_generator(block, content, content_type)
            await storage_client.upload_chunks_and_update_manifest(
                block_id=block.id,
                version_id=version_id,
                chunk_generator=chunk_generator(),
                manifest_key=manifest_key,
                current_etag=current_etag
            )
            
            # Optionally clear content from memory
            # if block.storage_class == 'external':
            #     block.data['content'] = None
            
            block.is_persisted = True
            
            # Yield STREAM_ENDED event (with resource_key)
            yield {
                "event_type": "STREAM_ENDED",
                "block_id": block.id,
                "resource_key": version_base,
                "timestamp": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            log_error(f"Failed to persist block {block.id}: {str(e)}")
            # Include resource_key if already known
            error_event = {
                "event_type": "STREAM_ERROR",
                "block_id": block.id,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
            try:
                if 'external_metadata' in block.data and 'resource_key' in block.data['external_metadata']:
                    error_event["resource_key"] = block.data['external_metadata']['resource_key']
            except Exception:
                pass
            yield error_event
            raise
    
    def _create_chunk_generator(self, block: 'BaseBlock', content: Any, content_type: str):
        """Create appropriate chunk generator based on content type"""
        
        async def generate_chunks():
            if content_type == 'structured':
                # Use StreamingJSONHandler for structured data
                chunk_index = 0
                if isinstance(content, list):
                    for chunk_data in self.json_handler.split_to_jsonl(content):
                        yield f"chunk_{chunk_index:06d}.jsonl", chunk_data
                        chunk_index += 1
                else:
                    # Single object as JSONL
                    chunk_data = json.dumps(content, ensure_ascii=False).encode('utf-8') + b'\n'
                    yield "chunk_000000.jsonl", chunk_data
                    
            elif content_type == 'text':
                # Text content chunking
                text_bytes = content.encode('utf-8')
                chunk_index = 0
                for i in range(0, len(text_bytes), self.chunk_size):
                    chunk = text_bytes[i:i + self.chunk_size]
                    yield f"chunk_{chunk_index:06d}.txt", chunk
                    chunk_index += 1
                    
            else:  # binary
                # Binary content chunking
                chunk_index = 0
                for i in range(0, len(content), self.chunk_size):
                    chunk = content[i:i + self.chunk_size]
                    yield f"chunk_{chunk_index:06d}.bin", chunk
                    chunk_index += 1
        
        return generate_chunks
    
    def _determine_content_type(self, content: Any) -> str:
        """Determine the content type based on the content"""
        if isinstance(content, (list, dict)):
            return 'structured'
        elif isinstance(content, str):
            return 'text'
        else:
            return 'binary'
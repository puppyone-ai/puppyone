"""
External Storage Persistence Strategy

This module implements the persistence strategy for blocks that use external storage.
It handles both uploading (persist) and downloading (resolve) of block content.
"""

from typing import Any, Dict, AsyncGenerator, Tuple, TYPE_CHECKING
import json
import uuid
from datetime import datetime
from Utils.logger import log_info, log_error, log_debug
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
        Resolve external content for the block
        
        Downloads content from external storage and reconstructs it
        based on the content type specified in external_metadata.
        
        Args:
            storage_client: Client for accessing external storage
            block: The block to resolve
        """
        external_metadata = block.data.get('external_metadata', {})
        if not external_metadata:
            log_debug(f"Block {block.id} has no external_metadata, skipping resolve")
            block.is_resolved = True
            return
        
        resource_key = external_metadata.get('resource_key')
        if not resource_key:
            raise ValueError(f"Block {block.id} has external_metadata but no resource_key")
        
        log_info(f"Resolving external content for block {block.id} from {resource_key}")
        
        try:
            # Get manifest
            manifest_key = f"{resource_key}/manifest.json"
            manifest = await storage_client.get_manifest(manifest_key)
            
            # Reconstruct content based on type
            content_type = external_metadata.get('content_type', 'text')
            
            if content_type == 'structured':
                # Use StreamingJSONAggregator for structured data
                aggregator = StreamingJSONAggregator()
                for chunk_info in manifest['chunks']:
                    chunk_key = f"{resource_key}/{chunk_info['name']}"
                    chunk_data = await storage_client.download_chunk(chunk_key)
                    aggregator.add_jsonl_chunk(chunk_data)
                
                block.set_content(aggregator.get_aggregated_data())
                
            else:  # text or binary
                # Simple concatenation
                content_parts = []
                for chunk_info in manifest['chunks']:
                    chunk_key = f"{resource_key}/{chunk_info['name']}"
                    chunk_data = await storage_client.download_chunk(chunk_key)
                    content_parts.append(chunk_data)
                
                if content_type == 'text':
                    block.set_content(b''.join(content_parts).decode('utf-8'))
                else:
                    block.set_content(b''.join(content_parts))
            
            block.is_resolved = True
            log_info(f"Successfully resolved content for block {block.id}")
            
        except Exception as e:
            log_error(f"Failed to resolve block {block.id}: {str(e)}")
            raise
    
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
            
            # Update block's external_metadata early so downstream can reference it immediately
            block.data['external_metadata'] = {
                'resource_key': version_base,
                'content_type': content_type,
                'chunked': True,
                'uploaded_at': datetime.utcnow().isoformat(),
                'version_id': version_id
            }
            
            # Yield STREAM_STARTED event including resource_key
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
"""
Block Update Service

This module provides a service for handling block updates, including storage strategy
application, persistence, and event generation. It encapsulates the complex logic
of block updates and reduces coupling in the main execution flow.
"""

from typing import Dict, Any, AsyncGenerator, Tuple
import json
from .HybridStoragePolicy import HybridStoragePolicy
from .EventFactory import EventFactory
from Blocks.BaseBlock import BaseBlock
from Utils.logger import log_debug


class BlockUpdateService:
    """
    Service for handling block updates with storage strategy and event generation
    
    This service encapsulates the complex logic of:
    - Applying storage policies to blocks
    - Persisting blocks with appropriate strategies
    - Generating consistent events
    - Providing v1 compatibility data
    """
    
    def __init__(self, storage_policy: HybridStoragePolicy = None):
        """
        Initialize the block update service
        
        Args:
            storage_policy: Storage policy to use. If None, creates default policy
        """
        self.storage_policy = storage_policy or HybridStoragePolicy()
    
    async def update_blocks_with_results(
        self, 
        blocks: Dict[str, BaseBlock], 
        results: Dict[str, Any], 
        storage_client: Any, 
        user_id: str
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Update blocks with execution results and generate appropriate events
        
        Args:
            blocks: Dictionary of blocks by ID
            results: Dictionary mapping block IDs to their new content
            storage_client: Client for external storage operations
            user_id: User ID for persistence operations
            
        Yields:
            Dict: Events during block updates (STREAM_*, BLOCK_UPDATED)
        """
        v1_results = {}
        
        for block_id, content in results.items():
            block = blocks[block_id]

            # Normalize content according to target block type to ensure
            # consistent semantic type across storage and events
            normalized_content, semantic_type = self._classify_and_normalize(
                desired_block_type=block.type, value=content
            )

            # Set content so persistence can read from it
            block.set_content(normalized_content)
            
            # Apply storage strategy
            storage_metadata = self.storage_policy.get_storage_metadata(normalized_content)
            use_external_storage = storage_metadata["use_external_storage"]
            
            if use_external_storage:
                # Apply external storage strategy and yield persistence events
                async for event in self._handle_external_storage_update(
                    block, storage_client, user_id, v1_results
                ):
                    yield event
                
                # Generate BLOCK_UPDATED event for external storage
                external_metadata = block.data.get("external_metadata", {})
                block_event = EventFactory.create_block_updated_event_external(
                    block_id, external_metadata
                )
                yield block_event
                
            else:
                # Apply internal storage strategy
                self._handle_internal_storage_update(block, normalized_content, v1_results)
                
                # Generate BLOCK_UPDATED event for internal storage
                # Pass the semantic type determined by _classify_and_normalize
                block_event = EventFactory.create_block_updated_event_internal(
                    block_id, normalized_content, semantic_type
                )
                yield block_event
        
        # Yield the v1 compatibility results as the final event
        yield {"v1_results": v1_results}
    
    async def _handle_external_storage_update(
        self, 
        block: BaseBlock, 
        storage_client: Any, 
        user_id: str,
        v1_results: Dict[str, Any]
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Handle block update with external storage
        
        Args:
            block: Block to update
            storage_client: Client for external storage
            user_id: User ID for persistence
            v1_results: Dictionary to populate with v1 compatibility data
            
        Yields:
            Dict: Events from persistence operations
        """
        # Force external storage for long content
        block.storage_class = 'external'
        
        # Persist block first (may yield STREAM_* events)
        async for event in block.persist(storage_client, user_id):
            yield event
        
        # Add to v1 results
        v1_results[block.id] = {
            "storage_class": "external",
            "external_metadata": block.data.get("external_metadata")
        }
        
        log_debug(f"Block {block.id} updated with external storage")
    
    def _handle_internal_storage_update(
        self, 
        block: BaseBlock, 
        content: Any,
        v1_results: Dict[str, Any]
    ) -> None:
        """
        Handle block update with internal storage
        
        Args:
            block: Block to update
            content: Content to store
            v1_results: Dictionary to populate with v1 compatibility data
        """
        # Force internal storage for short content
        block.storage_class = 'internal'
        # For internal storage, we don't need to persist to external storage
        block.is_persisted = True
        
        # Add to v1 results
        v1_results[block.id] = content
        
        log_debug(f"Block {block.id} updated with internal storage")
    
    def get_storage_policy(self) -> HybridStoragePolicy:
        """
        Get the current storage policy
        
        Returns:
            The storage policy instance
        """
        return self.storage_policy

    # --- Helpers ---
    def _classify_and_normalize(self, desired_block_type: str, value: Any) -> Tuple[Any, str]:
        """
        Classify content into semantic type (text/structured) and normalize the value
        to avoid UI/storage mismatches.
        
        Centralized type determination logic - content-driven approach:
        - Determine semantic type based on actual content, not desired type
        - This allows frontend to dynamically update node types
        - Normalize content appropriately for the determined type

        Rules:
        - Any scalar (str/int/float/bool/None) -> always text
        - Any non-serializable object -> always text  
        - Valid dict/list -> always structured
        - Content type drives the semantic type, not desired_block_type
        """
        
        # First, determine if the value is inherently structured (dict/list)
        is_structured_value = isinstance(value, (dict, list))
        
        # If value is not structured (scalar, None, or other types), always treat as text
        if not is_structured_value:
            try:
                return "" if value is None else str(value), 'text'
            except Exception:
                return "", 'text'
        
        # Value is dict/list - check if it's valid structured content
        try:
            # Ensure it's JSON-serializable
            json.dumps(value)
        except (TypeError, ValueError):
            # Not serializable, treat as text
            try:
                return str(value), 'text'
            except Exception:
                return "", 'text'
        
        # Value is valid dict/list - always return as structured
        # Let the frontend handle node type conversion if needed
        return value, 'structured'

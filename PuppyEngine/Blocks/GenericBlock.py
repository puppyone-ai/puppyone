"""
Generic Block Implementation

This module implements a concrete block class that uses composable persistence strategies.
It supports dynamic switching between memory and external storage based on content size.
"""

from typing import Any, Dict, AsyncGenerator
import sys
import os
from .BaseBlock import BaseBlock
from Persistence import MemoryStrategy, ExternalStorageStrategy
from Server.HybridStoragePolicy import HybridStoragePolicy
from Utils.logger import log_info, log_debug


class GenericBlock(BaseBlock):
    """
    A concrete block implementation with dynamic persistence strategy
    
    This block can dynamically switch between memory and external storage
    strategies based on content size or explicit configuration.
    """
    
    def __init__(self, block_id: str, block_data: Dict[str, Any], persistence_strategy=None):
        """
        Initialize a GenericBlock
        
        Args:
            block_id: Unique identifier for the block
            block_data: Dictionary containing block configuration and content
            persistence_strategy: Optional initial persistence strategy
        """
        super().__init__(block_id, block_data)
        
        # Initialize storage policy
        self.storage_policy = HybridStoragePolicy()
        
        # Set initial persistence strategy
        if persistence_strategy:
            self.persistence = persistence_strategy
        elif self.storage_class == 'external' or self.has_external_data():
            self.persistence = ExternalStorageStrategy()
            log_debug(f"Block {block_id} initialized with ExternalStorageStrategy")
        else:
            self.persistence = MemoryStrategy()
            log_debug(f"Block {block_id} initialized with MemoryStrategy")
    
    async def resolve(self, storage_client: Any) -> None:
        """
        Resolve content using the current persistence strategy
        
        Args:
            storage_client: Client for accessing external storage
        """
        await self.persistence.resolve(storage_client, self)
    
    async def persist(self, storage_client: Any, user_id: str) -> AsyncGenerator[Dict, None]:
        """
        Persist content with dynamic strategy evaluation
        
        This method evaluates whether the persistence strategy should be
        switched before persisting the content.
        
        Args:
            storage_client: Client for accessing external storage
            user_id: ID of the user who owns this data
            
        Yields:
            Dict: Events during persistence
        """
        # Evaluate if we need to switch strategy
        new_strategy_needed = self._evaluate_storage_need()
        
        # Switch strategy if needed
        if new_strategy_needed and not isinstance(self.persistence, ExternalStorageStrategy):
            self.persistence = ExternalStorageStrategy()
            self.storage_class = 'external'
            log_info(f"Block {self.id}: Content size exceeded threshold, switching to ExternalStorageStrategy")
            
        elif not new_strategy_needed and isinstance(self.persistence, ExternalStorageStrategy) and not self.has_external_data():
            # Only switch back to memory if we don't already have external data
            self.persistence = MemoryStrategy()
            self.storage_class = 'internal'
            log_info(f"Block {self.id}: Content size below threshold, switching to MemoryStrategy")
        
        # Delegate to the current strategy
        async for event in self.persistence.persist(storage_client, user_id, self):
            yield event
    
    def _evaluate_storage_need(self) -> bool:
        """
        Evaluate whether external storage is needed
        
        Returns:
            bool: True if external storage should be used
        """
        # If explicitly set to external, always use external
        if self.storage_class == 'external':
            return True
        
        # If we already have external data, keep using external
        if self.has_external_data():
            return True
        
        # Use storage policy to determine if external storage is needed
        content = self.get_content()
        return self.storage_policy.should_use_external_storage(content)
    
    def to_dict(self) -> Dict[str, Any]:
        """
        Convert block to dictionary representation
        
        Returns:
            Dict containing block data and metadata
        """
        return {
            'id': self.id,
            'label': self.label,
            'type': self.type,
            'storage_class': self.storage_class,
            'data': self.data,
            'metadata': self.get_metadata()
        }
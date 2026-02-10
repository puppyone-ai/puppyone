"""
Memory Persistence Strategy

This module implements the persistence strategy for blocks that remain in memory.
"""

from typing import Any, Dict, AsyncGenerator, TYPE_CHECKING
from Utils.logger import log_debug

if TYPE_CHECKING:
    from Blocks.BaseBlock import BaseBlock


class MemoryStrategy:
    """
    Persistence strategy for in-memory blocks
    
    This strategy is a no-op for both resolve and persist operations,
    as the data remains in memory throughout the block's lifecycle.
    """
    
    async def resolve(self, storage_client: Any, block: 'BaseBlock') -> None:
        """
        Resolve content for in-memory blocks (no-op)
        
        Args:
            storage_client: Storage client (unused for memory strategy)
            block: The block to resolve
        """
        log_debug(f"MemoryStrategy.resolve called for block {block.id} (no-op)")
        block.is_resolved = True
    
    async def persist(self, storage_client: Any, user_id: str, block: 'BaseBlock') -> AsyncGenerator[Dict, None]:
        """
        Persist content for in-memory blocks (no-op)
        
        Args:
            storage_client: Storage client (unused for memory strategy)
            user_id: User ID (unused for memory strategy)
            block: The block to persist
            
        Yields:
            Nothing - memory blocks don't generate persistence events
        """
        log_debug(f"MemoryStrategy.persist called for block {block.id} (no-op)")
        block.is_persisted = True
        # Empty generator - no events for memory persistence
        return
        yield  # Make this a generator
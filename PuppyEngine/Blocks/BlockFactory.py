"""
Block Factory

This module provides a factory for creating block instances with the appropriate
initial persistence strategy based on block configuration.
"""

from typing import Dict, Any
from .GenericBlock import GenericBlock
from .BaseBlock import BaseBlock
from Persistence import MemoryStrategy, ExternalStorageStrategy
from Utils.logger import log_debug


class BlockFactory:
    """
    Factory for creating Block instances
    
    This factory centralizes the logic for block instantiation and
    ensures blocks are created with the appropriate initial configuration.
    """
    
    @staticmethod
    def create_block(block_id: str, block_data: Dict[str, Any]) -> BaseBlock:
        """
        Create a block instance with the appropriate persistence strategy
        
        Args:
            block_id: Unique identifier for the block
            block_data: Dictionary containing block configuration
            
        Returns:
            BaseBlock: A configured block instance
        """
        # Determine initial persistence strategy
        storage_class = block_data.get('storage_class', 'internal')
        has_external_metadata = bool(block_data.get('data', {}).get('external_metadata'))

        # Authoritative switch: storage_class decides. External metadata without
        # explicit external storage_class must not switch strategy implicitly.
        if storage_class == 'external':
            strategy = ExternalStorageStrategy()
            log_debug(f"Creating block {block_id} with ExternalStorageStrategy")
        else:
            strategy = MemoryStrategy()
            log_debug(f"Creating block {block_id} with MemoryStrategy")
        
        # Normalize loop flag location: frontends historically put `looped` at top level.
        # Maintain SSOT by mirroring into data.looped for downstream components that read from data.
        try:
            top_level_looped = block_data.get('looped', None)
            if top_level_looped is not None:
                block_data.setdefault('data', {})['looped'] = bool(top_level_looped)
        except Exception:
            # Best-effort normalization; ignore if block_data is malformed
            pass

        # Create GenericBlock instance
        # In the future, we could create different block types based on block_data['type']
        return GenericBlock(block_id, block_data, persistence_strategy=strategy)
    
    @staticmethod
    def create_blocks_from_workflow(workflow_data: Dict[str, Any]) -> Dict[str, BaseBlock]:
        """
        Create all blocks from workflow data
        
        Args:
            workflow_data: The workflow JSON containing blocks definition
            
        Returns:
            Dict[str, BaseBlock]: Dictionary mapping block IDs to block instances
        """
        blocks = {}
        blocks_data = workflow_data.get('blocks', {})
        
        for block_id, block_data in blocks_data.items():
            blocks[block_id] = BlockFactory.create_block(block_id, block_data)
        
        log_debug(f"Created {len(blocks)} blocks from workflow data")
        return blocks
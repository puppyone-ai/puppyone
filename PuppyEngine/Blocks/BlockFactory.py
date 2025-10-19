"""
Block Factory

This module provides a factory for creating block instances with the appropriate
initial persistence strategy based on block configuration.
"""

from typing import Any, Dict

from Persistence import ExternalStorageStrategy, MemoryStrategy
from Utils.logger import log_debug

from .BaseBlock import BaseBlock
from .GenericBlock import GenericBlock


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
        storage_class = block_data.get('storage_class', 'internal')

        # Select persistence strategy based on storage_class
        if storage_class == 'external':
            strategy = ExternalStorageStrategy()
            log_debug(f"Creating block {block_id} with ExternalStorageStrategy")
        else:
            strategy = MemoryStrategy()
            log_debug(f"Creating block {block_id} with MemoryStrategy")
        
        # Normalize loop flag: mirror top-level 'looped' into 'data.looped' for SSOT
        try:
            top_level_looped = block_data.get('looped')
            if top_level_looped is not None:
                block_data.setdefault('data', {})['looped'] = bool(top_level_looped)
        except Exception:
            pass

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
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
        🚀 优化：简化block创建逻辑，统一使用内容驱动的策略选择
        
        现在后端不再从外部存储下载内容，而是直接使用JSON中的content。
        策略选择基于内容大小和类型，而不是external_metadata。
        
        Args:
            block_id: Unique identifier for the block
            block_data: Dictionary containing block configuration
            
        Returns:
            BaseBlock: A configured block instance
        """
        # 检查是否是文件类型（文件类型仍需要外部存储策略用于下载实际文件）
        block_type = block_data.get('type', 'text')
        has_external_metadata = bool(block_data.get('data', {}).get('external_metadata'))
        content_type = block_data.get('data', {}).get('external_metadata', {}).get('content_type', 'text')
        
        # 文件类型仍然需要ExternalStorageStrategy来处理文件下载
        if block_type == 'file' or content_type == 'files':
            strategy = ExternalStorageStrategy()
            log_debug(f"Creating file block {block_id} with ExternalStorageStrategy for file handling")
        else:
            # 对于text和structured类型，默认使用MemoryStrategy
            # ExternalStorageStrategy只在需要持久化大内容时动态切换
            strategy = MemoryStrategy()
            log_debug(f"Creating block {block_id} with MemoryStrategy (will auto-switch if needed)")
        
        # Create GenericBlock instance
        # GenericBlock会根据内容大小动态切换策略
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
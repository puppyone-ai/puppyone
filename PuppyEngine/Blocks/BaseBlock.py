"""
Base Block Abstract Class

This module defines the abstract base class for all Block types in PuppyEngine.
It establishes the protocol-oriented programming (POP) approach for blocks.
"""

from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict


class BaseBlock(ABC):
    """
    Abstract base class for all Block types
    
    This class defines the interface that all concrete block implementations
    must follow. It provides common properties and abstract methods for
    content resolution and persistence.
    """
    
    def __init__(self, block_id: str, block_data: Dict[str, Any]):
        """
        Initialize a block with its ID and data
        
        Args:
            block_id: Unique identifier for the block
            block_data: Dictionary containing block configuration and content
        """
        self.id = block_id
        self.label = block_data.get('label', block_id)
        self.type = block_data.get('type', 'text')
        self.data = block_data.get('data', {})
        self.storage_class = block_data.get('storage_class', 'internal')
        
        # Track block state
        self.is_resolved = False
        self.is_persisted = False
    
    @abstractmethod
    async def resolve(self, storage_client: Any) -> None:
        """
        Resolve external content for this block
        
        This method should fetch any external data referenced by the block
        and populate the block's content.
        
        Args:
            storage_client: Client for accessing external storage
        """
        pass
    
    @abstractmethod
    async def persist(self, storage_client: Any, user_id: str) -> AsyncGenerator[Dict, None]:
        """
        Persist block content to storage
        
        This method should save the block's content to appropriate storage
        and may yield events during the process.
        
        Args:
            storage_client: Client for accessing external storage
            user_id: ID of the user who owns this data
            
        Yields:
            Dict: Events during persistence (e.g., STREAM_STARTED, STREAM_ENDED)
        """
        pass
    
    def get_content(self) -> Any:
        """Get the content of this block"""
        return self.data.get('content')
    
    def set_content(self, content: Any) -> None:
        """Set the content of this block"""
        self.data['content'] = content
    
    def get_metadata(self) -> Dict[str, Any]:
        """Get block metadata"""
        return {
            'id': self.id,
            'label': self.label,
            'type': self.type,
            'storage_class': self.storage_class,
            'is_resolved': self.is_resolved,
            'is_persisted': self.is_persisted
        }
    
    def has_external_data(self) -> bool:
        """Check if this block has external data that needs to be resolved"""
        return bool(self.data.get('external_metadata'))
    
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(id={self.id}, type={self.type}, storage_class={self.storage_class})>"
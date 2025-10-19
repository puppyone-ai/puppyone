"""
Chunk Data Class

Immutable data class representing a chunk of content with associated metadata.
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Dict


@dataclass(frozen=True)
class Chunk:
    """
    Immutable chunk data structure
    
    Attributes:
        content: Text content of the chunk
        metadata: Associated metadata dictionary
    """
    content: str = field(default="")
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        """Validate field types after initialization"""
        if not isinstance(self.content, str):
            raise TypeError(f"Expected content to be str, got {type(self.content).__name__}")

        if not isinstance(self.metadata, dict):
            raise TypeError(f"Expected metadata to be dict, got {type(self.metadata).__name__}")

    def __repr__(self):
        """Return compact readable representation"""
        fields = []
        if self.content:
            fields.append(f"content={self.content!r}")
        if self.metadata:
            fields.append(f"metadata={self.metadata}")
        return f"{self.__class__.__name__}({', '.join(fields)})"

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Chunk":
        """
        Create Chunk instance from dictionary
        
        Args:
            data: Dictionary with 'content' and 'metadata' keys
            
        Returns:
            Chunk instance
            
        Raises:
            TypeError: If data types are invalid
        """
        if not isinstance(data, dict):
            raise TypeError(f"Expected data to be dict, got {type(data).__name__}")

        content = data.get("content", "")
        metadata = data.get("metadata", {})

        if not isinstance(content, str):
            raise TypeError(f"Expected content to be str, got {type(content).__name__}")
        
        if not isinstance(metadata, dict):
            raise TypeError(f"Expected metadata to be dict, got {type(metadata).__name__}")

        return cls(content=content, metadata=metadata)

    def to_dict(self) -> Dict[str, Any]:
        """Convert Chunk to dictionary representation"""
        return asdict(self)


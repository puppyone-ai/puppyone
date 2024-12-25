from typing import Any, Dict
from dataclasses import dataclass, field, asdict


@dataclass(frozen=True)
class Chunk:
    content: str = field(default="")
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(
        self
    ):
        # Validate content type
        if not isinstance(self.content, str):
            raise TypeError(f"Expected content to be a str, but got {type(self.content).__name__}")

        # Validate metadata type
        if not isinstance(self.metadata, dict):
            raise TypeError(f"Expected metadata to be a dict, but got {type(self.metadata).__name__}")

    def __repr__(
        self
    ):
        # Return a more readable and compact representation
        fields = []
        if self.content:
            fields.append(f"content={self.content!r}")
        if self.metadata:
            fields.append(f"metadata={self.metadata}")
        return f"{self.__class__.__name__}({', '.join(fields)})"

    @classmethod
    def from_dict(
        cls,
        data: Dict[str, Any]
    ) -> "Chunk":
        if not isinstance(data, dict):
            raise TypeError(f"Expected data to be a dict, but got {type(data).__name__}")

        content = data.get("content", "")
        metadata = data.get("metadata", {})

        if not isinstance(content, str):
            raise TypeError(f"Expected content to be a str, but got {type(content).__name__}")
        
        if not isinstance(metadata, dict):
            raise TypeError(f"Expected metadata to be a dict, but got {type(metadata).__name__}")

        return cls(content=content, metadata=metadata)

    def to_dict(
        self
    ) -> Dict[str, Any]:
        return asdict(self)

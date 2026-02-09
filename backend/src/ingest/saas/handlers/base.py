"""
Base Handler - Abstract base class for all import handlers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional

from src.ingest.saas.task.models import ImportTask


# Progress callback type
ProgressCallback = Callable[[int, str], None]


class ImportResult:
    """Result of an import operation."""
    
    def __init__(
        self,
        content_node_id: str,
        items_count: int = 0,
        metadata: Optional[dict[str, Any]] = None,
    ):
        self.content_node_id = content_node_id
        self.items_count = items_count
        self.metadata = metadata or {}


@dataclass
class PreviewResult:
    """Result of a preview/parse operation."""
    source_type: str
    title: str
    description: Optional[str] = None
    data: List[dict] = field(default_factory=list)
    fields: List[dict] = field(default_factory=list)
    total_items: int = 0
    structure_info: Optional[dict] = None


class BaseHandler(ABC):
    """
    Abstract base class for import handlers.
    
    Each handler processes a specific type of import source.
    """

    @abstractmethod
    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """
        Process the import task.
        
        Args:
            task: The import task to process
            on_progress: Callback to report progress (progress: 0-100, message: str)
        
        Returns:
            ImportResult with content_node_id and items_count
        
        Raises:
            Exception: If processing fails
        """
        pass

    @abstractmethod
    def can_handle(self, task: ImportTask) -> bool:
        """Check if this handler can process the given task."""
        pass

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """
        Get preview data for a URL without importing.
        
        Override this method to provide preview/parse functionality.
        Default implementation returns minimal info.
        
        Args:
            url: The URL to preview
            user_id: The user ID for OAuth context
            
        Returns:
            PreviewResult with preview data
        """
        raise NotImplementedError(f"{self.__class__.__name__} does not support preview")


"""Base data provider interface for connect module."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class DataProviderResult(BaseModel):
    """Result from data provider with structured data and metadata."""

    source_type: str  # e.g., "json", "html", "notion_database", "notion_page"
    title: Optional[str] = None
    description: Optional[str] = None
    data: List[Dict[str, Any]]
    fields: List[Dict[str, Any]]  # Field definitions with type info
    structure_info: Optional[Dict[str, Any]] = None  # Additional metadata
    sample_size: Optional[int] = None


class DataProvider(ABC):
    """Abstract base class for data providers."""

    @abstractmethod
    async def can_handle(self, url: str) -> bool:
        """Check if this provider can handle the given URL."""
        pass

    @abstractmethod
    async def fetch_data(self, url: str) -> DataProviderResult:
        """Fetch and parse data from the given URL."""
        pass

    async def close(self):
        """Close any resources (optional)."""
        pass
"""
OCR Provider Base Class

Abstract base class for OCR providers.
All OCR providers (MineRU, Reducto, etc.) must implement this interface.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class ParsedDocument:
    """
    Standardized result from OCR processing.
    
    All OCR providers return this same structure, making it easy
    to swap providers without changing downstream code.
    """
    
    # Unique task/job ID from the provider (for tracking)
    task_id: str
    
    # Extracted markdown content (main output)
    markdown_content: str
    
    # Optional: Local cache directory (if provider downloads files locally)
    cache_dir: Optional[str] = None
    
    # Optional: Path to the markdown file (if saved locally)
    markdown_path: Optional[str] = None
    
    # Optional: Provider-specific metadata
    metadata: Optional[dict] = None


class OCRProvider(ABC):
    """
    Abstract base class for OCR providers.
    
    Each provider implements:
    - parse_document(): Main method to OCR a document from URL
    
    The provider handles its own:
    - Authentication
    - Task creation/polling
    - Result fetching
    - Error handling
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging and identification."""
        pass
    
    @abstractmethod
    async def parse_document(
        self,
        file_url: str,
        data_id: Optional[str] = None,
    ) -> ParsedDocument:
        """
        Parse a document and extract text as markdown.
        
        Args:
            file_url: Presigned URL to the document (PDF, image, etc.)
            data_id: Optional identifier for tracking
            
        Returns:
            ParsedDocument with extracted markdown content
            
        Raises:
            OCRProviderError: If parsing fails
        """
        pass
    
    @abstractmethod
    async def health_check(self) -> bool:
        """
        Check if the provider is available and properly configured.
        
        Returns:
            True if provider is ready, False otherwise
        """
        pass


class OCRProviderError(Exception):
    """Base exception for OCR provider errors."""
    
    def __init__(
        self,
        provider: str,
        message: str,
        status_code: Optional[int] = None,
        raw_response: Optional[str] = None,
    ):
        self.provider = provider
        self.message = message
        self.status_code = status_code
        self.raw_response = raw_response
        super().__init__(f"[{provider}] {message}")


class OCRProviderConfigError(OCRProviderError):
    """Raised when provider is not properly configured (e.g., missing API key)."""
    pass


class OCRProviderAPIError(OCRProviderError):
    """Raised when provider API returns an error."""
    pass


class OCRProviderTimeoutError(OCRProviderError):
    """Raised when provider times out."""
    pass


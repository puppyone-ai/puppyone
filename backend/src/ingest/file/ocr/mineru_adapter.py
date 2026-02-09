"""
MineRU OCR Provider Adapter

Wraps the existing MineRU client to implement the OCRProvider interface.
"""

import logging
from typing import Optional

from src.ingest.file.mineru.client import MineRUClient
from src.ingest.file.mineru.config import mineru_config
from src.ingest.file.mineru.exceptions import (
    MineRUAPIError,
    MineRUAPIKeyError,
    MineRUTimeoutError,
)
from src.ingest.file.mineru.schemas import MineRUModelVersion
from src.ingest.file.ocr.base import (
    OCRProvider,
    OCRProviderAPIError,
    OCRProviderConfigError,
    OCRProviderTimeoutError,
    ParsedDocument,
)

logger = logging.getLogger(__name__)


class MineRUProvider(OCRProvider):
    """
    MineRU OCR Provider.
    
    Wraps the existing MineRUClient to provide a unified OCRProvider interface.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize MineRU provider.
        
        Args:
            api_key: MineRU API key (defaults to env var MINERU_API_KEY)
        """
        self._api_key = api_key or mineru_config.mineru_api_key
        self._client: Optional[MineRUClient] = None
    
    @property
    def name(self) -> str:
        return "mineru"
    
    def _get_client(self) -> MineRUClient:
        """Lazy initialization of MineRU client."""
        if self._client is None:
            try:
                self._client = MineRUClient(api_key=self._api_key)
            except MineRUAPIKeyError as e:
                raise OCRProviderConfigError(
                    provider=self.name,
                    message="MineRU API key not configured. Set MINERU_API_KEY environment variable.",
                ) from e
        return self._client
    
    async def parse_document(
        self,
        file_url: str,
        data_id: Optional[str] = None,
    ) -> ParsedDocument:
        """
        Parse document using MineRU OCR.
        
        Args:
            file_url: Presigned URL to the document
            data_id: Optional tracking identifier
            
        Returns:
            ParsedDocument with extracted content
        """
        client = self._get_client()
        
        try:
            result = await client.parse_document(
                file_url=file_url,
                model_version=MineRUModelVersion.VLM,
                data_id=data_id,
            )
            
            return ParsedDocument(
                task_id=result.task_id,
                markdown_content=result.markdown_content,
                cache_dir=result.cache_dir,
                markdown_path=result.markdown_path,
                metadata={"provider": "mineru"},
            )
            
        except MineRUTimeoutError as e:
            raise OCRProviderTimeoutError(
                provider=self.name,
                message=str(e),
            ) from e
        except MineRUAPIError as e:
            raise OCRProviderAPIError(
                provider=self.name,
                message=str(e),
                status_code=getattr(e, "status_code", None),
            ) from e
    
    async def health_check(self) -> bool:
        """Check if MineRU is properly configured."""
        try:
            self._get_client()
            return True
        except OCRProviderConfigError:
            return False


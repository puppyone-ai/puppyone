"""
Reducto OCR Provider

Reducto is a document parsing service that extracts text from PDFs and images.
API Documentation: https://docs.reducto.ai

Key features:
- High-quality PDF parsing with layout preservation
- Table extraction
- Markdown output
"""

import asyncio
import logging
from typing import Optional

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.upload.file.ocr.base import (
    OCRProvider,
    OCRProviderAPIError,
    OCRProviderConfigError,
    OCRProviderTimeoutError,
    ParsedDocument,
)

logger = logging.getLogger(__name__)


class ReductoConfig(BaseSettings):
    """Configuration for Reducto API."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )
    
    reducto_api_key: Optional[str] = Field(
        default=None,
        description="Reducto API Key",
    )
    
    reducto_api_base_url: str = Field(
        default="https://platform.reducto.ai",
        description="Reducto API base URL",
    )
    
    reducto_poll_interval: int = Field(
        default=3,
        description="Polling interval in seconds",
    )
    
    reducto_max_wait_time: int = Field(
        default=600,
        description="Maximum wait time for task completion (10 minutes)",
    )


# Global config instance
reducto_config = ReductoConfig()


class ReductoProvider(OCRProvider):
    """
    Reducto OCR Provider.
    
    Uses Reducto's API to parse documents and extract text as markdown.
    
    API Flow:
    1. POST /parse - Create a parsing job with document URL
    2. Poll job status until completion
    3. Get markdown result
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Reducto provider.
        
        Args:
            api_key: Reducto API key (defaults to env var REDUCTO_API_KEY)
        """
        self._api_key = api_key or reducto_config.reducto_api_key
        self._base_url = reducto_config.reducto_api_base_url
        self._poll_interval = reducto_config.reducto_poll_interval
        self._max_wait_time = reducto_config.reducto_max_wait_time
        
        if not self._api_key:
            logger.warning("Reducto API key not configured")
    
    @property
    def name(self) -> str:
        return "reducto"
    
    def _get_headers(self) -> dict:
        """Get request headers with authentication."""
        if not self._api_key:
            raise OCRProviderConfigError(
                provider=self.name,
                message="Reducto API key not configured. Set REDUCTO_API_KEY environment variable.",
            )
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
    
    async def parse_document(
        self,
        file_url: str,
        data_id: Optional[str] = None,
    ) -> ParsedDocument:
        """
        Parse document using Reducto API.
        
        Args:
            file_url: Presigned URL to the document
            data_id: Optional tracking identifier
            
        Returns:
            ParsedDocument with extracted content
        """
        headers = self._get_headers()
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Step 1: Create parsing job
            try:
                logger.info(f"[Reducto] Creating parse job for: {file_url[:50]}...")
                
                # Reducto API endpoint for parsing
                # See: https://docs.reducto.ai/api-reference/parse
                create_response = await client.post(
                    f"{self._base_url}/parse",
                    headers=headers,
                    json={
                        "document_url": file_url,
                        "options": {
                            "output_mode": "markdown",  # Request markdown output
                            "table_output_mode": "markdown",  # Tables as markdown
                        },
                    },
                )
                
                if create_response.status_code == 401:
                    raise OCRProviderAPIError(
                        provider=self.name,
                        message="Authentication failed. Check your REDUCTO_API_KEY.",
                        status_code=401,
                        raw_response=create_response.text,
                    )
                
                if create_response.status_code != 200:
                    raise OCRProviderAPIError(
                        provider=self.name,
                        message=f"Failed to create parse job: {create_response.text}",
                        status_code=create_response.status_code,
                        raw_response=create_response.text,
                    )
                
                result = create_response.json()
                
                # Reducto may return result directly (sync) or job_id (async)
                if "result" in result and result.get("status") == "completed":
                    # Sync response - result is already available
                    markdown_content = self._extract_markdown(result["result"])
                    return ParsedDocument(
                        task_id=result.get("job_id", data_id or "sync"),
                        markdown_content=markdown_content,
                        metadata={"provider": "reducto", "mode": "sync"},
                    )
                
                # Async response - need to poll for result
                job_id = result.get("job_id")
                if not job_id:
                    raise OCRProviderAPIError(
                        provider=self.name,
                        message="No job_id in response",
                        raw_response=str(result),
                    )
                
                logger.info(f"[Reducto] Job created: {job_id}")
                
            except httpx.HTTPError as e:
                raise OCRProviderAPIError(
                    provider=self.name,
                    message=f"HTTP error creating job: {e}",
                ) from e
            
            # Step 2: Poll for completion
            markdown_content = await self._poll_job(client, job_id, headers)
            
            return ParsedDocument(
                task_id=job_id,
                markdown_content=markdown_content,
                metadata={"provider": "reducto", "mode": "async"},
            )
    
    async def _poll_job(
        self,
        client: httpx.AsyncClient,
        job_id: str,
        headers: dict,
    ) -> str:
        """
        Poll for job completion.
        
        Args:
            client: HTTP client
            job_id: Job ID to poll
            headers: Request headers
            
        Returns:
            Extracted markdown content
        """
        elapsed = 0
        
        while elapsed < self._max_wait_time:
            try:
                response = await client.get(
                    f"{self._base_url}/parse/{job_id}",
                    headers=headers,
                )
                
                if response.status_code != 200:
                    raise OCRProviderAPIError(
                        provider=self.name,
                        message=f"Failed to get job status: {response.text}",
                        status_code=response.status_code,
                    )
                
                result = response.json()
                status = result.get("status", "").lower()
                
                if status == "completed":
                    logger.info(f"[Reducto] Job {job_id} completed")
                    return self._extract_markdown(result.get("result", {}))
                
                if status in ("failed", "error"):
                    error_msg = result.get("error", "Unknown error")
                    raise OCRProviderAPIError(
                        provider=self.name,
                        message=f"Job failed: {error_msg}",
                        raw_response=str(result),
                    )
                
                # Still processing
                logger.debug(f"[Reducto] Job {job_id} status: {status}")
                
            except httpx.HTTPError as e:
                logger.warning(f"[Reducto] Poll error (will retry): {e}")
            
            await asyncio.sleep(self._poll_interval)
            elapsed += self._poll_interval
        
        raise OCRProviderTimeoutError(
            provider=self.name,
            message=f"Job {job_id} timed out after {self._max_wait_time}s",
        )
    
    def _extract_markdown(self, result: dict) -> str:
        """
        Extract markdown content from Reducto result.
        
        Reducto returns structured result with different sections.
        We combine them into a single markdown string.
        """
        # Reducto result structure varies by API version
        # Try different possible fields
        
        # Direct markdown field
        if "markdown" in result:
            return result["markdown"]
        
        # Chunks/pages structure
        if "chunks" in result:
            chunks = result["chunks"]
            if isinstance(chunks, list):
                return "\n\n".join(
                    chunk.get("text", "") or chunk.get("markdown", "")
                    for chunk in chunks
                )
        
        # Pages structure
        if "pages" in result:
            pages = result["pages"]
            if isinstance(pages, list):
                return "\n\n---\n\n".join(
                    page.get("markdown", "") or page.get("text", "")
                    for page in pages
                )
        
        # Elements structure
        if "elements" in result:
            elements = result["elements"]
            if isinstance(elements, list):
                parts = []
                for elem in elements:
                    elem_type = elem.get("type", "")
                    content = elem.get("content", "") or elem.get("text", "")
                    
                    if elem_type == "heading":
                        level = elem.get("level", 1)
                        parts.append(f"{'#' * level} {content}")
                    elif elem_type == "table":
                        parts.append(elem.get("markdown", content))
                    else:
                        parts.append(content)
                
                return "\n\n".join(parts)
        
        # Text field as fallback
        if "text" in result:
            return result["text"]
        
        # Last resort: stringify the result
        logger.warning(f"[Reducto] Unexpected result structure: {list(result.keys())}")
        return str(result)
    
    async def health_check(self) -> bool:
        """Check if Reducto is properly configured."""
        if not self._api_key:
            return False
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Try to hit a health or info endpoint
                response = await client.get(
                    f"{self._base_url}/health",
                    headers=self._get_headers(),
                )
                return response.status_code in (200, 404)  # 404 means API is up but endpoint doesn't exist
        except Exception as e:
            logger.warning(f"[Reducto] Health check failed: {e}")
            return False


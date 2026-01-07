"""
Firecrawl client wrapper
Provides async-friendly interface to Firecrawl scraping API
"""

import os
from typing import Optional, Dict, Any
from src.utils.logger import log_info, log_warning, log_error


class FirecrawlClient:
    """Async wrapper for Firecrawl scraping service"""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Firecrawl client

        Args:
            api_key: Firecrawl API key, defaults to FIRECRAWL_API_KEY env var
        """
        self.api_key = api_key or os.environ.get("FIRECRAWL_API_KEY")
        self._client = None

        if not self.api_key:
            log_warning("FIRECRAWL_API_KEY not found, Firecrawl scraping will be disabled")

    def is_available(self) -> bool:
        """Check if Firecrawl is available (API key is set)"""
        return self.api_key is not None

    async def scrape_url(
        self,
        url: str,
        formats: list[str] = None,
        only_main_content: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """
        Scrape a URL using Firecrawl

        Args:
            url: URL to scrape
            formats: Output formats (e.g. ["markdown", "html"])
            only_main_content: Extract only main content

        Returns:
            Dictionary with scraped data or None if unavailable/failed
        """
        if not self.is_available():
            log_warning("Firecrawl not available, API key missing")
            return None

        try:
            # Import here to avoid errors when firecrawl-py is not installed
            from firecrawl import AsyncFirecrawl

            # Initialize client if needed
            if self._client is None:
                self._client = AsyncFirecrawl(api_key=self.api_key)

            # Default to markdown for cleaner parsing
            if formats is None:
                formats = ["markdown"]

            log_info(f"Scraping URL with Firecrawl: {url}")

            # Call Firecrawl API
            result = await self._client.scrape(
                url,
                formats=formats,
                only_main_content=only_main_content,
            )

            log_info(f"Successfully scraped URL with Firecrawl: {url}")
            
            # Convert Document object to dict if needed
            if hasattr(result, 'model_dump'):
                # Pydantic v2 model
                return result.model_dump()
            elif hasattr(result, 'dict'):
                # Pydantic v1 model
                return result.dict()
            elif isinstance(result, dict):
                # Already a dict
                return result
            else:
                # Try to convert to dict
                return dict(result) if result else None

        except ImportError:
            log_error("firecrawl-py not installed, falling back to BeautifulSoup")
            return None
        except Exception as e:
            log_error(f"Firecrawl scraping failed for {url}: {e}")
            return None

    async def close(self):
        """Clean up resources"""
        # AsyncFirecrawl doesn't require explicit cleanup
        self._client = None


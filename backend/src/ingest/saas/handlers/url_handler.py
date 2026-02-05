"""
URL Handler - Process generic URL imports via Firecrawl.

Handles:
- Single page scraping
- Multi-page crawling (with crawl_options)
"""

from typing import Any, Dict, Optional

from src.content_node.service import ContentNodeService
from src.ingest.saas.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.ingest.saas.task.models import ImportTask, ImportTaskType
from src.ingest.saas.utils.url_parser import UrlParser
from src.utils.logger import log_info, log_error


class UrlHandler(BaseHandler):
    """Handler for generic URL imports using Firecrawl."""

    def __init__(
        self,
        node_service: ContentNodeService,
    ):
        self.node_service = node_service
        self.url_parser = UrlParser()

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.URL

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process URL import using Firecrawl."""
        if not task.source_url:
            raise ValueError("source_url is required for URL import")

        await on_progress(10, "Fetching URL content...")

        try:
            # Parse URL with optional crawl options
            crawl_options = task.metadata.get("crawl_options") if task.metadata else None
            result = await self.url_parser.parse(task.source_url, crawl_options)

            await on_progress(50, "Processing content...")

            data = result.get("data", [])
            title = result.get("title", task.source_url)
            source_type = result.get("source_type", "url")

            await on_progress(70, "Creating content node...")

            # Build markdown content from sections
            markdown_parts = []
            for item in data:
                item_title = item.get("title", "")
                item_content = item.get("content", "")
                if item_title:
                    markdown_parts.append(f"## {item_title}\n\n{item_content}")
                elif item_content:
                    markdown_parts.append(item_content)

            markdown_content = "\n\n".join(markdown_parts)

            # Create markdown content node
            # Note: metadata (source_url, source_type, etc.) is logged but not stored in node
            log_info(f"URL import metadata: source_url={task.source_url}, source_type={source_type}, sections={len(data)}")
            node = await self.node_service.create_markdown_node(
                project_id=task.project_id,
                name=title,
                content=markdown_content,
                parent_id=task.parent_node_id,
                created_by=task.user_id,
            )

            await on_progress(100, "Completed")
            log_info(f"URL import completed: {task.source_url}, {len(data)} sections")

            return ImportResult(
                content_node_id=node.id,
                items_count=len(data),
                metadata={"source_url": task.source_url, "title": title},
            )

        except Exception as e:
            log_error(f"URL import failed: {e}")
            raise
        finally:
            await self.url_parser.close()

    async def preview(self, url: str, user_id: str, crawl_options: Optional[Dict[str, Any]] = None) -> PreviewResult:
        """
        Get preview data for a URL using Firecrawl.
        
        Args:
            url: The URL to preview
            user_id: User ID (not used for generic URLs)
            crawl_options: Optional crawl settings for multi-page crawl
        """
        try:
            result = await self.url_parser.parse(url, crawl_options)

            data = result.get("data", [])
            source_type = result.get("source_type", "url")
            title = result.get("title", url)

            # Analyze fields from first item
            fields = []
            if data and isinstance(data[0], dict):
                fields = [
                    {"name": key, "type": type(value).__name__}
                    for key, value in data[0].items()
                ]

            return PreviewResult(
                source_type=source_type,
                title=title,
                description=result.get("description"),
                data=data[:5],  # Limit preview
                fields=fields,
                total_items=len(data),
                structure_info=result.get("crawl_info"),
            )
        finally:
            await self.url_parser.close()

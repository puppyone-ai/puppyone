"""
URL Connector - Process generic URL imports via Firecrawl.

Handles:
- Single page scraping
- Multi-page crawling (with crawl_options)
"""

import hashlib
import json

from src.content_node.service import ContentNodeService
from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
    ConfigField,
)
from src.sync.utils.url_parser import UrlParser


class UrlConnector(BaseConnector):
    """Connector for generic URL imports using Firecrawl."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="url",
            display_name="Web Page",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="json",
            auth=AuthRequirement.NONE,
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="import_once",
            creation_mode="direct",
            description="Import content from a URL",
            accept_types=("folder",),
            config_fields=(
                ConfigField(
                    key="source_url",
                    label="URL",
                    type="url",
                    required=True,
                    placeholder="https://example.com",
                ),
            ),
            icon="🌐",
        )

    def __init__(
        self,
        node_service: ContentNodeService,
    ):
        self.node_service = node_service
        self.url_parser = UrlParser()

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Scrape a URL via Firecrawl. No OAuth needed — credentials are ignored."""
        source_url = config.get("source_url", "")
        if not source_url:
            raise ValueError("source_url is required for URL fetch")

        url_parser = UrlParser()
        try:
            crawl_options = config.get("crawl_options")
            result = await url_parser.parse(source_url, crawl_options)

            data = result.get("data", [])
            title = result.get("title", source_url)

            markdown_parts = []
            for item in data:
                item_title = item.get("title", "")
                item_content = item.get("content", "")
                if item_title:
                    markdown_parts.append(f"## {item_title}\n\n{item_content}")
                elif item_content:
                    markdown_parts.append(item_content)

            markdown_content = "\n\n".join(markdown_parts)

            content_hash = hashlib.sha256(
                json.dumps(markdown_content, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()[:16]

            return FetchResult(
                content=markdown_content,
                content_hash=content_hash,
                node_type="markdown",
                node_name=title[:100],
                summary=f"Scraped {source_url} ({len(data)} sections)",
            )
        finally:
            await url_parser.close()

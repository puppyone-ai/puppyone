"""
Notion Connector - Process Notion page/database imports.

Migrated from connect/providers/notion_provider.py
"""

import hashlib
import json
import re
from typing import Any, List, Optional

import httpx

from src.content_node.service import ContentNodeService
from src.oauth.notion_service import NotionOAuthService
from src.s3.service import S3Service
from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
)


class NotionConnector(BaseConnector):
    """Connector for Notion imports (pages and databases)."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="notion",
            display_name="Notion",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="notion",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="manual",
        )

    def __init__(
        self,
        node_service: ContentNodeService,
        s3_service: S3Service,
        notion_service: Optional[NotionOAuthService] = None,
    ):
        self.node_service = node_service
        self.s3_service = s3_service
        self.notion_service = notion_service or NotionOAuthService()
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Pull data from Notion. Returns database JSON or page markdown."""
        access_token = credentials.access_token
        source_url = config.get("source_url", "")

        entity_id = self._extract_notion_id(source_url)
        if not entity_id:
            raise ValueError(f"Could not extract Notion ID from URL: {source_url}")

        is_database = self._is_database_url(source_url)
        headers = self._get_headers(access_token)

        try:
            if is_database:
                return await self._fetch_database(entity_id, headers)
            else:
                return await self._fetch_page(entity_id, headers)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                error_message = e.response.json().get("message", "")
                if "is a page, not a database" in error_message and is_database:
                    return await self._fetch_page(entity_id, headers)
                elif "is a database, not a page" in error_message and not is_database:
                    return await self._fetch_database(entity_id, headers)
            raise

    async def _fetch_database(self, database_id: str, headers: dict) -> FetchResult:
        """Fetch database metadata + rows without creating nodes."""
        db_info_url = f"https://api.notion.com/v1/databases/{database_id}"
        db_response = await self.client.get(db_info_url, headers=headers)
        db_response.raise_for_status()
        database_info = db_response.json()

        title = "Untitled Database"
        title_info = database_info.get("title", [])
        if title_info and isinstance(title_info, list) and title_info:
            title_parts = title_info[0].get("plain_text", "")
            if title_parts:
                title = title_parts

        query_url = f"https://api.notion.com/v1/databases/{database_id}/query"
        all_rows = []
        has_more = True
        next_cursor = None

        while has_more:
            body = {}
            if next_cursor:
                body["start_cursor"] = next_cursor
            response = await self.client.post(query_url, json=body, headers=headers)
            response.raise_for_status()
            data = response.json()
            all_rows.extend(data.get("results", []))
            has_more = data.get("has_more", False)
            next_cursor = data.get("next_cursor")

        properties = database_info.get("properties", {})
        rows = []
        fields = set()
        for result in all_rows:
            row = {}
            for prop_name, prop_data in result.get("properties", {}).items():
                value = self._extract_property_value(prop_data)
                if value is not None:
                    row[prop_name] = value
                    fields.add(prop_name)
            if row:
                rows.append(row)

        field_definitions = []
        for field_name in sorted(fields):
            field_info = properties.get(field_name, {})
            field_type = self._infer_field_type(field_info.get("type", "text"))
            field_definitions.append({"name": field_name, "type": field_type, "nullable": True})

        content = {
            "source_type": "notion_database",
            "title": title,
            "database_id": database_id,
            "total_rows": len(rows),
            "fields": field_definitions,
            "data": rows,
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=title,
            summary=f"Notion database '{title}' with {len(rows)} rows",
        )

    async def _fetch_page(self, page_id: str, headers: dict) -> FetchResult:
        """Fetch page + blocks and convert to markdown without creating nodes."""
        page_url = f"https://api.notion.com/v1/pages/{page_id}"
        response = await self.client.get(page_url, headers=headers)
        response.raise_for_status()
        page_data = response.json()

        title = "Untitled Page"
        properties = page_data.get("properties", {})
        for prop_name, prop_data in properties.items():
            if prop_data.get("type") == "title":
                title_info = prop_data.get("title", [])
                if title_info and isinstance(title_info, list):
                    title_parts = [t.get("plain_text", "") for t in title_info if t.get("plain_text")]
                    if title_parts:
                        title = " ".join(title_parts)
                break

        blocks_url = f"https://api.notion.com/v1/blocks/{page_id}/children"
        all_blocks = []
        has_more = True
        next_cursor = None

        while has_more:
            url = blocks_url
            if next_cursor:
                url += f"?start_cursor={next_cursor}"
            blocks_response = await self.client.get(url, headers=headers)
            blocks_response.raise_for_status()
            blocks_data = blocks_response.json()
            all_blocks.extend(blocks_data.get("results", []))
            has_more = blocks_data.get("has_more", False)
            next_cursor = blocks_data.get("next_cursor")

        markdown_content = self._blocks_to_markdown(all_blocks)
        content_hash = hashlib.sha256(markdown_content.encode()).hexdigest()[:16]

        return FetchResult(
            content=markdown_content,
            content_hash=content_hash,
            node_type="markdown",
            node_name=title,
            summary=f"Notion page '{title}'",
        )

    def _get_headers(self, access_token: str) -> dict:
        """Build Notion API headers."""
        return {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        }

    def _extract_notion_id(self, url: str) -> Optional[str]:
        """Extract Notion page or database ID from URL."""
        # Pattern to match Notion IDs (32-character hex string)
        pattern = r"([a-f0-9]{32})"
        matches = re.findall(pattern, url)
        return matches[0] if matches else None

    def _is_database_url(self, url: str) -> bool:
        """Determine if URL points to a database view."""
        return "?v=" in url or "&v=" in url

    def _extract_property_value(self, prop_data: dict) -> Any:
        """Extract value from Notion property."""
        prop_type = prop_data.get("type")

        if prop_type == "title":
            title_data = prop_data.get("title", [])
            return " ".join([t.get("plain_text", "") for t in title_data if t.get("plain_text")])

        elif prop_type == "rich_text":
            rich_text_data = prop_data.get("rich_text", [])
            return " ".join([t.get("plain_text", "") for t in rich_text_data if t.get("plain_text")])

        elif prop_type == "select":
            select_data = prop_data.get("select")
            return select_data.get("name") if select_data else None

        elif prop_type == "multi_select":
            multi_select_data = prop_data.get("multi_select", [])
            return ", ".join([s.get("name", "") for s in multi_select_data if s.get("name")])

        elif prop_type == "number":
            return prop_data.get("number")

        elif prop_type == "checkbox":
            return prop_data.get("checkbox", False)

        elif prop_type == "date":
            date_data = prop_data.get("date")
            return date_data.get("start") if date_data else None

        elif prop_type in ("person", "people"):
            people_data = prop_data.get(prop_type, [])
            names = [p.get("name", "") for p in people_data if p.get("name")]
            return ", ".join(names) if names else None

        elif prop_type == "url":
            return prop_data.get("url")

        elif prop_type == "email":
            return prop_data.get("email")

        elif prop_type == "phone_number":
            return prop_data.get("phone_number")

        elif prop_type == "status":
            status_data = prop_data.get("status")
            return status_data.get("name") if status_data else None

        else:
            return None

    def _infer_field_type(self, notion_type: str) -> str:
        """Infer field type from Notion property type."""
        type_mapping = {
            "title": "string",
            "rich_text": "text",
            "select": "string",
            "multi_select": "string",
            "number": "number",
            "checkbox": "boolean",
            "date": "datetime",
            "person": "string",
            "people": "string",
            "url": "string",
            "email": "string",
            "phone_number": "string",
            "status": "string",
            "files": "string",
            "formula": "string",
            "relation": "string",
            "rollup": "string",
            "created_time": "datetime",
            "created_by": "string",
            "last_edited_time": "datetime",
            "last_edited_by": "string",
        }
        return type_mapping.get(notion_type, "string")

    def _blocks_to_markdown(self, blocks: List[dict]) -> str:
        """Convert Notion blocks to Markdown."""
        content_parts = []

        for block in blocks:
            block_type = block.get("type")
            if not block_type:
                continue

            block_data = block.get(block_type, {})

            # Extract rich text helper
            def get_text(rich_text_list):
                return " ".join([t.get("plain_text", "") for t in rich_text_list if t.get("plain_text")])

            if block_type == "paragraph":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(text)

            elif block_type == "heading_1":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"# {text}")

            elif block_type == "heading_2":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"## {text}")

            elif block_type == "heading_3":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"### {text}")

            elif block_type == "bulleted_list_item":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"- {text}")

            elif block_type == "numbered_list_item":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"1. {text}")

            elif block_type == "to_do":
                text = get_text(block_data.get("rich_text", []))
                checked = block_data.get("checked", False)
                if text:
                    checkbox = "[x]" if checked else "[ ]"
                    content_parts.append(f"- {checkbox} {text}")

            elif block_type == "toggle":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"> {text}")

            elif block_type == "code":
                text = "\n".join([t.get("plain_text", "") for t in block_data.get("rich_text", []) if t.get("plain_text")])
                if text:
                    language = block_data.get("language", "")
                    content_parts.append(f"```{language}\n{text}\n```")

            elif block_type == "quote":
                text = get_text(block_data.get("rich_text", []))
                if text:
                    content_parts.append(f"> {text}")

            elif block_type == "callout":
                text = get_text(block_data.get("rich_text", []))
                icon = block_data.get("icon", {}).get("emoji", "💡")
                if text:
                    content_parts.append(f"> {icon} {text}")

            elif block_type == "divider":
                content_parts.append("---")

            elif block_type == "image":
                image_data = block_data.get("external", {}) or block_data.get("file", {})
                url = image_data.get("url", "")
                caption = get_text(block_data.get("caption", []))
                if url:
                    content_parts.append(f"![{caption}]({url})")

            elif block_type == "bookmark":
                url = block_data.get("url", "")
                caption = get_text(block_data.get("caption", []))
                if url:
                    content_parts.append(f"[{caption or url}]({url})")

        return "\n\n".join(content_parts)

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

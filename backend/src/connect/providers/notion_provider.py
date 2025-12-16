"""Notion provider for parsing Notion databases and pages."""

import re
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlparse
import httpx

from src.connect.data_provider import DataProvider, DataProviderResult
from src.connect.exceptions import AuthenticationError
from src.oauth.notion_service import NotionOAuthService


class NotionProvider(DataProvider):
    """Provider for Notion data sources."""

    def __init__(self, user_id: str, notion_service: Optional[NotionOAuthService] = None):
        self.user_id = user_id
        self.notion_service = notion_service or NotionOAuthService()
        self.client = httpx.AsyncClient()

    async def can_handle(self, url: str) -> bool:
        """Check if the URL is a Notion URL."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Handle both notion.so and notion.site domains
        return domain in ["notion.so", "notion.site"] or domain.endswith(".notion.so") or domain.endswith(".notion.site")

    async def fetch_data(self, url: str) -> DataProviderResult:
        """Fetch data from Notion URL."""
        # Check if user has Notion connection
        connection = await self.notion_service.get_connection(self.user_id)
        if not connection:
            raise AuthenticationError(
                "Not connected to Notion. Please authorize your Notion account first.",
                provider="notion",
                requires_auth=True
            )

        # Check if token is expired and refresh if needed
        if await self.notion_service.is_token_expired(self.user_id):
            connection = await self.notion_service.refresh_token_if_needed(self.user_id)
            if not connection:
                raise AuthenticationError(
                    "Notion authorization expired. Please reconnect your Notion account.",
                    provider="notion",
                    requires_auth=True
                )

        # Extract page or database ID from URL
        entity_id = self._extract_notion_id(url)
        if not entity_id:
            raise ValueError(f"Could not extract Notion ID from URL: {url}")

        # Determine if it's a database or page
        is_database = self._is_database_url(url)

        try:
            if is_database:
                return await self._fetch_database(entity_id, connection.access_token)
            else:
                return await self._fetch_page(entity_id, connection.access_token)
        except httpx.HTTPStatusError as e:
            if e.response.status_code in [401, 403]:
                raise AuthenticationError(
                    "Notion authorization failed. Please reconnect your Notion account.",
                    provider="notion",
                    requires_auth=True
                )
            
            # If we got a 400 error saying it's a page when we tried database (or vice versa), retry with the other type
            if e.response.status_code == 400:
                try:
                    error_data = e.response.json()
                    error_message = error_data.get("message", "")
                    
                    # If we tried database but it's actually a page
                    if "is a page, not a database" in error_message and is_database:
                        return await self._fetch_page(entity_id, connection.access_token)
                    
                    # If we tried page but it's actually a database
                    elif "is a database, not a page" in error_message and not is_database:
                        return await self._fetch_database(entity_id, connection.access_token)
                except:
                    pass
            
            raise ValueError(f"Failed to fetch Notion data: {e.response.status_code} - {e.response.text}")

    async def _fetch_database(self, database_id: str, access_token: str) -> DataProviderResult:
        """Fetch Notion database content."""
        # Query the database
        query_url = f"https://api.notion.com/v1/databases/{database_id}/query"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
        }

        response = await self.client.post(query_url, json={}, headers=headers)
        response.raise_for_status()

        data = response.json()

        # Get database info
        database_info_url = f"https://api.notion.com/v1/databases/{database_id}"
        db_response = await self.client.get(database_info_url, headers=headers)
        db_response.raise_for_status()
        database_info = db_response.json()

        # Extract properties
        properties = database_info.get("properties", {})
        title_info = database_info.get("title", [])

        # Get database title
        title = "Untitled Database"
        if title_info and isinstance(title_info, list) and title_info:
            title_parts = title_info[0].get("plain_text", "")
            if title_parts:
                title = title_parts

        # Convert database rows to structured data
        rows = []
        fields = set()

        for result in data.get("results", []):
            row = {}
            for prop_name, prop_data in result.get("properties", {}).items():
                value = self._extract_property_value(prop_data)
                if value is not None:
                    row[prop_name] = value
                    fields.add(prop_name)

            if row:  # Only add non-empty rows
                rows.append(row)

        # Create field definitions
        field_definitions = []
        for field_name in sorted(fields):
            field_info = properties.get(field_name, {})
            field_type = self._infer_field_type(field_info.get("type", "text"))
            field_definitions.append({
                "name": field_name,
                "type": field_type,
                "nullable": True,
                "description": f"Notion {field_info.get('type', 'text')} property"
            })

        return DataProviderResult(
            source_type="notion_database",
            title=title,
            description=f"Notion database: {title}",
            data=rows,
            fields=field_definitions,
            structure_info={
                "type": "database",
                "total_rows": len(rows),
                "total_fields": len(field_definitions),
                "database_id": database_id,
                "has_more": data.get("has_more", False)
            }
        )

    async def _fetch_page(self, page_id: str, access_token: str) -> DataProviderResult:
        """Fetch Notion page content."""
        # Get page content
        page_url = f"https://api.notion.com/v1/pages/{page_id}"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28"
        }

        response = await self.client.get(page_url, headers=headers)
        response.raise_for_status()

        page_data = response.json()

        # Get page blocks for content
        blocks_url = f"https://api.notion.com/v1/blocks/{page_id}/children"
        blocks_response = await self.client.get(blocks_url, headers=headers)
        blocks_response.raise_for_status()

        blocks_data = blocks_response.json()

        # Extract page title
        title = "Untitled Page"
        properties = page_data.get("properties", {})

        # Try to get title from properties
        for prop_name, prop_data in properties.items():
            if prop_data.get("type") == "title":
                title_info = prop_data.get("title", [])
                if title_info and isinstance(title_info, list):
                    title_parts = [t.get("plain_text", "") for t in title_info if t.get("plain_text")]
                    if title_parts:
                        title = " ".join(title_parts)
                break

        # Extract content from blocks
        content = self._extract_blocks_content(blocks_data.get("results", []))

        # Create a structured representation of the page
        structured_content = [{
            "id": page_id,
            "title": title,
            "content": content,
            "created_time": page_data.get("created_time"),
            "last_edited_time": page_data.get("last_edited_time"),
            "url": page_data.get("url")
        }]

        # Define fields for page data
        field_definitions = [
            {
                "name": "id",
                "type": "string",
                "nullable": False,
                "description": "Page ID"
            },
            {
                "name": "title",
                "type": "string",
                "nullable": False,
                "description": "Page title"
            },
            {
                "name": "content",
                "type": "text",
                "nullable": True,
                "description": "Page content"
            },
            {
                "name": "created_time",
                "type": "datetime",
                "nullable": True,
                "description": "Page creation time"
            },
            {
                "name": "last_edited_time",
                "type": "datetime",
                "nullable": True,
                "description": "Last edit time"
            }
        ]

        return DataProviderResult(
            source_type="notion_page",
            title=title,
            description=f"Notion page: {title}",
            data=structured_content,
            fields=field_definitions,
            structure_info={
                "type": "page",
                "total_blocks": len(blocks_data.get("results", [])),
                "page_id": page_id,
                "has_more": blocks_data.get("has_more", False)
            }
        )

    def _extract_notion_id(self, url: str) -> Optional[str]:
        """Extract Notion page or database ID from URL."""
        # Pattern to match Notion IDs (32-character hex string)
        pattern = r'([a-f0-9]{32})'
        matches = re.findall(pattern, url)
        return matches[0] if matches else None

    def _is_database_url(self, url: str) -> bool:
        """Determine if URL points to a database view."""
        # Notion database URLs typically contain "?v=" (view parameter)
        # Check for the view parameter specifically, not just any query parameter
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

        elif prop_type == "person":
            person_data = prop_data.get("person", [])
            names = [p.get("name", "") for p in person_data if p.get("name")]
            return ", ".join(names) if names else None

        elif prop_type == "people":
            people_data = prop_data.get("people", [])
            names = [p.get("name", "") for p in people_data if p.get("name")]
            return ", ".join(names) if names else None

        elif prop_type == "url":
            return prop_data.get("url")

        elif prop_type == "email":
            return prop_data.get("email")

        elif prop_type == "phone":
            return prop_data.get("phone")

        else:
            # Default: return string representation
            return str(prop_data)

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
            "phone": "string",
            "files": "string",
            "formula": "string",
            "relation": "string",
            "rollup": "string",
            "created_time": "datetime",
            "created_by": "string",
            "last_edited_time": "datetime",
            "last_edited_by": "string"
        }
        return type_mapping.get(notion_type, "string")

    def _extract_blocks_content(self, blocks: List[dict]) -> str:
        """Extract text content from Notion blocks."""
        content_parts = []

        for block in blocks:
            block_type = block.get("type")
            if not block_type:
                continue

            block_data = block.get(block_type, {})

            if block_type == "paragraph":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(text)

            elif block_type == "heading_1":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"# {text}")

            elif block_type == "heading_2":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"## {text}")

            elif block_type == "heading_3":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"### {text}")

            elif block_type == "bulleted_list_item":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"• {text}")

            elif block_type == "numbered_list_item":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"1. {text}")

            elif block_type == "to_do":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                checked = block_data.get("checked", False)
                if text:
                    checkbox = "☑" if checked else "☐"
                    content_parts.append(f"{checkbox} {text}")

            elif block_type == "toggle":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"> {text}")

            elif block_type == "code":
                rich_text = block_data.get("rich_text", [])
                text = "\n".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    language = block_data.get("language", "")
                    content_parts.append(f"```{language}\n{text}\n```")

            elif block_type == "quote":
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text if t.get("plain_text")])
                if text:
                    content_parts.append(f"> {text}")

        return "\n\n".join(content_parts)

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
        if self.notion_service:
            await self.notion_service.close()
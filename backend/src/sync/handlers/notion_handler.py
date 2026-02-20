"""
Notion Handler - Process Notion page/database imports.

Migrated from connect/providers/notion_provider.py
"""

import re
import json
from typing import Any, List, Optional
from urllib.parse import urlparse
import httpx

from src.config import settings
from src.content_node.service import ContentNodeService
from src.oauth.notion_service import NotionOAuthService
from src.s3.service import S3Service
from src.sync.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.sync.task.models import ImportTask, ImportTaskType
from src.utils.logger import log_info, log_error


class NotionHandler(BaseHandler):
    """Handler for Notion imports (pages and databases)."""

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

    def can_handle(self, task: ImportTask) -> bool:
        """Check if this handler can process the given task."""
        return task.task_type in (ImportTaskType.NOTION, ImportTaskType.NOTION_DATABASE)

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Notion import (page or database)."""
        try:
            await on_progress(10, "Getting Notion access token...")
            access_token = await self._get_access_token(task.user_id)

            await on_progress(20, "Extracting Notion ID from URL...")
            entity_id = self._extract_notion_id(task.source_url)
            if not entity_id:
                raise ValueError(f"Could not extract Notion ID from URL: {task.source_url}")

            is_database = self._is_database_url(task.source_url)
            
            await on_progress(30, f"Fetching Notion {'database' if is_database else 'page'}...")
            
            try:
                if is_database:
                    result = await self._fetch_and_save_database(
                        task, entity_id, access_token, on_progress
                    )
                else:
                    result = await self._fetch_and_save_page(
                        task, entity_id, access_token, on_progress
                    )
            except httpx.HTTPStatusError as e:
                # Handle 400 error - might be wrong type detection
                if e.response.status_code == 400:
                    error_data = e.response.json()
                    error_message = error_data.get("message", "")
                    
                    if "is a page, not a database" in error_message and is_database:
                        log_info(f"Retrying as page instead of database: {task.source_url}")
                        result = await self._fetch_and_save_page(
                            task, entity_id, access_token, on_progress
                        )
                    elif "is a database, not a page" in error_message and not is_database:
                        log_info(f"Retrying as database instead of page: {task.source_url}")
                        result = await self._fetch_and_save_database(
                            task, entity_id, access_token, on_progress
                        )
                    else:
                        raise
                elif e.response.status_code in [401, 403]:
                    raise ValueError(
                        "Notion authorization failed. Please check:\n"
                        "1. Your Notion integration has access to this page/database\n"
                        "2. In Notion, click '...' → 'Connect to' → Select your integration"
                    )
                else:
                    raise

            await on_progress(100, "Notion import completed!")
            return result

        except Exception as e:
            log_error(f"Notion import failed: {e}")
            raise

    async def _get_access_token(self, user_id: str) -> str:
        """Get access token (API Key or OAuth)."""
        # Method 1: Internal Integration API Key
        if settings.NOTION_API_KEY:
            return settings.NOTION_API_KEY
        
        # Method 2: OAuth token
        connection = await self.notion_service.get_connection(user_id)
        if not connection:
            raise ValueError(
                "Not connected to Notion. Please authorize your Notion account first, "
                "or configure NOTION_API_KEY in backend .env file."
            )

        # Refresh token if needed
        if await self.notion_service.is_token_expired(user_id):
            connection = await self.notion_service.refresh_token_if_needed(user_id)
            if not connection:
                raise ValueError(
                    "Notion authorization expired. Please reconnect your Notion account."
                )
        
        return connection.access_token

    async def _fetch_and_save_database(
        self,
        task: ImportTask,
        database_id: str,
        access_token: str,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Fetch Notion database and save as content node."""
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        }

        # Get database info
        await on_progress(40, "Fetching database metadata...")
        db_info_url = f"https://api.notion.com/v1/databases/{database_id}"
        db_response = await self.client.get(db_info_url, headers=headers)
        db_response.raise_for_status()
        database_info = db_response.json()

        # Extract title
        title = "Untitled Database"
        title_info = database_info.get("title", [])
        if title_info and isinstance(title_info, list) and title_info:
            title_parts = title_info[0].get("plain_text", "")
            if title_parts:
                title = title_parts

        # Query all rows
        await on_progress(50, "Fetching database rows...")
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

        await on_progress(70, f"Processing {len(all_rows)} rows...")

        # Convert rows to structured data
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

        # Build field definitions
        field_definitions = []
        for field_name in sorted(fields):
            field_info = properties.get(field_name, {})
            field_type = self._infer_field_type(field_info.get("type", "text"))
            field_definitions.append({
                "name": field_name,
                "type": field_type,
                "nullable": True,
            })

        await on_progress(80, "Saving to database...")

        # Save data to S3 if large
        data_content = {
            "source_type": "notion_database",
            "title": title,
            "database_id": database_id,
            "total_rows": len(rows),
            "fields": field_definitions,
            "data": rows,
        }

        s3_key = None
        if len(rows) > 100:
            # Large data - save to S3
            s3_key = f"notion/{task.user_id}/{task.project_id}/{database_id}.json"
            await self.s3_service.upload_json(s3_key, data_content)

        # Build sync_config from task.config
        sync_config = {
            k: v for k, v in task.config.items()
            if k in ("recursive", "max_depth", "include_databases")
        } or None
        
        # Create content node using create_synced_node
        content_node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=title,
            node_type="notion",
            sync_url=task.source_url,
            content=data_content,
            sync_id=database_id,
            sync_config={**sync_config, "import_type": "database"} if sync_config else {"import_type": "database"},
            created_by=task.user_id,
        )

        return ImportResult(
            content_node_id=str(content_node.id),
            items_count=len(rows),
        )

    async def _fetch_and_save_page(
        self,
        task: ImportTask,
        page_id: str,
        access_token: str,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Fetch Notion page and save as content node."""
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
        }

        # Get page info
        await on_progress(40, "Fetching page metadata...")
        page_url = f"https://api.notion.com/v1/pages/{page_id}"
        response = await self.client.get(page_url, headers=headers)
        response.raise_for_status()
        page_data = response.json()

        # Extract title
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

        # Get page blocks
        await on_progress(50, "Fetching page content...")
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

        await on_progress(70, "Converting to Markdown...")
        
        # Convert blocks to Markdown
        markdown_content = self._blocks_to_markdown(all_blocks)

        await on_progress(80, "Saving to database...")

        # Build sync_config from task.config
        sync_config = {
            k: v for k, v in task.config.items()
            if k in ("recursive", "max_depth", "include_databases")
        } or None
        
        # Create content node using create_synced_markdown_node
        content_node = await self.node_service.create_synced_markdown_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=title,
            content=markdown_content,
            node_type="notion",
            sync_url=task.source_url,
            sync_id=page_id,
            sync_config={**sync_config, "import_type": "page"} if sync_config else {"import_type": "page"},
            created_by=task.user_id,
        )

        return ImportResult(
            content_node_id=str(content_node.id),
            items_count=1,
        )

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

    # ==================== Preview Functionality ====================

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """
        Get preview data for a Notion URL without importing.
        
        Supports pages and databases.
        """
        access_token = await self._get_access_token(user_id)
        entity_id = self._extract_notion_id(url)
        if not entity_id:
            raise ValueError(f"Could not extract Notion ID from URL: {url}")

        is_database = self._is_database_url(url)

        try:
            if is_database:
                return await self._preview_database(entity_id, access_token)
            else:
                return await self._preview_page(entity_id, access_token)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                error_data = e.response.json()
                error_message = error_data.get("message", "")
                if "is a page, not a database" in error_message and is_database:
                    return await self._preview_page(entity_id, access_token)
                elif "is a database, not a page" in error_message and not is_database:
                    return await self._preview_database(entity_id, access_token)
            elif e.response.status_code in [401, 403]:
                raise ValueError("Notion authorization failed. Please reconnect.")
            raise ValueError(f"Notion API error: {e.response.status_code}")

    async def _preview_database(self, database_id: str, access_token: str) -> PreviewResult:
        """Get preview for a Notion database."""
        headers = self._get_headers(access_token)

        # Get database metadata
        meta_url = f"https://api.notion.com/v1/databases/{database_id}"
        meta_resp = await self.client.get(meta_url, headers=headers)
        meta_resp.raise_for_status()
        db_meta = meta_resp.json()

        # Query first few rows
        query_url = f"https://api.notion.com/v1/databases/{database_id}/query"
        query_resp = await self.client.post(
            query_url,
            headers=headers,
            json={"page_size": 5}  # Just preview
        )
        query_resp.raise_for_status()
        query_data = query_resp.json()

        # Extract title
        title = "Untitled Database"
        title_prop = db_meta.get("title", [])
        if title_prop:
            title = self._extract_text(title_prop)

        # Extract properties/fields
        properties = db_meta.get("properties", {})
        fields = [
            {"name": name, "type": prop.get("type", "unknown")}
            for name, prop in properties.items()
        ]

        # Convert rows to preview data
        data = []
        for page in query_data.get("results", []):
            row = {}
            page_props = page.get("properties", {})
            for prop_name, prop_value in page_props.items():
                row[prop_name] = self._extract_property_value(prop_value)
            data.append(row)

        return PreviewResult(
            source_type="notion_database",
            title=title,
            description=db_meta.get("description", [{}])[0].get("plain_text") if db_meta.get("description") else None,
            data=data,
            fields=fields,
            total_items=len(query_data.get("results", [])),
            structure_info={
                "type": "database",
                "id": database_id,
                "properties_count": len(properties),
            },
        )

    async def _preview_page(self, page_id: str, access_token: str) -> PreviewResult:
        """Get preview for a Notion page."""
        headers = self._get_headers(access_token)

        # Get page metadata
        page_url = f"https://api.notion.com/v1/pages/{page_id}"
        page_resp = await self.client.get(page_url, headers=headers)
        page_resp.raise_for_status()
        page_data = page_resp.json()

        # Get first few blocks for preview
        blocks_url = f"https://api.notion.com/v1/blocks/{page_id}/children"
        blocks_resp = await self.client.get(blocks_url, headers=headers, params={"page_size": 10})
        blocks_resp.raise_for_status()
        blocks_data = blocks_resp.json()

        # Extract title
        title = "Untitled"
        props = page_data.get("properties", {})
        title_prop = props.get("title") or props.get("Name") or props.get("name")
        if title_prop:
            title_content = title_prop.get("title", [])
            if title_content:
                title = self._extract_text(title_content)

        # Convert blocks to preview text
        preview_text = []
        for block in blocks_data.get("results", [])[:5]:
            block_type = block.get("type")
            block_data = block.get(block_type, {})
            if "rich_text" in block_data:
                text = self._extract_text(block_data["rich_text"])
                if text:
                    preview_text.append(text)

        return PreviewResult(
            source_type="notion_page",
            title=title,
            description="\n".join(preview_text[:3]) if preview_text else None,
            data=[{"title": title, "content_preview": "\n\n".join(preview_text)}],
            fields=[{"name": "title", "type": "string"}, {"name": "content", "type": "text"}],
            total_items=1,
            structure_info={
                "type": "page",
                "id": page_id,
                "blocks_count": len(blocks_data.get("results", [])),
            },
        )

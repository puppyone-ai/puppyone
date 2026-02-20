"""
Google Sheets Handler - Process Google Sheets imports.

Architecture:
- All sheets are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.sheets[0].rows[] | select(.Column1 == "value")'
"""

from datetime import datetime, timezone
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.sync.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.sync.task.models import ImportTask, ImportTaskType
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class GoogleSheetsHandler(BaseHandler):
    """Handler for Google Sheets imports - stores all data in single JSONB node."""

    SHEETS_API_URL = "https://sheets.googleapis.com/v4/spreadsheets"

    def __init__(
        self,
        node_service: ContentNodeService,
        sheets_service: GoogleSheetsOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.sheets_service = sheets_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=60.0)

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.GOOGLE_SHEETS

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Google Sheets import - all data stored in single JSONB node."""
        await on_progress(5, "Checking Google Sheets connection...")

        # Get OAuth connection
        connection = await self.sheets_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Google Sheets not connected. Please authorize first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "")

        config = task.config or {}
        source_url = task.source_url or ""
        parent_id = config.get("parent_id")
        
        # Extract spreadsheet ID from URL
        spreadsheet_id = self._extract_spreadsheet_id(source_url)
        if not spreadsheet_id:
            raise ValueError(f"Could not extract spreadsheet ID from URL: {source_url}")

        await on_progress(10, "Fetching spreadsheet metadata...")

        # Get spreadsheet metadata
        spreadsheet = await self._get_spreadsheet(access_token, spreadsheet_id)
        title = spreadsheet.get("properties", {}).get("title", "Untitled Spreadsheet")
        sheets_meta = spreadsheet.get("sheets", [])

        if not sheets_meta:
            raise ValueError("Spreadsheet has no sheets")

        await on_progress(20, f"Found {len(sheets_meta)} sheets in '{title}'...")

        # Process each sheet and collect data
        sheets_data = []
        total_rows = 0
        
        for idx, sheet in enumerate(sheets_meta):
            sheet_props = sheet.get("properties", {})
            sheet_title = sheet_props.get("title", f"Sheet{idx + 1}")
            sheet_id = sheet_props.get("sheetId", idx)
            
            progress = 20 + int((idx / len(sheets_meta)) * 70)
            await on_progress(progress, f"Processing sheet: {sheet_title}...")

            try:
                values = await self._get_sheet_values(access_token, spreadsheet_id, sheet_title)
                sheet_data = self._format_sheet_data(sheet_title, sheet_id, values)
                sheets_data.append(sheet_data)
                total_rows += sheet_data.get("row_count", 0)
            except Exception as e:
                log_error(f"Failed to process sheet {sheet_title}: {e}")
                # Still add sheet with error info
                sheets_data.append({
                    "name": sheet_title,
                    "sheet_id": sheet_id,
                    "error": str(e),
                    "headers": [],
                    "row_count": 0,
                    "rows": [],
                })

        # Build JSONB content
        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "google_sheets",
            "spreadsheet_id": spreadsheet_id,
            "spreadsheet_title": title,
            "spreadsheet_url": source_url,
            "sheet_count": len(sheets_data),
            "total_rows": total_rows,
            "sheets": sheets_data,
        }

        # Create single JSONB node
        node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=config.get("name") or title[:100],
            node_type="google_sheets",
            sync_url=source_url,
            content=content,
            parent_id=parent_id,
            sync_id=spreadsheet_id,
            sync_config={"import_type": "spreadsheet", "spreadsheet_id": spreadsheet_id},
            created_by=task.user_id,
        )

        await on_progress(100, "Google Sheets import completed")

        return ImportResult(
            content_node_id=node.id,
            items_count=total_rows,
        )

    async def _get_spreadsheet(self, access_token: str, spreadsheet_id: str) -> dict:
        """Get spreadsheet metadata."""
        response = await self.client.get(
            f"{self.SHEETS_API_URL}/{spreadsheet_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"fields": "properties.title,sheets.properties"},
        )
        response.raise_for_status()
        return response.json()

    async def _get_sheet_values(
        self,
        access_token: str,
        spreadsheet_id: str,
        sheet_title: str,
    ) -> list[list]:
        """Get values from a specific sheet."""
        import urllib.parse
        encoded_title = urllib.parse.quote(sheet_title, safe='')
        
        response = await self.client.get(
            f"{self.SHEETS_API_URL}/{spreadsheet_id}/values/{encoded_title}",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"valueRenderOption": "FORMATTED_VALUE"},
        )
        response.raise_for_status()
        return response.json().get("values", [])

    def _format_sheet_data(
        self,
        sheet_title: str,
        sheet_id: int,
        values: list[list],
    ) -> dict:
        """Format sheet data for JSONB storage."""
        if not values:
            return {
                "name": sheet_title,
                "sheet_id": sheet_id,
                "headers": [],
                "row_count": 0,
                "rows": [],
            }

        # First row is headers
        headers = [str(h) for h in values[0]] if values else []
        
        # Convert rows to list of dicts for easier querying
        rows = []
        max_rows = 1000  # Limit rows per sheet to prevent huge JSONB
        
        for row in values[1:max_rows + 1]:
            row_dict = {}
            for i, cell in enumerate(row):
                if i < len(headers):
                    row_dict[headers[i]] = str(cell) if cell else ""
                else:
                    row_dict[f"Column{i + 1}"] = str(cell) if cell else ""
            rows.append(row_dict)

        return {
            "name": sheet_title,
            "sheet_id": sheet_id,
            "headers": headers,
            "row_count": len(rows),
            "total_rows_in_source": len(values) - 1,
            "truncated": len(values) - 1 > max_rows,
            "rows": rows,
        }

    def _extract_spreadsheet_id(self, url: str) -> Optional[str]:
        """Extract spreadsheet ID from URL."""
        import re
        
        patterns = [
            r'/spreadsheets/d/([a-zA-Z0-9_-]+)',
            r'spreadsheets/d/([a-zA-Z0-9_-]+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        
        return None

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """Preview Google Sheets contents."""
        connection = await self.sheets_service.refresh_token_if_needed(user_id)
        if not connection:
            raise ValueError("Google Sheets not connected. Please authorize first.")

        access_token = connection.access_token
        
        spreadsheet_id = self._extract_spreadsheet_id(url)
        if not spreadsheet_id:
            raise ValueError(f"Could not extract spreadsheet ID from URL: {url}")

        # Get spreadsheet info
        spreadsheet = await self._get_spreadsheet(access_token, spreadsheet_id)
        title = spreadsheet.get("properties", {}).get("title", "Untitled")
        sheets = spreadsheet.get("sheets", [])

        # Get sample data from first sheet
        sample_data = []
        if sheets:
            first_sheet = sheets[0].get("properties", {}).get("title", "Sheet1")
            try:
                values = await self._get_sheet_values(access_token, spreadsheet_id, first_sheet)
                if values and len(values) > 1:
                    headers = values[0]
                    for row in values[1:6]:
                        row_dict = {}
                        for i, cell in enumerate(row):
                            if i < len(headers):
                                row_dict[headers[i]] = cell
                        sample_data.append(row_dict)
            except Exception as e:
                log_error(f"Failed to get sample data: {e}")

        sheet_names = [s.get("properties", {}).get("title", "") for s in sheets]

        return PreviewResult(
            source_type="google_sheets",
            title=f"Google Sheets: {title}",
            description=f"Spreadsheet with {len(sheets)} sheets",
            data=sample_data,
            fields=[{"name": h, "type": "string"} for h in (sample_data[0].keys() if sample_data else [])],
            total_items=len(sheets),
            structure_info={"title": title, "sheets": sheet_names},
        )

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

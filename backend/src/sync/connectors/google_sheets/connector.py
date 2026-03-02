"""
Google Sheets Connector - Process Google Sheets imports.

Architecture:
- All sheets are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.sheets[0].rows[] | select(.Column1 == "value")'
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
)
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error


class GoogleSheetsConnector(BaseConnector):
    """Connector for Google Sheets imports - stores all data in single JSONB node."""

    SHEETS_API_URL = "https://sheets.googleapis.com/v4/spreadsheets"

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="google_sheets",
            display_name="Google Sheets",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.POLL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="sheets",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="import_once",
        )

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

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Fetch Google Sheets data using the unified fetch interface."""
        source_url = config.get("source_url", "")
        spreadsheet_id = self._extract_spreadsheet_id(source_url)
        if not spreadsheet_id:
            raise ValueError(f"Could not extract spreadsheet ID from URL: {source_url}")

        access_token = credentials.access_token

        spreadsheet = await self._get_spreadsheet(access_token, spreadsheet_id)
        title = spreadsheet.get("properties", {}).get("title", "Untitled Spreadsheet")
        sheets_meta = spreadsheet.get("sheets", [])

        sheets_data = []
        total_rows = 0

        for idx, sheet in enumerate(sheets_meta):
            sheet_props = sheet.get("properties", {})
            sheet_title = sheet_props.get("title", f"Sheet{idx + 1}")
            sheet_id = sheet_props.get("sheetId", idx)

            try:
                values = await self._get_sheet_values(access_token, spreadsheet_id, sheet_title)
                sheet_data = self._format_sheet_data(sheet_title, sheet_id, values)
                sheets_data.append(sheet_data)
                total_rows += sheet_data.get("row_count", 0)
            except Exception as e:
                log_error(f"[Sheets fetch] Failed to process sheet {sheet_title}: {e}")
                sheets_data.append({
                    "name": sheet_title,
                    "sheet_id": sheet_id,
                    "error": str(e),
                    "headers": [],
                    "row_count": 0,
                    "rows": [],
                })

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

        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=config.get("name") or title[:100],
            summary=f"Fetched {len(sheets_data)} sheets, {total_rows} rows from '{title}'",
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

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

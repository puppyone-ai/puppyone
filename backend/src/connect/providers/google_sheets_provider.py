"""Google Sheets provider for parsing spreadsheet URLs."""

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, parse_qs

import httpx

from src.connect.data_provider import DataProvider, DataProviderResult
from src.connect.exceptions import AuthenticationError
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.utils.logger import log_info, log_error


class GoogleSheetsProvider(DataProvider):
    """Provider for Google Sheets data sources."""

    SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

    def __init__(self, user_id: str, google_sheets_service: Optional[GoogleSheetsOAuthService] = None):
        self.user_id = user_id
        self.google_sheets_service = google_sheets_service or GoogleSheetsOAuthService()
        self.client = httpx.AsyncClient()

    async def can_handle(self, url: str) -> bool:
        """Check if the URL is a Google Sheets URL."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        return "docs.google.com" in domain and "/spreadsheets/" in url.lower()

    async def fetch_data(self, url: str) -> DataProviderResult:
        """Fetch data from Google Sheets URL."""
        # Check if user has Google Sheets connection
        connection = await self.google_sheets_service.get_connection(self.user_id)
        if not connection:
            raise AuthenticationError(
                "Not connected to Google Sheets. Please authorize your Google account first.",
                provider="google-sheets",
                requires_auth=True
            )

        # Check if token is expired and refresh if needed
        if await self.google_sheets_service.is_token_expired(self.user_id):
            connection = await self.google_sheets_service.refresh_token_if_needed(self.user_id)
            if not connection:
                raise AuthenticationError(
                    "Google Sheets authorization expired. Please reconnect your Google account.",
                    provider="google-sheets",
                    requires_auth=True
                )

        # Extract spreadsheet ID and sheet ID from URL
        spreadsheet_id, sheet_id = self._extract_ids_from_url(url)
        if not spreadsheet_id:
            raise ValueError(f"Could not extract spreadsheet ID from URL: {url}")

        token = connection.access_token
        headers = {"Authorization": f"Bearer {token}"}

        try:
            # Get spreadsheet metadata
            metadata_url = f"{self.SHEETS_API_BASE}/{spreadsheet_id}"
            metadata_response = await self.client.get(metadata_url, headers=headers)
            metadata_response.raise_for_status()
            metadata = metadata_response.json()

            # Find the target sheet
            sheets = metadata.get("sheets", [])
            target_sheet = None

            if sheet_id:
                # Find sheet by gid
                for sheet in sheets:
                    if str(sheet.get("properties", {}).get("sheetId")) == str(sheet_id):
                        target_sheet = sheet
                        break
            
            if not target_sheet and sheets:
                # Use first sheet
                target_sheet = sheets[0]

            if not target_sheet:
                raise ValueError("No sheets found in spreadsheet")

            sheet_title = target_sheet.get("properties", {}).get("title", "Sheet1")
            
            # Fetch data from the sheet
            range_name = f"'{sheet_title}'"
            values_url = f"{self.SHEETS_API_BASE}/{spreadsheet_id}/values/{range_name}"
            values_response = await self.client.get(values_url, headers=headers)
            values_response.raise_for_status()
            values_data = values_response.json()

            rows = values_data.get("values", [])
            
            if not rows:
                return DataProviderResult(
                    source_type="google_sheets_sheet",
                    title=f"{metadata.get('properties', {}).get('title', 'Spreadsheet')} - {sheet_title}",
                    description=f"Google Sheets: {sheet_title}",
                    data=[],
                    fields=[],
                    structure_info={
                        "type": "sheet",
                        "spreadsheet_id": spreadsheet_id,
                        "sheet_id": sheet_id,
                        "sheet_title": sheet_title,
                    }
                )

            # First row as headers
            headers_row = rows[0] if rows else []
            data_rows = rows[1:] if len(rows) > 1 else []

            # Convert to structured data
            structured_data = []
            for row in data_rows:
                row_dict = {}
                for i, header in enumerate(headers_row):
                    value = row[i] if i < len(row) else ""
                    row_dict[header] = value
                structured_data.append(row_dict)

            # Create field definitions
            field_definitions = [
                {
                    "name": header,
                    "type": "string",
                    "nullable": True,
                    "description": f"Column: {header}"
                }
                for header in headers_row
            ]

            spreadsheet_title = metadata.get("properties", {}).get("title", "Spreadsheet")

            return DataProviderResult(
                source_type="google_sheets_sheet",
                title=f"{spreadsheet_title} - {sheet_title}",
                description=f"Google Sheets: {sheet_title}",
                data=structured_data,
                fields=field_definitions,
                structure_info={
                    "type": "sheet",
                    "spreadsheet_id": spreadsheet_id,
                    "sheet_id": sheet_id,
                    "sheet_title": sheet_title,
                    "total_rows": len(structured_data),
                    "total_columns": len(headers_row),
                }
            )

        except httpx.HTTPStatusError as e:
            if e.response.status_code in [401, 403]:
                raise AuthenticationError(
                    "Google Sheets access denied. Please reconnect your Google account.",
                    provider="google-sheets",
                    requires_auth=True
                )
            log_error(f"Google Sheets API error: {e.response.status_code} - {e.response.text}")
            raise ValueError(f"Failed to fetch Google Sheets data: {e.response.status_code}")
        except Exception as e:
            log_error(f"Failed to fetch Google Sheets data: {e}")
            raise

    def _extract_ids_from_url(self, url: str) -> tuple[Optional[str], Optional[str]]:
        """Extract spreadsheet ID and sheet ID (gid) from Google Sheets URL."""
        # Pattern: https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={sheetId}
        # or: https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit
        
        spreadsheet_id = None
        sheet_id = None

        # Extract spreadsheet ID from path
        match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
        if match:
            spreadsheet_id = match.group(1)

        # Extract gid from fragment or query
        parsed = urlparse(url)
        
        # Check fragment (#gid=123)
        if parsed.fragment:
            gid_match = re.search(r'gid=(\d+)', parsed.fragment)
            if gid_match:
                sheet_id = gid_match.group(1)
        
        # Check query parameters (?gid=123)
        if not sheet_id and parsed.query:
            query_params = parse_qs(parsed.query)
            if 'gid' in query_params:
                sheet_id = query_params['gid'][0]

        return spreadsheet_id, sheet_id

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
        if self.google_sheets_service:
            await self.google_sheets_service.close()


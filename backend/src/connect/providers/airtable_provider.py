"""Airtable provider for parsing Airtable base and table URLs."""

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from src.connect.data_provider import DataProvider, DataProviderResult
from src.connect.exceptions import AuthenticationError
from src.oauth.airtable_service import AirtableOAuthService
from src.utils.logger import log_info, log_error


class AirtableProvider(DataProvider):
    """Provider for Airtable data sources."""

    AIRTABLE_API_BASE = "https://api.airtable.com/v0"

    def __init__(self, user_id: str, airtable_service: Optional[AirtableOAuthService] = None):
        self.user_id = user_id
        self.airtable_service = airtable_service or AirtableOAuthService()
        self.client = httpx.AsyncClient()

    async def can_handle(self, url: str) -> bool:
        """Check if the URL is an Airtable URL."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        return "airtable.com" in domain and ("/app" in url or "/tbl" in url)

    async def fetch_data(self, url: str) -> DataProviderResult:
        """Fetch data from Airtable URL."""
        # Check if user has Airtable connection
        connection = await self.airtable_service.get_connection(self.user_id)
        if not connection:
            raise AuthenticationError(
                "Not connected to Airtable. Please authorize your Airtable account first.",
                provider="airtable",
                requires_auth=True
            )

        # Check if token is expired and refresh if needed
        if await self.airtable_service.is_token_expired(self.user_id):
            connection = await self.airtable_service.refresh_token_if_needed(self.user_id)
            if not connection:
                raise AuthenticationError(
                    "Airtable authorization expired. Please reconnect your Airtable account.",
                    provider="airtable",
                    requires_auth=True
                )

        # Parse URL to extract base ID and table ID
        base_id, table_id = self._parse_airtable_url(url)
        
        if not base_id:
            raise ValueError(f"Could not extract base ID from Airtable URL: {url}")

        token = connection.access_token
        headers = {"Authorization": f"Bearer {token}"}

        try:
            # Get base schema to find table name
            base_url = f"{self.AIRTABLE_API_BASE}/meta/bases/{base_id}/tables"
            base_response = await self.client.get(base_url, headers=headers)
            base_response.raise_for_status()
            base_data = base_response.json()

            tables = base_data.get("tables", [])
            target_table = None

            if table_id:
                # Find table by ID
                for table in tables:
                    if table.get("id") == table_id:
                        target_table = table
                        break
            
            if not target_table and tables:
                # Use first table
                target_table = tables[0]

            if not target_table:
                raise ValueError("No tables found in base")

            table_name = target_table.get("name", "Table")
            table_id_final = target_table.get("id")

            # Get table records
            records_url = f"{self.AIRTABLE_API_BASE}/{base_id}/{table_id_final}"
            records_response = await self.client.get(records_url, headers=headers)
            records_response.raise_for_status()
            records_data = records_response.json()

            records = records_data.get("records", [])

            # Extract field definitions from schema
            fields_schema = target_table.get("fields", [])
            field_definitions = []
            
            for field in fields_schema:
                field_name = field.get("name")
                field_type = self._map_airtable_field_type(field.get("type", "singleLineText"))
                field_definitions.append({
                    "name": field_name,
                    "type": field_type,
                    "nullable": True,
                    "description": f"Airtable {field.get('type', 'text')} field"
                })

            # Convert records to structured data
            structured_data = []
            for record in records:
                row = record.get("fields", {})
                row["_record_id"] = record.get("id")
                row["_created_time"] = record.get("createdTime")
                structured_data.append(row)

            return DataProviderResult(
                source_type="airtable_table",
                title=f"Airtable: {table_name}",
                description=f"Airtable table: {table_name}",
                data=structured_data,
                fields=field_definitions,
                structure_info={
                    "type": "table",
                    "base_id": base_id,
                    "table_id": table_id_final,
                    "table_name": table_name,
                    "total_records": len(structured_data),
                    "total_fields": len(field_definitions),
                }
            )

        except httpx.HTTPStatusError as e:
            if e.response.status_code in [401, 403]:
                raise AuthenticationError(
                    "Airtable access denied. Please reconnect your Airtable account.",
                    provider="airtable",
                    requires_auth=True
                )
            log_error(f"Airtable API error: {e.response.status_code} - {e.response.text}")
            raise ValueError(f"Failed to fetch Airtable data: {e.response.status_code}")
        except Exception as e:
            log_error(f"Failed to fetch Airtable data: {e}")
            raise

    def _parse_airtable_url(self, url: str) -> tuple[Optional[str], Optional[str]]:
        """Parse Airtable URL to extract base ID and table ID."""
        # Pattern: https://airtable.com/appXXXXXXXX/tblYYYYYYYY/...
        # or: https://airtable.com/appXXXXXXXX
        
        base_id = None
        table_id = None

        # Extract base ID (starts with 'app')
        base_match = re.search(r'/(app[a-zA-Z0-9]+)', url)
        if base_match:
            base_id = base_match.group(1)

        # Extract table ID (starts with 'tbl')
        table_match = re.search(r'/(tbl[a-zA-Z0-9]+)', url)
        if table_match:
            table_id = table_match.group(1)

        return base_id, table_id

    def _map_airtable_field_type(self, airtable_type: str) -> str:
        """Map Airtable field type to generic type."""
        type_mapping = {
            "singleLineText": "string",
            "multilineText": "text",
            "richText": "text",
            "email": "string",
            "url": "string",
            "phoneNumber": "string",
            "number": "number",
            "percent": "number",
            "currency": "number",
            "rating": "number",
            "duration": "number",
            "checkbox": "boolean",
            "date": "date",
            "dateTime": "datetime",
            "singleSelect": "string",
            "multipleSelects": "string",
            "singleCollaborator": "string",
            "multipleCollaborators": "string",
            "multipleRecordLinks": "list",
            "multipleAttachments": "list",
            "barcode": "string",
            "button": "string",
            "formula": "string",
            "rollup": "string",
            "count": "number",
            "lookup": "string",
            "createdTime": "datetime",
            "lastModifiedTime": "datetime",
            "createdBy": "string",
            "lastModifiedBy": "string",
            "autoNumber": "number",
        }
        return type_mapping.get(airtable_type, "string")

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
        if self.airtable_service:
            await self.airtable_service.close()


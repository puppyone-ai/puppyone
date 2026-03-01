"""
Airtable Connector - Process Airtable base imports.

Architecture:
- All tables/records are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.tables[0].records[] | select(.Status == "Done")'
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
from src.oauth.airtable_service import AirtableOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error


class AirtableConnector(BaseConnector):
    """Connector for Airtable imports - stores all data in single JSONB node."""

    AIRTABLE_API_URL = "https://api.airtable.com/v0"
    AIRTABLE_META_URL = "https://api.airtable.com/v0/meta/bases"

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="airtable",
            display_name="Airtable",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="airtable",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="manual",
        )

    def __init__(
        self,
        node_service: ContentNodeService,
        airtable_service: AirtableOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.airtable_service = airtable_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Pull Airtable base data. Returns raw content without creating nodes."""
        access_token = credentials.access_token
        source_url = config.get("source_url", "")

        base_id = self._extract_base_id(source_url)
        if not base_id:
            raise ValueError(f"Could not extract Airtable base ID from URL: {source_url}")

        tables_meta = await self._get_base_tables(access_token, base_id)
        if not tables_meta:
            raise ValueError("Airtable base has no tables")

        base_name = config.get("name") or f"Airtable Base {base_id[:8]}"

        tables_data = []
        total_records = 0
        for table in tables_meta:
            table_id = table.get("id", "")
            table_name = table.get("name", "")
            table_fields = table.get("fields", [])
            try:
                table_data = await self._process_table(
                    access_token=access_token,
                    base_id=base_id,
                    table_id=table_id,
                    table_name=table_name,
                    table_fields=table_fields,
                )
                tables_data.append(table_data)
                total_records += table_data.get("record_count", 0)
            except Exception as e:
                log_error(f"fetch: failed to process table {table_name}: {e}")
                tables_data.append({
                    "table_id": table_id,
                    "name": table_name,
                    "error": str(e),
                    "fields": [],
                    "record_count": 0,
                    "records": [],
                })

        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "airtable",
            "base_id": base_id,
            "base_name": base_name,
            "base_url": source_url,
            "table_count": len(tables_data),
            "total_records": total_records,
            "tables": tables_data,
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=base_name[:100],
            summary=f"Airtable base '{base_name}' with {len(tables_data)} tables, {total_records} records",
        )

    async def _get_base_tables(self, access_token: str, base_id: str) -> list[dict]:
        """Get tables in a base."""
        response = await self.client.get(
            f"{self.AIRTABLE_META_URL}/{base_id}/tables",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json().get("tables", [])

    async def _get_table_records(
        self,
        access_token: str,
        base_id: str,
        table_id: str,
        max_records: int = 1000,
    ) -> list[dict]:
        """Get records from a table with pagination."""
        all_records = []
        offset = None

        while len(all_records) < max_records:
            params = {"pageSize": min(100, max_records - len(all_records))}
            if offset:
                params["offset"] = offset

            response = await self.client.get(
                f"{self.AIRTABLE_API_URL}/{base_id}/{table_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            response.raise_for_status()
            data = response.json()

            records = data.get("records", [])
            all_records.extend(records)

            offset = data.get("offset")
            if not offset:
                break

        return all_records

    async def _process_table(
        self,
        access_token: str,
        base_id: str,
        table_id: str,
        table_name: str,
        table_fields: list[dict],
    ) -> dict:
        """Process a single table and return structured data."""
        # Get records
        records = await self._get_table_records(access_token, base_id, table_id)

        # Format field info
        fields_info = [
            {
                "id": f.get("id", ""),
                "name": f.get("name", ""),
                "type": f.get("type", ""),
            }
            for f in table_fields
        ]

        # Format records for JSONB
        records_data = []
        for record in records:
            record_fields = record.get("fields", {})
            formatted_record = {"_id": record.get("id", "")}

            for field_name, value in record_fields.items():
                # Simplify complex field types for JSONB
                if isinstance(value, list):
                    # Could be attachments, linked records, multi-select
                    formatted_record[field_name] = [
                        self._simplify_value(v) for v in value[:10]
                    ]
                elif isinstance(value, dict):
                    formatted_record[field_name] = self._simplify_value(value)
                else:
                    formatted_record[field_name] = value

            records_data.append(formatted_record)

        return {
            "table_id": table_id,
            "name": table_name,
            "fields": fields_info,
            "record_count": len(records_data),
            "records": records_data,
        }

    def _simplify_value(self, value) -> any:
        """Simplify complex Airtable values for JSONB storage."""
        if isinstance(value, dict):
            # Attachment: keep url and filename
            if "url" in value:
                return {
                    "type": "attachment",
                    "url": value.get("url"),
                    "filename": value.get("filename"),
                }
            # User: keep email and name
            if "email" in value:
                return {
                    "type": "user",
                    "email": value.get("email"),
                    "name": value.get("name"),
                }
            # Other dict: stringify
            return str(value)[:200]
        return value

    def _extract_base_id(self, url: str) -> Optional[str]:
        """Extract base ID from Airtable URL."""
        import re

        patterns = [
            r'airtable\.com/(app[a-zA-Z0-9]+)',
            r'/(app[a-zA-Z0-9]+)/',
        ]

        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)

        return None

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

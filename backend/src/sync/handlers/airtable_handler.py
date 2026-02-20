"""
Airtable Handler - Process Airtable base imports.

Architecture:
- All tables/records are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.tables[0].records[] | select(.Status == "Done")'
"""

from datetime import datetime, timezone
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.sync.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.sync.task.models import ImportTask, ImportTaskType
from src.oauth.airtable_service import AirtableOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class AirtableHandler(BaseHandler):
    """Handler for Airtable imports - stores all data in single JSONB node."""

    AIRTABLE_API_URL = "https://api.airtable.com/v0"
    AIRTABLE_META_URL = "https://api.airtable.com/v0/meta/bases"

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

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.AIRTABLE

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Airtable import - all data stored in single JSONB node."""
        await on_progress(5, "Checking Airtable connection...")

        # Get OAuth connection
        connection = await self.airtable_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Airtable not connected. Please authorize first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "")

        config = task.config or {}
        source_url = task.source_url or ""
        parent_id = config.get("parent_id")
        
        # Extract base ID from URL
        base_id = self._extract_base_id(source_url)
        if not base_id:
            raise ValueError(f"Could not extract Airtable base ID from URL: {source_url}")

        await on_progress(10, "Fetching base schema...")

        # Get base schema (tables)
        tables_meta = await self._get_base_tables(access_token, base_id)
        
        if not tables_meta:
            raise ValueError("Airtable base has no tables")

        base_name = config.get("name") or f"Airtable Base {base_id[:8]}"

        await on_progress(20, f"Found {len(tables_meta)} tables...")

        # Process each table
        tables_data = []
        total_records = 0
        
        for idx, table in enumerate(tables_meta):
            table_name = table.get("name", f"Table{idx + 1}")
            table_id = table.get("id", "")
            table_fields = table.get("fields", [])
            
            progress = 20 + int((idx / len(tables_meta)) * 70)
            await on_progress(progress, f"Processing table: {table_name}...")

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
                log_error(f"Failed to process table {table_name}: {e}")
                tables_data.append({
                    "table_id": table_id,
                    "name": table_name,
                    "error": str(e),
                    "fields": [],
                    "record_count": 0,
                    "records": [],
                })

        # Build JSONB content
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

        # Create single JSONB node
        node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=base_name[:100],
            node_type="airtable",
            sync_url=source_url,
            content=content,
            parent_id=parent_id,
            sync_id=base_id,
            sync_config={"import_type": "base", "base_id": base_id},
            created_by=task.user_id,
        )

        await on_progress(100, "Airtable import completed")

        return ImportResult(
            content_node_id=node.id,
            items_count=total_records,
            metadata={"tables": len(tables_data)},
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

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """Preview Airtable base contents."""
        connection = await self.airtable_service.refresh_token_if_needed(user_id)
        if not connection:
            raise ValueError("Airtable not connected. Please authorize first.")

        access_token = connection.access_token
        
        base_id = self._extract_base_id(url)
        if not base_id:
            raise ValueError(f"Could not extract base ID from URL: {url}")

        # Get tables
        tables = await self._get_base_tables(access_token, base_id)
        
        # Get sample from first table
        sample_data = []
        if tables:
            first_table = tables[0]
            try:
                records = await self._get_table_records(
                    access_token, base_id, first_table["id"], max_records=5
                )
                sample_data = [r.get("fields", {}) for r in records]
            except Exception as e:
                log_error(f"Failed to get sample data: {e}")

        table_info = [
            {"name": t.get("name"), "fields": len(t.get("fields", []))}
            for t in tables
        ]

        return PreviewResult(
            source_type="airtable",
            title=f"Airtable Base: {base_id}",
            description=f"Base with {len(tables)} tables",
            data=sample_data,
            fields=[{"name": k, "type": "string"} for k in (sample_data[0].keys() if sample_data else [])],
            total_items=len(tables),
            structure_info={"base_id": base_id, "tables": table_info},
        )

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

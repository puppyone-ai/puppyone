"""
Google Drive Connector - Process Google Drive file imports.

Imports files from Google Drive into content nodes.
"""

import hashlib
import json
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
    ConfigField,
)
from src.oauth.google_drive_service import GoogleDriveOAuthService
from src.s3.service import S3Service


class GoogleDriveConnector(BaseConnector):
    """Connector for Google Drive imports."""

    DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
    DRIVE_EXPORT_URL = "https://www.googleapis.com/drive/v3/files/{file_id}/export"

    # Google Docs MIME types that can be exported
    EXPORT_MIME_TYPES = {
        "application/vnd.google-apps.document": "text/markdown",
        "application/vnd.google-apps.spreadsheet": "text/csv",
        "application/vnd.google-apps.presentation": "text/plain",
    }

    # Regular file types to download directly
    TEXT_MIME_TYPES = {
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
        "text/html",
    }

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="google_drive",
            display_name="Google Drive",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="markdown",
            auth=AuthRequirement.OAUTH,
            oauth_type="drive",
            oauth_ui_type="google_drive",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="manual",
            creation_mode="direct",
            description="Sync files from Drive",
            accept_types=("folder",),
            ui_visible=False,
            config_fields=(
                ConfigField(
                    key="source_url",
                    label="Drive folder or file URL",
                    type="url",
                    placeholder="https://drive.google.com/drive/folders/...",
                    hint="Leave empty to import recent files",
                ),
                ConfigField(key="max_results", label="Max files", type="number", default=50),
            ),
        )

    def __init__(
        self,
        node_service: ContentNodeService,
        drive_service: GoogleDriveOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.drive_service = drive_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Pull a JSON summary of folder/drive contents."""
        access_token = credentials.access_token
        source_url = config.get("source_url", "")

        if source_url.startswith("oauth://"):
            files = await self._list_recent_files(access_token, limit=config.get("max_results", 50))
            folder_name = "Google Drive (recent)"
        else:
            file_id = self._extract_file_id(source_url)
            if file_id:
                file_info = await self._get_file_info(access_token, file_id)
                if file_info.get("mimeType") == "application/vnd.google-apps.folder":
                    files = await self._list_folder_files(access_token, file_id)
                    folder_name = file_info.get("name", "Google Drive Folder")
                else:
                    files = [file_info]
                    folder_name = file_info.get("name", "Google Drive File")
            else:
                files = await self._list_recent_files(access_token, limit=50)
                folder_name = "Google Drive (recent)"

        content = {
            "source_type": "google_drive",
            "folder_name": folder_name,
            "total_files": len(files),
            "files": [
                {
                    "name": f.get("name"),
                    "mimeType": f.get("mimeType"),
                    "size": f.get("size"),
                    "modifiedTime": f.get("modifiedTime"),
                }
                for f in files
            ],
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=folder_name,
            summary=f"Google Drive '{folder_name}' with {len(files)} files",
        )

    async def _list_recent_files(
        self,
        access_token: str,
        limit: int = 50,
    ) -> list[dict]:
        """List recent files from Drive."""
        params = {
            "pageSize": min(limit, 100),
            "orderBy": "modifiedTime desc",
            "fields": "files(id,name,mimeType,modifiedTime,size,webViewLink)",
            "q": "trashed = false",
        }

        response = await self.client.get(
            self.DRIVE_FILES_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        response.raise_for_status()
        return response.json().get("files", [])

    async def _list_folder_files(
        self,
        access_token: str,
        folder_id: str,
    ) -> list[dict]:
        """List files in a specific folder."""
        params = {
            "pageSize": 100,
            "fields": "files(id,name,mimeType,modifiedTime,size,webViewLink)",
            "q": f"'{folder_id}' in parents and trashed = false",
        }

        response = await self.client.get(
            self.DRIVE_FILES_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        response.raise_for_status()
        return response.json().get("files", [])

    async def _get_file_info(self, access_token: str, file_id: str) -> dict:
        """Get info for a specific file."""
        params = {
            "fields": "id,name,mimeType,modifiedTime,size,webViewLink",
        }

        response = await self.client.get(
            f"{self.DRIVE_FILES_URL}/{file_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        response.raise_for_status()
        return response.json()

    def _extract_file_id(self, url: str) -> Optional[str]:
        """Extract file ID from Drive URL."""
        import re

        # Handle various Drive URL formats
        patterns = [
            r'/d/([a-zA-Z0-9_-]+)',  # /d/FILE_ID
            r'id=([a-zA-Z0-9_-]+)',  # ?id=FILE_ID
            r'/folders/([a-zA-Z0-9_-]+)',  # /folders/FOLDER_ID
        ]

        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)

        return None

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

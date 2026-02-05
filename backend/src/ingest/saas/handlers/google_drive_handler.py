"""
Google Drive Handler - Process Google Drive file imports.

Imports files from Google Drive into content nodes.
"""

from datetime import datetime
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.ingest.saas.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.ingest.saas.task.models import ImportTask, ImportTaskType
from src.oauth.google_drive_service import GoogleDriveOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class GoogleDriveHandler(BaseHandler):
    """Handler for Google Drive imports."""

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

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.GOOGLE_DRIVE

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Google Drive import."""
        await on_progress(5, "Checking Google Drive connection...")

        # Get OAuth connection
        connection = await self.drive_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Google Drive not connected. Please authorize first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "Google Drive")

        config = task.config or {}
        
        # Parse source - could be folder ID, file ID, or oauth:// URL
        source = task.source_url or ""
        
        await on_progress(10, f"Fetching files from {user_email}...")

        if source.startswith("oauth://"):
            # Full Drive sync - get recent files
            files = await self._list_recent_files(access_token, limit=config.get("max_results", 50))
        else:
            # Specific file or folder
            file_id = self._extract_file_id(source)
            if file_id:
                file_info = await self._get_file_info(access_token, file_id)
                if file_info.get("mimeType") == "application/vnd.google-apps.folder":
                    files = await self._list_folder_files(access_token, file_id)
                else:
                    files = [file_info]
            else:
                files = await self._list_recent_files(access_token, limit=50)

        if not files:
            # Create empty folder
            node = self.node_service.create_folder(
                user_id=task.user_id,
                project_id=task.project_id,
                name=f"Google Drive - {user_email}",
                parent_id=config.get("parent_id"),
            )
            return ImportResult(content_node_id=node.id, items_count=0)

        await on_progress(20, f"Found {len(files)} files, processing...")

        # Create parent folder
        folder_name = config.get("name") or f"Google Drive - {user_email}"
        folder = self.node_service.create_folder(
            user_id=task.user_id,
            project_id=task.project_id,
            name=folder_name,
            parent_id=config.get("parent_id"),
        )

        # Process each file
        total = len(files)
        processed = 0
        
        for idx, file_info in enumerate(files):
            progress = 20 + int((idx / total) * 70)
            await on_progress(progress, f"Processing file {idx + 1}/{total}...")

            try:
                await self._process_file(
                    access_token=access_token,
                    file_info=file_info,
                    task=task,
                    parent_id=folder.id,
                )
                processed += 1
            except Exception as e:
                log_error(f"Failed to process Drive file {file_info.get('id')}: {e}")
                continue

        await on_progress(100, "Google Drive import completed")

        return ImportResult(
            content_node_id=folder.id,
            items_count=processed,
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

    async def _process_file(
        self,
        access_token: str,
        file_info: dict,
        task: ImportTask,
        parent_id: str,
    ) -> None:
        """Download and process a single file."""
        file_id = file_info["id"]
        file_name = file_info["name"]
        mime_type = file_info.get("mimeType", "")

        # Determine how to get content
        content = None
        
        if mime_type in self.EXPORT_MIME_TYPES:
            # Export Google Docs/Sheets/Slides
            export_mime = self.EXPORT_MIME_TYPES[mime_type]
            content = await self._export_file(access_token, file_id, export_mime)
        elif mime_type in self.TEXT_MIME_TYPES:
            # Download text files directly
            content = await self._download_file(access_token, file_id)
        else:
            # Skip binary files for now
            log_info(f"Skipping binary file: {file_name} ({mime_type})")
            return

        if not content:
            return

        # Format as Markdown
        markdown_content = self._format_file_as_markdown(
            name=file_name,
            content=content,
            mime_type=mime_type,
            modified_time=file_info.get("modifiedTime"),
            web_link=file_info.get("webViewLink"),
        )

        # Create content node
        sync_config = {
            "file_id": file_id,
            "mime_type": mime_type,
        }

        await self.node_service.create_synced_markdown_node(
            user_id=task.user_id,
            project_id=task.project_id,
            name=file_name[:100],
            content=markdown_content,
            sync_type="google_drive",
            sync_url=file_info.get("webViewLink", f"https://drive.google.com/file/d/{file_id}"),
            sync_id=file_id,
            sync_config=sync_config,
            parent_id=parent_id,
        )

    async def _export_file(self, access_token: str, file_id: str, export_mime: str) -> Optional[str]:
        """Export a Google Docs file to specified format."""
        try:
            response = await self.client.get(
                self.DRIVE_EXPORT_URL.format(file_id=file_id),
                headers={"Authorization": f"Bearer {access_token}"},
                params={"mimeType": export_mime},
            )
            response.raise_for_status()
            return response.text
        except Exception as e:
            log_error(f"Failed to export file {file_id}: {e}")
            return None

    async def _download_file(self, access_token: str, file_id: str) -> Optional[str]:
        """Download a file's content."""
        try:
            response = await self.client.get(
                f"{self.DRIVE_FILES_URL}/{file_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"alt": "media"},
            )
            response.raise_for_status()
            return response.text
        except Exception as e:
            log_error(f"Failed to download file {file_id}: {e}")
            return None

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

    def _format_file_as_markdown(
        self,
        name: str,
        content: str,
        mime_type: str,
        modified_time: Optional[str],
        web_link: Optional[str],
    ) -> str:
        """Format file content as Markdown."""
        lines = [
            f"# {name}",
            "",
            "---",
            "",
            f"**Type:** {mime_type}  ",
        ]
        
        if modified_time:
            lines.append(f"**Modified:** {modified_time}  ")
        
        if web_link:
            lines.append(f"**Link:** [{web_link}]({web_link})  ")
        
        lines.extend([
            "",
            "---",
            "",
            content,
        ])
        
        return "\n".join(lines)

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """Preview Google Drive contents."""
        connection = await self.drive_service.refresh_token_if_needed(user_id)
        if not connection:
            raise ValueError("Google Drive not connected. Please authorize first.")

        access_token = connection.access_token
        
        # Get recent files for preview
        files = await self._list_recent_files(access_token, limit=10)
        
        data = [
            {
                "id": f.get("id"),
                "name": f.get("name"),
                "type": f.get("mimeType"),
                "modified": f.get("modifiedTime"),
                "link": f.get("webViewLink"),
            }
            for f in files
        ]

        return PreviewResult(
            source_type="google_drive",
            title="Google Drive Files",
            description=f"Found {len(files)} recent files",
            data=data,
            fields=[
                {"name": "name", "type": "string"},
                {"name": "type", "type": "string"},
                {"name": "modified", "type": "datetime"},
            ],
            total_items=len(files),
        )

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()


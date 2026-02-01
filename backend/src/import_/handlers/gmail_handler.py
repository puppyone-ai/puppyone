"""
Gmail Handler - Process Gmail imports via Google Gmail API.
"""

import base64
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.import_.handlers.base import BaseHandler, ImportResult, ProgressCallback
from src.import_.task.models import ImportTask, ImportTaskType
from src.oauth.gmail_service import GmailOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class GmailHandler(BaseHandler):
    """Handler for Gmail imports using Gmail API."""

    GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    GMAIL_MESSAGE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"

    def __init__(
        self,
        node_service: ContentNodeService,
        gmail_service: GmailOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.gmail_service = gmail_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=30.0)

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.GMAIL

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Gmail import."""
        await on_progress(5, "Checking Gmail connection...")

        # Get OAuth connection
        connection = await self.gmail_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Gmail not connected. Please authorize Gmail first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "Gmail")

        # Parse config (sync_config is flattened into config)
        config = task.config or {}
        max_results = config.get("max_results", 50)  # Default 50 emails
        query = config.get("query", "")  # Gmail search query
        include_attachments = config.get("include_attachments", False)
        
        await on_progress(10, f"Fetching emails from {user_email}...")

        # Fetch email list
        emails = await self._fetch_emails(
            access_token=access_token,
            max_results=max_results,
            query=query,
        )

        parent_id = config.get("parent_id")
        
        if not emails:
            # No emails found, create an empty folder
            node = self.node_service.create_folder(
                user_id=task.user_id,
                project_id=task.project_id,
                name=f"Gmail - {user_email}",
                parent_id=parent_id,
            )
            return ImportResult(
                content_node_id=node.id,
                items_count=0,
            )

        await on_progress(20, f"Found {len(emails)} emails, processing...")

        # Create parent folder
        folder_name = config.get("name") or f"Gmail - {user_email}"
        folder = self.node_service.create_folder(
            user_id=task.user_id,
            project_id=task.project_id,
            name=folder_name,
            parent_id=parent_id,
        )

        # Process each email
        total = len(emails)
        for idx, email_summary in enumerate(emails):
            progress = 20 + int((idx / total) * 70)  # 20-90%
            await on_progress(progress, f"Processing email {idx + 1}/{total}...")

            try:
                await self._process_email(
                    access_token=access_token,
                    email_id=email_summary["id"],
                    task=task,
                    parent_id=folder.id,
                    include_attachments=include_attachments,
                )
            except Exception as e:
                log_error(f"Failed to process email {email_summary['id']}: {e}")
                continue

        await on_progress(100, "Gmail import completed")

        return ImportResult(
            content_node_id=folder.id,
            items_count=total,
        )

    async def _fetch_emails(
        self,
        access_token: str,
        max_results: int = 50,
        query: str = "",
    ) -> list[dict]:
        """Fetch list of emails from Gmail."""
        params = {
            "maxResults": min(max_results, 100),  # Gmail API limit
        }
        if query:
            params["q"] = query

        response = await self.client.get(
            self.GMAIL_MESSAGES_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("messages", [])

    async def _process_email(
        self,
        access_token: str,
        email_id: str,
        task: ImportTask,
        parent_id: str,
        include_attachments: bool = False,
    ) -> None:
        """Fetch and process a single email."""
        # Fetch full email
        response = await self.client.get(
            self.GMAIL_MESSAGE_URL.format(id=email_id),
            headers={"Authorization": f"Bearer {access_token}"},
            params={"format": "full"},
        )
        response.raise_for_status()
        email_data = response.json()

        # Extract headers
        headers = {h["name"].lower(): h["value"] for h in email_data.get("payload", {}).get("headers", [])}
        subject = headers.get("subject", "(No Subject)")
        from_addr = headers.get("from", "Unknown")
        to_addr = headers.get("to", "")
        date_str = headers.get("date", "")
        
        # Parse date
        try:
            email_date = parsedate_to_datetime(date_str) if date_str else datetime.now(timezone.utc)
        except:
            email_date = datetime.now(timezone.utc)

        # Extract body
        body = self._extract_body(email_data.get("payload", {}))

        # Format as Markdown
        markdown_content = self._format_email_as_markdown(
            subject=subject,
            from_addr=from_addr,
            to_addr=to_addr,
            date=email_date,
            body=body,
            labels=email_data.get("labelIds", []),
        )

        # Create content node
        sync_config = {
            "email_id": email_id,
            "thread_id": email_data.get("threadId"),
            "labels": email_data.get("labelIds", []),
        }

        await self.node_service.create_synced_markdown_node(
            user_id=task.user_id,
            project_id=task.project_id,
            name=subject[:100],  # Limit name length
            parent_id=parent_id,
            markdown_content=markdown_content,
            source_url=f"https://mail.google.com/mail/u/0/#inbox/{email_id}",
            sync_type="gmail",
            sync_config=sync_config,
        )

    def _extract_body(self, payload: dict) -> str:
        """Extract email body from payload, handling multipart messages."""
        body = ""
        
        # Check for body in the payload directly
        if "body" in payload and payload["body"].get("data"):
            body = self._decode_body(payload["body"]["data"])
            return body

        # Handle multipart
        parts = payload.get("parts", [])
        for part in parts:
            mime_type = part.get("mimeType", "")
            
            if mime_type == "text/plain":
                if "body" in part and part["body"].get("data"):
                    body = self._decode_body(part["body"]["data"])
                    break
            elif mime_type == "text/html":
                if "body" in part and part["body"].get("data"):
                    # Prefer plain text, but use HTML as fallback
                    if not body:
                        body = self._decode_body(part["body"]["data"])
            elif "parts" in part:
                # Nested multipart
                nested_body = self._extract_body(part)
                if nested_body:
                    body = nested_body

        return body

    def _decode_body(self, data: str) -> str:
        """Decode base64url encoded body."""
        try:
            # Gmail uses URL-safe base64
            decoded = base64.urlsafe_b64decode(data + "==")
            return decoded.decode("utf-8", errors="replace")
        except Exception:
            return ""

    def _format_email_as_markdown(
        self,
        subject: str,
        from_addr: str,
        to_addr: str,
        date: datetime,
        body: str,
        labels: list[str],
    ) -> str:
        """Format email content as Markdown."""
        lines = [
            f"# {subject}",
            "",
            "---",
            "",
            f"**From:** {from_addr}  ",
            f"**To:** {to_addr}  ",
            f"**Date:** {date.strftime('%Y-%m-%d %H:%M:%S %Z')}  ",
        ]
        
        if labels:
            lines.append(f"**Labels:** {', '.join(labels)}  ")
        
        lines.extend([
            "",
            "---",
            "",
            body,
        ])
        
        return "\n".join(lines)

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()


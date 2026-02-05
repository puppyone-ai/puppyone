"""
Gmail Handler - Process Gmail imports via Google Gmail API.

Architecture:
- All emails are stored in a SINGLE content_node with type "gmail_inbox"
- Emails are stored as JSONB in the content field (not as separate files)
- Agent can use jq to query the JSON structure
"""

import base64
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.ingest.saas.handlers.base import BaseHandler, ImportResult, ProgressCallback
from src.ingest.saas.task.models import ImportTask, ImportTaskType
from src.oauth.gmail_service import GmailOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class GmailHandler(BaseHandler):
    """Handler for Gmail imports using Gmail API.
    
    Stores all emails in a single JSONB node for efficient querying with jq.
    """

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
        """Process Gmail import - stores all emails in a single JSONB node."""
        await on_progress(5, "Checking Gmail connection...")

        # Get OAuth connection
        connection = await self.gmail_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Gmail not connected. Please authorize Gmail first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "Gmail")

        # Parse config
        config = task.config or {}
        max_results = config.get("max_results", 50)
        query = config.get("query", "")
        parent_id = config.get("parent_id")
        
        await on_progress(10, f"Fetching emails from {user_email}...")

        # Fetch email list
        email_ids = await self._fetch_email_ids(
            access_token=access_token,
            max_results=max_results,
            query=query,
        )

        if not email_ids:
            # No emails found, create empty inbox node
            content = {
                "account": user_email,
                "synced_at": datetime.now(timezone.utc).isoformat(),
                "email_count": 0,
                "query": query,
                "emails": [],
            }
            node = await self.node_service.create_synced_node(
                project_id=task.project_id,
                sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
                name=f"Gmail - {user_email}",
                source="gmail",
                sync_url="oauth://gmail",
                content=content,
                parent_id=parent_id,
                sync_id=user_email,
                sync_config={"max_results": max_results, "query": query},
                created_by=task.user_id,
            )
            return ImportResult(content_node_id=node.id, items_count=0)

        await on_progress(20, f"Found {len(email_ids)} emails, fetching details...")

        # Fetch full details for each email
        emails = []
        total = len(email_ids)
        
        for idx, email_id in enumerate(email_ids):
            progress = 20 + int((idx / total) * 70)  # 20-90%
            await on_progress(progress, f"Fetching email {idx + 1}/{total}...")

            try:
                email_data = await self._fetch_email_details(access_token, email_id)
                if email_data:
                    emails.append(email_data)
            except Exception as e:
                log_error(f"Failed to fetch email {email_id}: {e}")
                continue

        await on_progress(95, "Creating inbox node...")

        # Build the complete JSONB content
        content = {
            "account": user_email,
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "email_count": len(emails),
            "query": query,
            "emails": emails,
        }

        # Create single node with all emails in JSONB
        node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=config.get("name") or f"Gmail - {user_email}",
            source="gmail",
            sync_url="oauth://gmail",
            content=content,
            parent_id=parent_id,
            sync_id=user_email,
            sync_config={"max_results": max_results, "query": query},
            created_by=task.user_id,
        )

        await on_progress(100, "Gmail import completed")

        return ImportResult(
            content_node_id=node.id,
            items_count=len(emails),
        )

    async def _fetch_email_ids(
        self,
        access_token: str,
        max_results: int = 50,
        query: str = "",
    ) -> list[str]:
        """Fetch list of email IDs from Gmail."""
        params = {
            "maxResults": min(max_results, 100),
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
        messages = data.get("messages", [])
        return [m["id"] for m in messages]

    async def _fetch_email_details(
        self,
        access_token: str,
        email_id: str,
    ) -> Optional[dict]:
        """Fetch full email details and return structured data."""
        response = await self.client.get(
            self.GMAIL_MESSAGE_URL.format(id=email_id),
            headers={"Authorization": f"Bearer {access_token}"},
            params={"format": "full"},
        )
        response.raise_for_status()
        email_data = response.json()

        # Extract headers
        headers = {
            h["name"].lower(): h["value"] 
            for h in email_data.get("payload", {}).get("headers", [])
        }
        
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

        # Return structured email data (for JSONB storage)
        return {
            "id": email_id,
            "thread_id": email_data.get("threadId"),
            "subject": subject,
            "from": from_addr,
            "to": to_addr,
            "date": email_date.isoformat(),
            "labels": email_data.get("labelIds", []),
            "snippet": email_data.get("snippet", ""),
            "body": body,
            "url": f"https://mail.google.com/mail/u/0/#inbox/{email_id}",
        }

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
                    if not body:
                        body = self._decode_body(part["body"]["data"])
            elif "parts" in part:
                nested_body = self._extract_body(part)
                if nested_body:
                    body = nested_body

        return body

    def _decode_body(self, data: str) -> str:
        """Decode base64url encoded body."""
        try:
            decoded = base64.urlsafe_b64decode(data + "==")
            return decoded.decode("utf-8", errors="replace")
        except Exception:
            return ""

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

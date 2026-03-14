"""
Gmail Connector - Process Gmail imports via Google Gmail API.

Architecture:
- All emails are stored in a SINGLE content_node with type "gmail_inbox"
- Emails are stored as JSONB in the content field (not as separate files)
- Agent can use jq to query the JSON structure
"""

import base64
import hashlib
import json
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.connectors.datasource._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
    ConfigField,
)
from src.oauth.gmail_service import GmailOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error


class GmailConnector(BaseConnector):
    """Connector for Gmail imports using Gmail API.

    Stores all emails in a single JSONB node for efficient querying with jq.
    """

    GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    GMAIL_MESSAGE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="gmail",
            display_name="Gmail",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.POLL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="gmail",
            oauth_ui_type="gmail",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="import_once",
            creation_mode="direct",
            description="Sync emails to JSON",
            accept_types=("folder",),
            config_fields=(
                ConfigField(
                    key="query",
                    label="Email filter",
                    type="select",
                    default="",
                    options=[
                        {"value": "", "label": "All emails"},
                        {"value": "in:inbox", "label": "Inbox"},
                        {"value": "is:unread", "label": "Unread"},
                        {"value": "is:starred", "label": "Starred"},
                        {"value": "in:sent", "label": "Sent"},
                        {"value": "is:important", "label": "Important"},
                        {"value": "in:drafts", "label": "Drafts"},
                    ],
                ),
                ConfigField(
                    key="max_results",
                    label="Max emails",
                    type="number",
                    required=True,
                    default=50,
                    hint="Maximum number of emails to import",
                ),
            ),
        )

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

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Fetch Gmail emails using the unified fetch interface."""
        user_email = credentials.metadata.get("user", {}).get("email", "Gmail")
        max_results = config.get("max_results", config.get("maxEmails", 50))
        if isinstance(max_results, str):
            max_results = int(max_results)
        query = config.get("query", "")

        email_ids = await self._fetch_email_ids(
            access_token=credentials.access_token,
            max_results=max_results,
            query=query,
        )

        emails = []
        for email_id in email_ids:
            try:
                email_data = await self._fetch_email_details(
                    credentials.access_token, email_id,
                )
                if email_data:
                    emails.append(email_data)
            except Exception as e:
                log_error(f"[Gmail fetch] Failed to fetch email {email_id}: {e}")
                continue

        content = {
            "account": user_email,
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "email_count": len(emails),
            "query": query,
            "emails": emails,
        }

        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=config.get("name") or f"Gmail - {user_email}",
            summary=f"Fetched {len(emails)} emails from {user_email}",
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

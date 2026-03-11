"""
Google Docs Connector - Process Google Docs imports.

Imports Google Docs documents into content nodes as Markdown.
"""

import hashlib
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
from src.oauth.google_docs_service import GoogleDocsOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error


class GoogleDocsConnector(BaseConnector):
    """Connector for Google Docs imports."""

    DOCS_API_URL = "https://docs.googleapis.com/v1/documents"

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="google_docs",
            display_name="Google Docs",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="markdown",
            auth=AuthRequirement.OAUTH,
            oauth_type="docs",
            oauth_ui_type="google_docs",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="manual",
            creation_mode="direct",
            description="Sync documents",
            accept_types=("folder",),
            config_fields=(
                ConfigField(
                    key="source_url",
                    label="Google Docs URL",
                    type="url",
                    required=True,
                    placeholder="https://docs.google.com/document/d/.../edit",
                    hint="Paste the full URL of your Google Docs document",
                ),
            ),
        )

    def __init__(
        self,
        node_service: ContentNodeService,
        docs_service: GoogleDocsOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.docs_service = docs_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Pull a Google Doc and return as markdown."""
        access_token = credentials.access_token
        source_url = config.get("source_url", "")
        doc_id = self._extract_doc_id(source_url)
        if not doc_id:
            raise ValueError(f"Invalid Google Docs URL or ID: {source_url}")

        doc_content = await self._fetch_document(access_token, doc_id)
        if not doc_content:
            raise ValueError(f"Failed to fetch document: {doc_id}")

        title = doc_content.get("title", "Untitled Document")
        markdown_content = self._convert_to_markdown(doc_content)
        content_hash = hashlib.sha256(markdown_content.encode()).hexdigest()[:16]

        return FetchResult(
            content=markdown_content,
            content_hash=content_hash,
            node_type="markdown",
            node_name=f"{title}.md",
            summary=f"Google Doc '{title}'",
        )

    def _extract_doc_id(self, source: str) -> Optional[str]:
        """Extract document ID from URL or return as-is if already an ID."""
        if not source:
            return None

        # Handle full URLs
        # Format: https://docs.google.com/document/d/DOC_ID/edit
        if "docs.google.com/document/d/" in source:
            parts = source.split("/document/d/")
            if len(parts) > 1:
                doc_id = parts[1].split("/")[0].split("?")[0]
                return doc_id

        # Handle oauth:// URLs
        if source.startswith("oauth://google-docs/"):
            return source.replace("oauth://google-docs/", "").split("?")[0]

        # Assume it's already a document ID
        if len(source) > 10 and "/" not in source:
            return source

        return None

    async def _fetch_document(self, access_token: str, doc_id: str) -> Optional[dict]:
        """Fetch document content from Google Docs API."""
        try:
            response = await self.client.get(
                f"{self.DOCS_API_URL}/{doc_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            log_error(f"Failed to fetch Google Doc {doc_id}: {e}")
            return None

    def _convert_to_markdown(self, doc_content: dict) -> str:
        """Convert Google Docs content to Markdown."""
        markdown_lines = []

        body = doc_content.get("body", {})
        content = body.get("content", [])

        for element in content:
            if "paragraph" in element:
                paragraph = element["paragraph"]
                paragraph_style = paragraph.get("paragraphStyle", {})
                named_style = paragraph_style.get("namedStyleType", "NORMAL_TEXT")

                text_parts = []
                for elem in paragraph.get("elements", []):
                    if "textRun" in elem:
                        text_run = elem["textRun"]
                        text = text_run.get("content", "")
                        text_style = text_run.get("textStyle", {})

                        # Apply text formatting
                        if text_style.get("bold"):
                            text = f"**{text.strip()}**"
                        if text_style.get("italic"):
                            text = f"*{text.strip()}*"
                        if text_style.get("strikethrough"):
                            text = f"~~{text.strip()}~~"
                        if text_style.get("link"):
                            url = text_style["link"].get("url", "")
                            text = f"[{text.strip()}]({url})"

                        text_parts.append(text)

                line = "".join(text_parts).rstrip()

                # Apply heading styles
                if named_style == "HEADING_1":
                    line = f"# {line}"
                elif named_style == "HEADING_2":
                    line = f"## {line}"
                elif named_style == "HEADING_3":
                    line = f"### {line}"
                elif named_style == "HEADING_4":
                    line = f"#### {line}"
                elif named_style == "HEADING_5":
                    line = f"##### {line}"
                elif named_style == "HEADING_6":
                    line = f"###### {line}"

                markdown_lines.append(line)

            elif "table" in element:
                # Basic table support
                table = element["table"]
                rows = table.get("tableRows", [])

                for i, row in enumerate(rows):
                    cells = row.get("tableCells", [])
                    cell_texts = []

                    for cell in cells:
                        cell_content = cell.get("content", [])
                        cell_text = ""
                        for cell_elem in cell_content:
                            if "paragraph" in cell_elem:
                                for text_elem in cell_elem["paragraph"].get("elements", []):
                                    if "textRun" in text_elem:
                                        cell_text += text_elem["textRun"].get("content", "").strip()
                        cell_texts.append(cell_text)

                    markdown_lines.append("| " + " | ".join(cell_texts) + " |")

                    # Add header separator after first row
                    if i == 0:
                        markdown_lines.append("| " + " | ".join(["---"] * len(cell_texts)) + " |")

                markdown_lines.append("")

        return "\n".join(markdown_lines)

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

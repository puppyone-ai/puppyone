"""
Google Docs Handler - Process Google Docs imports.

Imports Google Docs documents into content nodes as Markdown.
"""

from datetime import datetime
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
from src.ingest.saas.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.ingest.saas.task.models import ImportTask, ImportTaskType
from src.oauth.google_docs_service import GoogleDocsOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class GoogleDocsHandler(BaseHandler):
    """Handler for Google Docs imports."""

    DOCS_API_URL = "https://docs.googleapis.com/v1/documents"
    
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

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.GOOGLE_DOCS

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Google Docs import."""
        await on_progress(5, "Checking Google Docs connection...")

        # Get OAuth connection
        connection = await self.docs_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Google Docs not connected. Please authorize first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_email = metadata.get("user", {}).get("email", "Google Docs")

        config = task.config or {}
        
        # Parse source - should be a Google Docs URL or document ID
        source = task.source_url or ""
        doc_id = self._extract_doc_id(source)
        
        if not doc_id:
            raise ValueError(f"Invalid Google Docs URL or ID: {source}")

        await on_progress(10, f"Fetching document from {user_email}...")

        # Fetch document content
        doc_content = await self._fetch_document(access_token, doc_id)
        
        if not doc_content:
            raise ValueError(f"Failed to fetch document: {doc_id}")

        await on_progress(40, "Converting to Markdown...")

        # Convert to Markdown
        title = doc_content.get("title", "Untitled Document")
        markdown_content = self._convert_to_markdown(doc_content)

        await on_progress(70, "Creating content node...")

        # Create content node
        # Note: metadata (source, doc_id, etc.) is logged but not stored directly
        log_info(f"Google Docs import: doc_id={doc_id}, title={title}, user={user_email}")
        node = await self.node_service.create_markdown_node(
            project_id=task.project_id,
            name=f"{title}.md",
            content=markdown_content,
            parent_id=task.parent_node_id,
            created_by=task.user_id,
        )

        await on_progress(100, "Import complete!")

        return ImportResult(
            success=True,
            message=f"Successfully imported: {title}",
            node_id=node.id if node else None,
            items_processed=1,
        )

    async def preview(self, task: ImportTask) -> PreviewResult:
        """Preview Google Docs import."""
        connection = await self.docs_service.get_connection(task.user_id)
        if not connection:
            return PreviewResult(
                title="Google Docs",
                description="Not connected to Google Docs",
                item_count=0,
                items=[],
                metadata={"error": "Not authenticated"},
            )

        source = task.source_url or ""
        doc_id = self._extract_doc_id(source)

        if not doc_id:
            return PreviewResult(
                title="Google Docs",
                description="Invalid document URL or ID",
                item_count=0,
                items=[],
                metadata={"error": "Invalid URL"},
            )

        try:
            access_token = connection.access_token
            doc_content = await self._fetch_document(access_token, doc_id)
            
            if doc_content:
                title = doc_content.get("title", "Untitled Document")
                return PreviewResult(
                    title=title,
                    description=f"Google Doc: {title}",
                    item_count=1,
                    items=[{"name": title, "type": "document"}],
                    metadata={"doc_id": doc_id},
                )
        except Exception as e:
            log_error(f"Failed to preview Google Doc: {e}")

        return PreviewResult(
            title="Google Docs",
            description="Failed to fetch document",
            item_count=0,
            items=[],
            metadata={"error": "Fetch failed"},
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



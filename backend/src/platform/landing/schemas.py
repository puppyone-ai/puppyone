from __future__ import annotations

from pydantic import BaseModel, Field


class PreviewInfo(BaseModel):
    filename: str
    tool_kind: str
    content_chars: int = Field(..., description="Length of the parsed markdown")
    excerpt: str = Field(..., description="Leading slice of the parsed content")
    suggested_tools: list[str] = Field(
        default_factory=list,
        description="MCP tools the eventual endpoint will expose (for the preview panel)",
    )


class PreviewResponse(BaseModel):
    ticket: str = Field(..., description="Signed capability ticket to present at /landing/claim")
    preview: PreviewInfo
    expires_at: int = Field(..., description="Unix epoch seconds when the ticket/preview expires")


class ClaimRequest(BaseModel):
    ticket: str


class ClaimMcp(BaseModel):
    server_url: str
    api_key: str
    endpoint_id: str


class ClaimResponse(BaseModel):
    project_id: str
    repo: str = Field(..., description="Scope/folder path the content lives under")
    mcp: ClaimMcp
    deep_link: str = Field(..., description="Relative path into the app for the new repo")

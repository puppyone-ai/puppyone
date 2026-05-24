from typing import Optional, List
from pydantic import BaseModel, Field


class McpAccessItem(BaseModel):
    path: str
    json_path: str = ""
    readonly: bool = True


class McpToolItem(BaseModel):
    tool_id: str
    enabled: bool = True


class McpEndpointCreate(BaseModel):
    project_id: str = Field(..., description="Associated project ID")
    path: Optional[str] = Field(None, description="Associated version path")
    name: str = Field(default="MCP Endpoint", min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    accesses: List[McpAccessItem] = Field(default_factory=list)
    tools_config: List[McpToolItem] = Field(default_factory=list)


class McpEndpointUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    path: Optional[str] = None
    status: Optional[str] = None
    accesses: Optional[List[McpAccessItem]] = None
    tools_config: Optional[List[McpToolItem]] = None


class McpEndpointOut(BaseModel):
    id: str
    project_id: str
    path: Optional[str] = None
    name: str
    description: Optional[str] = None
    api_key: str
    tools_config: list = Field(default_factory=list)
    accesses: list = Field(default_factory=list)
    config: dict = Field(default_factory=dict)
    status: str
    created_at: str
    updated_at: str

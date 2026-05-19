"""
MCP data models

Defines Pydantic models corresponding to the mcp table, used for type checking and data validation.
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, ConfigDict


class McpBase(BaseModel):
    """MCP base model"""

    api_key: Optional[str] = None
    created_by: Optional[str] = None  # nullable, was user_id
    project_id: Optional[str] = None  # UUID, references project(id)
    table_id: Optional[str] = None  # UUID, references version path
    name: Optional[str] = None
    json_path: Optional[str] = None
    status: Optional[bool] = None
    port: Optional[int] = None
    docker_info: Optional[Dict[str, Any]] = None
    tools_definition: Optional[Dict[str, Any]] = None
    register_tools: Optional[List[str]] = None
    preview_keys: Optional[List[str]] = None


class McpCreate(McpBase):
    """MCP instance creation model"""



class McpUpdate(BaseModel):
    """MCP instance update model"""

    api_key: Optional[str] = None
    created_by: Optional[str] = None  # nullable, was user_id
    project_id: Optional[str] = None  # UUID, references project(id)
    table_id: Optional[str] = None  # UUID, references version path
    name: Optional[str] = None
    json_path: Optional[str] = None
    status: Optional[bool] = None
    port: Optional[int] = None
    docker_info: Optional[Dict[str, Any]] = None
    tools_definition: Optional[Dict[str, Any]] = None
    register_tools: Optional[List[str]] = None
    preview_keys: Optional[List[str]] = None


class McpResponse(McpBase):
    """MCP response model"""

    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

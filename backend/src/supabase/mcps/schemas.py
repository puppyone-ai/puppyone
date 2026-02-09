"""
MCP 数据模型

定义 mcp 表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, ConfigDict


class McpBase(BaseModel):
    """MCP 基础模型"""

    api_key: Optional[str] = None
    user_id: Optional[str] = None
    project_id: Optional[int] = None
    table_id: Optional[int] = None
    name: Optional[str] = None
    json_path: Optional[str] = None
    status: Optional[bool] = None
    port: Optional[int] = None
    docker_info: Optional[Dict[str, Any]] = None
    tools_definition: Optional[Dict[str, Any]] = None
    register_tools: Optional[List[str]] = None
    preview_keys: Optional[List[str]] = None


class McpCreate(McpBase):
    """创建 MCP 实例模型"""

    pass


class McpUpdate(BaseModel):
    """更新 MCP 实例模型"""

    api_key: Optional[str] = None
    user_id: Optional[str] = None
    project_id: Optional[int] = None
    table_id: Optional[int] = None
    name: Optional[str] = None
    json_path: Optional[str] = None
    status: Optional[bool] = None
    port: Optional[int] = None
    docker_info: Optional[Dict[str, Any]] = None
    tools_definition: Optional[Dict[str, Any]] = None
    register_tools: Optional[List[str]] = None
    preview_keys: Optional[List[str]] = None


class McpResponse(McpBase):
    """MCP 响应模型"""

    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

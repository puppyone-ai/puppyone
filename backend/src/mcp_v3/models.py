"""
MCP V3 领域模型

MCP V3 不再有独立的 MCP 实例表，而是复用 Agent 模型。
这里定义一些 MCP 特有的视图模型。
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class McpAgentInfo(BaseModel):
    """MCP 视角的 Agent 信息"""
    
    id: str = Field(..., description="Agent ID")
    name: str = Field(..., description="Agent 名称")
    icon: str = Field(default="✨", description="Agent 图标")
    mcp_api_key: str = Field(..., description="MCP API Key")
    mcp_enabled: bool = Field(default=True, description="MCP 是否启用")
    created_at: datetime = Field(..., description="创建时间")


class McpBoundTool(BaseModel):
    """MCP 绑定的工具信息"""
    
    id: str = Field(..., description="agent_tool 关联 ID")
    tool_id: str = Field(..., description="Tool ID")
    name: str = Field(..., description="工具名称")
    type: str = Field(..., description="工具类型")
    description: Optional[str] = Field(None, description="工具描述")
    node_id: Optional[str] = Field(None, description="绑定的节点 ID")
    json_path: str = Field(default="", description="JSON 路径")
    enabled: bool = Field(default=True, description="是否启用")
    mcp_exposed: bool = Field(default=True, description="是否 MCP 暴露")
    category: str = Field(default="builtin", description="工具分类")


"""
MCP V3 API 模型

请求/响应的数据结构定义
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ============================================
# 请求模型
# ============================================

class BindToolRequest(BaseModel):
    """绑定工具请求"""
    tool_id: str = Field(..., description="要绑定的 Tool ID")
    enabled: bool = Field(default=True, description="是否启用")
    mcp_exposed: bool = Field(default=True, description="是否通过 MCP 暴露")


class BindToolsRequest(BaseModel):
    """批量绑定工具请求"""
    bindings: List[BindToolRequest] = Field(..., description="绑定列表")


class UpdateToolBindingRequest(BaseModel):
    """更新工具绑定请求"""
    enabled: Optional[bool] = Field(None, description="是否启用")
    mcp_exposed: Optional[bool] = Field(None, description="是否通过 MCP 暴露")


class RegenerateMcpKeyRequest(BaseModel):
    """重新生成 MCP API Key 请求"""
    pass  # 暂时不需要参数


# ============================================
# 响应模型
# ============================================

class McpAgentOut(BaseModel):
    """MCP Agent 响应"""
    id: str
    name: str
    icon: str
    mcp_api_key: str
    mcp_enabled: bool = True
    created_at: datetime


class McpBoundToolOut(BaseModel):
    """MCP 绑定工具响应"""
    id: str  # agent_tool 关联 ID
    tool_id: str
    name: str
    type: str
    description: Optional[str] = None
    node_id: Optional[str] = None
    json_path: str = ""
    enabled: bool = True
    mcp_exposed: bool = True
    category: str = "builtin"
    created_at: Optional[datetime] = None


class McpStatusOut(BaseModel):
    """MCP 状态响应"""
    agent_id: str
    mcp_api_key: str
    mcp_enabled: bool
    tools_count: int
    mcp_exposed_count: int

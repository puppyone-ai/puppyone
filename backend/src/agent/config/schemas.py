"""
Agent Config Schemas

定义 API 请求和响应的 schema
"""

from typing import Optional, List, Literal
from pydantic import BaseModel, Field


# ============================================
# AgentAccess Schemas
# ============================================

class AgentAccessCreate(BaseModel):
    """创建 AgentAccess 的请求"""
    node_id: str = Field(..., description="Content Node ID")
    terminal: bool = Field(default=False)
    terminal_readonly: bool = Field(default=True)
    can_read: bool = Field(default=False)
    can_write: bool = Field(default=False)
    can_delete: bool = Field(default=False)
    json_path: str = Field(default="")


class AgentAccessUpdate(BaseModel):
    """更新 AgentAccess 的请求"""
    terminal: Optional[bool] = None
    terminal_readonly: Optional[bool] = None
    can_read: Optional[bool] = None
    can_write: Optional[bool] = None
    can_delete: Optional[bool] = None
    json_path: Optional[str] = None


class AgentAccessOut(BaseModel):
    """AgentAccess 响应"""
    id: str
    agent_id: str
    node_id: str
    terminal: bool
    terminal_readonly: bool
    can_read: bool
    can_write: bool
    can_delete: bool
    json_path: str

    # 可选：关联的 node 信息
    node_name: Optional[str] = None
    node_type: Optional[str] = None


# ============================================
# Agent Schemas
# ============================================

class AgentCreate(BaseModel):
    """创建 Agent 的请求"""
    name: str = Field(..., min_length=1, max_length=100, description="Agent 名称")
    icon: str = Field(default="✨", description="Agent 图标")
    type: Literal["chat", "devbox", "webhook", "schedule"] = Field(default="chat")
    description: Optional[str] = Field(None, max_length=500)
    
    # Schedule Agent 相关字段
    trigger_type: Optional[Literal["manual", "cron", "webhook"]] = Field(default="manual")
    trigger_config: Optional[dict] = Field(None, description="触发配置")
    task_content: Optional[str] = Field(None, description="任务内容")
    task_node_id: Optional[str] = Field(None, description="关联的任务文件 node ID")
    external_config: Optional[dict] = Field(None, description="外部配置 (N8N/Zapier)")
    
    # 可选：创建时直接指定访问权限
    accesses: List[AgentAccessCreate] = Field(default_factory=list)


class AgentUpdate(BaseModel):
    """更新 Agent 的请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    icon: Optional[str] = None
    type: Optional[Literal["chat", "devbox", "webhook", "schedule"]] = None
    description: Optional[str] = Field(None, max_length=500)
    is_default: Optional[bool] = None
    
    # Schedule Agent 相关字段
    trigger_type: Optional[Literal["manual", "cron", "webhook"]] = None
    trigger_config: Optional[dict] = None
    task_content: Optional[str] = None
    task_node_id: Optional[str] = None
    external_config: Optional[dict] = None


class AgentOut(BaseModel):
    """Agent 响应"""
    id: str
    name: str
    icon: str
    type: str
    description: Optional[str]
    is_default: bool
    created_at: str
    updated_at: str
    
    # MCP 外部访问
    mcp_api_key: Optional[str] = Field(None, description="MCP API key for external access")
    
    # Schedule Agent 相关字段
    trigger_type: Optional[str] = Field(default="manual")
    trigger_config: Optional[dict] = None
    task_content: Optional[str] = None
    task_node_id: Optional[str] = None
    external_config: Optional[dict] = None
    
    # 关联的访问权限
    accesses: List[AgentAccessOut] = Field(default_factory=list)


"""
Agent Config 数据模型

定义 Agent 和 AgentAccess 的业务领域模型
"""

from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


AgentType = Literal["chat", "devbox", "webhook", "schedule"]
TriggerType = Literal["manual", "cron", "webhook"]


class AgentAccess(BaseModel):
    """Agent 访问权限模型"""

    id: str = Field(..., description="访问权限ID")
    agent_id: str = Field(..., description="所属 Agent ID")
    node_id: str = Field(..., description="Content Node ID")

    # Terminal 权限
    terminal: bool = Field(default=False, description="是否有 Terminal 访问权限")
    terminal_readonly: bool = Field(default=True, description="Terminal 是否只读")

    # Data 权限
    can_read: bool = Field(default=False, description="是否可读")
    can_write: bool = Field(default=False, description="是否可写")
    can_delete: bool = Field(default=False, description="是否可删除")

    # JSON 路径（可选）
    json_path: str = Field(default="", description="JSON 内部路径")

    created_at: datetime = Field(..., description="创建时间")

    class Config:
        from_attributes = True


class Agent(BaseModel):
    """Agent 领域模型"""

    id: str = Field(..., description="Agent ID")
    user_id: str = Field(..., description="所属用户 ID")

    name: str = Field(..., description="Agent 名称")
    icon: str = Field(default="✨", description="Agent 图标")
    type: AgentType = Field(default="chat", description="Agent 类型")
    description: Optional[str] = Field(None, description="Agent 描述")

    is_default: bool = Field(default=False, description="是否为默认 Agent")
    
    # MCP 外部访问
    mcp_api_key: Optional[str] = Field(None, description="MCP API key for external access")
    
    # Schedule Agent 相关字段
    trigger_type: Optional[str] = Field(default="manual", description="触发类型: manual, cron, webhook")
    trigger_config: Optional[dict] = Field(None, description="触发配置 (cron 表达式等)")
    task_content: Optional[str] = Field(None, description="任务内容 (手写的 todo)")
    task_node_id: Optional[str] = Field(None, description="关联的任务文件 node ID")
    external_config: Optional[dict] = Field(None, description="外部配置 (N8N/Zapier 等)")

    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")

    # 关联的访问权限（可选，用于完整加载）
    accesses: List[AgentAccess] = Field(default_factory=list, description="访问权限列表")

    class Config:
        from_attributes = True


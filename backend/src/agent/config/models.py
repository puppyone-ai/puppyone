"""
Agent Config 数据模型

定义 Agent 和 AgentBash 的业务领域模型
"""

from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


AgentType = Literal["chat", "devbox", "webhook", "schedule"]
TriggerType = Literal["manual", "cron", "webhook"]


class AgentBash(BaseModel):
    """Agent Bash 终端访问权限模型"""

    id: str = Field(..., description="Bash 权限 ID")
    agent_id: str = Field(..., description="所属 Agent ID")
    node_id: str = Field(..., description="Content Node ID")
    json_path: str = Field(default="", description="JSON 内部路径")
    readonly: bool = Field(default=True, description="是否只读")
    created_at: datetime = Field(..., description="创建时间")

    class Config:
        from_attributes = True


# 为了向后兼容，保留 AgentAccess 别名
AgentAccess = AgentBash


class AgentTool(BaseModel):
    """Agent Tool 关联模型 - 关联 Agent 和 Tool"""

    id: str = Field(..., description="关联 ID")
    agent_id: str = Field(..., description="所属 Agent ID")
    tool_id: str = Field(..., description="关联的 Tool ID")
    enabled: bool = Field(default=True, description="是否启用")
    mcp_exposed: bool = Field(default=False, description="是否通过 MCP 对外暴露")
    created_at: datetime = Field(..., description="创建时间")

    class Config:
        from_attributes = True


class Agent(BaseModel):
    """Agent 领域模型"""

    id: str = Field(..., description="Agent ID")
    project_id: str = Field(..., description="所属项目 ID")
    # 注意：Agent 没有 user_id 字段，权限通过 project_id 验证

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

    # 关联的 Bash 访问权限（可选，用于完整加载）
    bash_accesses: List[AgentBash] = Field(default_factory=list, description="Bash 访问权限列表")
    
    # 关联的 Tools（可选，用于完整加载）
    tools: List[AgentTool] = Field(default_factory=list, description="关联的工具列表")
    
    # 为了向后兼容，保留 accesses 属性
    @property
    def accesses(self) -> List[AgentBash]:
        return self.bash_accesses
    
    @accesses.setter
    def accesses(self, value: List[AgentBash]):
        self.bash_accesses = value

    class Config:
        from_attributes = True


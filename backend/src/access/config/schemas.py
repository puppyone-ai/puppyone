"""
Agent Config Schemas

定义 API 请求和响应的 schema
"""

from typing import Optional, List, Literal
from pydantic import BaseModel, Field


# ============================================
# AgentBash Schemas (Bash 终端访问权限)
# ============================================

class AgentBashCreate(BaseModel):
    """创建 AgentBash 的请求"""
    node_id: str = Field(..., description="Content Node ID")
    json_path: str = Field(default="", description="JSON 内部路径")
    readonly: bool = Field(default=True, description="是否只读")


class AgentBashUpdate(BaseModel):
    """更新 AgentBash 的请求"""
    json_path: Optional[str] = None
    readonly: Optional[bool] = None


class AgentBashOut(BaseModel):
    """AgentBash 响应"""
    id: str
    agent_id: str
    node_id: str
    json_path: str
    readonly: bool

    # 可选：关联的 node 信息
    node_name: Optional[str] = None
    node_type: Optional[str] = None


# ============================================
# 向后兼容的别名 (AgentAccess)
# ============================================

class AgentAccessCreate(BaseModel):
    """创建 AgentAccess 的请求（向后兼容）"""
    node_id: str = Field(..., description="Content Node ID")
    terminal: bool = Field(default=False)
    terminal_readonly: bool = Field(default=True)
    can_read: bool = Field(default=False)
    can_write: bool = Field(default=False)
    can_delete: bool = Field(default=False)
    json_path: str = Field(default="")
    
    def to_bash_create(self) -> AgentBashCreate:
        """转换为 AgentBashCreate"""
        return AgentBashCreate(
            node_id=self.node_id,
            json_path=self.json_path,
            readonly=self.terminal_readonly if self.terminal else True,
        )


class AgentAccessUpdate(BaseModel):
    """更新 AgentAccess 的请求（向后兼容）"""
    terminal: Optional[bool] = None
    terminal_readonly: Optional[bool] = None
    can_read: Optional[bool] = None
    can_write: Optional[bool] = None
    can_delete: Optional[bool] = None
    json_path: Optional[str] = None


class AgentAccessOut(BaseModel):
    """AgentAccess 响应（向后兼容）"""
    id: str
    agent_id: str
    node_id: str
    terminal: bool = True  # 新版默认都是 terminal 访问
    terminal_readonly: bool = True
    can_read: bool = False
    can_write: bool = False
    can_delete: bool = False
    json_path: str = ""

    # 可选：关联的 node 信息
    node_name: Optional[str] = None
    node_type: Optional[str] = None
    
    @classmethod
    def from_bash(cls, bash: "AgentBashOut") -> "AgentAccessOut":
        """从 AgentBashOut 转换"""
        return cls(
            id=bash.id,
            agent_id=bash.agent_id,
            node_id=bash.node_id,
            terminal=True,
            terminal_readonly=bash.readonly,
            can_read=False,
            can_write=not bash.readonly,
            can_delete=False,
            json_path=bash.json_path,
            node_name=bash.node_name,
            node_type=bash.node_type,
        )


# ============================================
# Agent Schemas
# ============================================

class AgentCreate(BaseModel):
    """创建 Agent 的请求"""
    project_id: str = Field(..., description="所属项目 ID（必填）")
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
    
    # Bash 访问权限
    bash_accesses: List[AgentBashCreate] = Field(default_factory=list)
    
    # 向后兼容：旧的 accesses 字段
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
    project_id: str  # 所属项目 ID（必填）
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
    
    # Bash 访问权限（新版）
    bash_accesses: List[AgentBashOut] = Field(default_factory=list)
    
    # 向后兼容：旧的 accesses 字段
    accesses: List[AgentAccessOut] = Field(default_factory=list)


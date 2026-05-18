"""
Agent Config Schemas
"""

from typing import Optional, List, Literal
from pydantic import BaseModel, Field


# ============================================
# AgentBash Schemas
# ============================================

class AgentBashCreate(BaseModel):
    path: str = Field(..., description="version path")
    readonly: bool = Field(default=True)


class AgentBashUpdate(BaseModel):
    readonly: Optional[bool] = None


class AgentBashOut(BaseModel):
    id: str
    agent_id: str
    path: str
    readonly: bool

    node_name: Optional[str] = None
    node_type: Optional[str] = None


# ============================================
# Agent Schemas
# ============================================

class AgentCreate(BaseModel):
    project_id: str = Field(..., description="Project ID")
    name: str = Field(..., min_length=1, max_length=100)
    icon: str = Field(default="✨")
    type: Literal["chat", "devbox", "webhook", "schedule"] = Field(default="chat")
    description: Optional[str] = Field(None, max_length=500)

    trigger_type: Optional[Literal["manual", "cron", "webhook"]] = Field(default="manual")
    trigger_config: Optional[dict] = Field(None)
    task_content: Optional[str] = Field(None)
    task_path: Optional[str] = Field(None)
    external_config: Optional[dict] = Field(None)

    bash_accesses: List[AgentBashCreate] = Field(default_factory=list)


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    icon: Optional[str] = None
    type: Optional[Literal["chat", "devbox", "webhook", "schedule"]] = None
    description: Optional[str] = Field(None, max_length=500)
    is_default: Optional[bool] = None

    trigger_type: Optional[Literal["manual", "cron", "webhook"]] = None
    trigger_config: Optional[dict] = None
    task_content: Optional[str] = None
    task_path: Optional[str] = None
    external_config: Optional[dict] = None


class AgentOut(BaseModel):
    id: str
    project_id: str
    name: str
    icon: str
    type: str
    description: Optional[str]
    is_default: bool
    created_at: str
    updated_at: str

    mcp_api_key: Optional[str] = Field(None, description="MCP API key for external access")

    trigger_type: Optional[str] = Field(default="manual")
    trigger_config: Optional[dict] = None
    task_content: Optional[str] = None
    task_path: Optional[str] = None
    external_config: Optional[dict] = None

    bash_accesses: List[AgentBashOut] = Field(default_factory=list)

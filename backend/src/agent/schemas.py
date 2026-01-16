from typing import Literal, Optional, List
from pydantic import BaseModel, Field


class BashAccessPoint(BaseModel):
    path: str = Field("", description="JSON 路径，空字符串代表根")
    mode: Literal["readonly", "full"] = Field(
        "readonly", description="bash 权限模式"
    )


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"] = Field(..., description="消息角色")
    content: str = Field(..., description="消息文本内容")


class AgentRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="用户输入内容")
    chatHistory: Optional[List[ChatHistoryItem]] = Field(
        None, description="历史对话消息"
    )
    table_id: Optional[int] = Field(None, description="表格 ID")
    workingDirectory: Optional[str] = Field(
        None, description="工作目录（用于文件工具）"
    )
    bashAccessPoints: Optional[List[BashAccessPoint]] = Field(
        None, description="Bash 权限点列表"
    )


class AgentEvent(BaseModel):
    type: str

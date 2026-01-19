from typing import Literal, Optional, List
from pydantic import BaseModel, Field


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"] = Field(
        "user", description="消息角色（兼容旧客户端，缺省为 user）"
    )
    content: str = Field(..., description="消息文本内容")


class AgentRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="用户输入内容")
    session_id: Optional[str] = Field(
        None, description="聊天会话 ID（用于服务端持久化与加载历史）"
    )
    chatHistory: Optional[List[ChatHistoryItem]] = Field(
        None, description="历史对话消息"
    )
    # 新版：只传 tool IDs，后端自动处理一切
    active_tool_ids: Optional[List[str]] = Field(
        None, description="用户选中的 Tool ID 列表（后端自动查库获取配置）"
    )


class AgentEvent(BaseModel):
    type: str

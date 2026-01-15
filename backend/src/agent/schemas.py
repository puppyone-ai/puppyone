from typing import Literal, Optional, List
from pydantic import BaseModel, Field


class BashAccessPoint(BaseModel):
    path: str = Field("", description="JSON 路径，空字符串代表根")
    mode: Literal["readonly", "full"] = Field(
        "readonly", description="bash 权限模式"
    )


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentRequest(BaseModel):
    prompt: str
    chatHistory: Optional[List[ChatHistoryItem]] = None
    table_id: Optional[int] = None
    workingDirectory: Optional[str] = None
    bashAccessPoints: Optional[List[BashAccessPoint]] = None


class AgentEvent(BaseModel):
    type: str

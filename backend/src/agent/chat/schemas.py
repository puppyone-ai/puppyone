from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ChatSession(BaseModel):
    id: str
    user_id: str
    title: Optional[str] = None
    mode: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ChatMessage(BaseModel):
    id: str
    session_id: str
    role: Literal["user", "assistant"]
    content: Optional[str] = None
    parts: Optional[list[dict[str, Any]]] = None
    created_at: Optional[str] = None


class ChatSessionCreate(BaseModel):
    user_id: str
    title: Optional[str] = None
    mode: str = "agent"


class ChatMessageCreate(BaseModel):
    session_id: str
    role: Literal["user", "assistant"]
    content: Optional[str] = None
    parts: Optional[list[dict[str, Any]]] = Field(default=None)



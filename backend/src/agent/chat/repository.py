from __future__ import annotations

from typing import Any, Optional

from supabase import Client

from src.agent.chat.schemas import (
    ChatMessage,
    ChatMessageCreate,
    ChatSession,
    ChatSessionCreate,
)
from src.supabase.exceptions import handle_supabase_error


class ChatRepositorySupabase:
    def __init__(self, client: Client):
        self._client = client

    def create_session(self, input: ChatSessionCreate) -> ChatSession:
        try:
            resp = (
                self._client.table("chat_sessions")
                .insert(input.model_dump(exclude_none=True))
                .execute()
            )
            return ChatSession(**resp.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 chat session")

    def get_session_for_user(
        self, *, session_id: str, user_id: str
    ) -> Optional[ChatSession]:
        try:
            resp = (
                self._client.table("chat_sessions")
                .select("*")
                .eq("id", session_id)
                .eq("user_id", user_id)
                .execute()
            )
            data = None
            if isinstance(resp.data, list):
                data = resp.data[0] if resp.data else None
            elif isinstance(resp.data, dict):
                data = resp.data
            if not data:
                return None
            return ChatSession(**data)
        except Exception as e:
            raise handle_supabase_error(e, "获取 chat session")

    def update_session_title(
        self, *, session_id: str, user_id: str, title: str
    ) -> None:
        try:
            (
                self._client.table("chat_sessions")
                .update({"title": title})
                .eq("id", session_id)
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as e:
            raise handle_supabase_error(e, "更新 chat session title")

    def create_message(self, input: ChatMessageCreate) -> ChatMessage:
        try:
            payload: dict[str, Any] = input.model_dump(exclude_none=True)
            resp = (
                self._client.table("chat_messages")
                .insert(payload)
                .execute()
            )
            return ChatMessage(**resp.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建 chat message")

    def list_messages_for_user(
        self, *, session_id: str, user_id: str, limit: int = 100
    ) -> list[ChatMessage]:
        """
        Load messages for a session, but only if that session belongs to the user.
        This is important because the backend may use a service role Supabase key (bypassing RLS).
        """
        session = self.get_session_for_user(session_id=session_id, user_id=user_id)
        if session is None:
            return []
        try:
            resp = (
                self._client.table("chat_messages")
                .select("*")
                .eq("session_id", session_id)
                .order("created_at", desc=False)
                .limit(limit)
                .execute()
            )
            return [ChatMessage(**row) for row in (resp.data or [])]
        except Exception as e:
            raise handle_supabase_error(e, "获取 chat messages")



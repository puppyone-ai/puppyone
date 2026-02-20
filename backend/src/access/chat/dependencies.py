from __future__ import annotations

from supabase import Client

from src.access.chat.repository import ChatRepositorySupabase
from src.access.chat.service import ChatService
from src.supabase.dependencies import get_supabase_client

_chat_service: ChatService | None = None


def get_chat_service() -> ChatService:
    global _chat_service
    if _chat_service is None:
        client: Client = get_supabase_client()
        repo = ChatRepositorySupabase(client)
        _chat_service = ChatService(repo)
    return _chat_service









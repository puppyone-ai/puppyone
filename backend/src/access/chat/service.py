from __future__ import annotations

from typing import Any, Optional

from src.access.chat.repository import ChatRepositorySupabase
from src.access.chat.schemas import ChatMessage, ChatMessageCreate, ChatSessionCreate


def _generate_session_title(first_message: str, max_len: int = 30) -> str:
    cleaned = (first_message or "").replace("\n", " ").strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[:max_len] + "..."


class ChatService:
    def __init__(self, repo: ChatRepositorySupabase):
        self.repo = repo

    def ensure_session(
        self, *, user_id: str, session_id: Optional[str], agent_id: Optional[str] = None, mode: str = "agent"
    ) -> tuple[str, bool]:
        """
        Returns (session_id, created).
        If session_id is provided, verifies it belongs to user_id.
        """
        if session_id:
            existing = self.repo.get_session_for_user(
                session_id=session_id, user_id=user_id
            )
            if existing is None:
                raise PermissionError("Invalid session_id for current user")
            return session_id, False

        created = self.repo.create_session(ChatSessionCreate(user_id=user_id, agent_id=agent_id, mode=mode))
        return created.id, True

    def maybe_set_title_on_first_message(
        self, *, user_id: str, session_id: str, first_message: str
    ) -> None:
        title = _generate_session_title(first_message)
        self.repo.update_session_title(
            session_id=session_id, user_id=user_id, title=title
        )

    def add_user_message(self, *, session_id: str, content: str) -> ChatMessage:
        return self.repo.create_message(
            ChatMessageCreate(session_id=session_id, role="user", content=content)
        )

    def add_assistant_message(
        self,
        *,
        session_id: str,
        content: str,
        parts: Optional[list[dict[str, Any]]] = None,
    ) -> ChatMessage:
        return self.repo.create_message(
            ChatMessageCreate(
                session_id=session_id, role="assistant", content=content, parts=parts
            )
        )

    def load_history_for_llm(
        self, *, user_id: str, session_id: str, limit: int = 60
    ) -> list[dict[str, str]]:
        msgs = self.repo.list_messages_for_user(
            session_id=session_id, user_id=user_id, limit=limit
        )
        history: list[dict[str, str]] = []
        for m in msgs:
            if m.role not in ("user", "assistant"):
                continue
            history.append({"role": m.role, "content": m.content or ""})
        return [h for h in history if h.get("content")]



"""
Chat REST API — all chat session/message CRUD goes through backend.
Frontend no longer reads Supabase directly.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.agent.chat.dependencies import get_chat_service
from src.agent.chat.schemas import (
    CreateSessionRequest,
    MessageResponse,
    SessionResponse,
    UpdateSessionRequest,
)
from src.agent.chat.service import ChatService
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse

router = APIRouter(prefix="/chat", tags=["chat"])


def _session_to_response(s) -> SessionResponse:
    return SessionResponse(
        id=s.id,
        agent_id=s.agent_id,
        title=s.title,
        mode=s.mode,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


def _message_to_response(m) -> MessageResponse:
    return MessageResponse(
        id=m.id,
        session_id=m.session_id,
        role=m.role,
        content=m.content,
        parts=m.parts,
        created_at=m.created_at,
    )


# ── Sessions ──


@router.post("/sessions", summary="Create a chat session")
async def create_session(
    body: CreateSessionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
):
    session = chat_service.create_session(
        user_id=current_user.user_id,
        agent_id=body.agent_id,
        title=body.title,
        mode=body.mode,
    )
    return ApiResponse.success(data=_session_to_response(session))


@router.get("/sessions", summary="List chat sessions")
async def list_sessions(
    agent_id: Optional[str] = Query(None, description="Filter by agent ID"),
    limit: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
):
    sessions = chat_service.list_sessions(
        user_id=current_user.user_id,
        agent_id=agent_id,
        limit=limit,
    )
    return ApiResponse.success(data=[_session_to_response(s) for s in sessions])


@router.get("/sessions/{session_id}", summary="Get a session")
async def get_session(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
):
    session = chat_service.get_session(user_id=current_user.user_id, session_id=session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return ApiResponse.success(data=_session_to_response(session))


@router.patch("/sessions/{session_id}", summary="Update a session")
async def update_session(
    session_id: str,
    body: UpdateSessionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
):
    session = chat_service.update_session(
        user_id=current_user.user_id,
        session_id=session_id,
        title=body.title,
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return ApiResponse.success(data=_session_to_response(session))


@router.delete("/sessions/{session_id}", summary="Delete a session")
async def delete_session(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
):
    ok = chat_service.delete_session(user_id=current_user.user_id, session_id=session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return ApiResponse.success(message="Session deleted")


# ── Messages ──


@router.get("/sessions/{session_id}/messages", summary="List messages in a session")
async def list_messages(
    session_id: str,
    limit: int = Query(200, ge=1, le=500),
    current_user: CurrentUser = Depends(get_current_user),
    chat_service: ChatService = Depends(get_chat_service),
):
    messages = chat_service.list_messages(
        user_id=current_user.user_id,
        session_id=session_id,
        limit=limit,
    )
    return ApiResponse.success(data=[_message_to_response(m) for m in messages])

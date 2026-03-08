"""
Auth router — for CLI / external clients

POST   /auth/login       Sign in with email + password, returns access_token
POST   /auth/refresh     Refresh access_token
POST   /auth/initialize  Idempotent user initialization (profile + org)
GET    /auth/config      Public Supabase config (URL + anon key) for Realtime
"""

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client
from src.common_schemas import ApiResponse
from src.auth.dependencies import get_current_user, get_initialization_service, CurrentUser
from src.auth.initialization import UserInitializationService

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    user_email: str


class RefreshRequest(BaseModel):
    refresh_token: str


def _make_auth_client():
    """Create a throwaway Supabase client for auth operations only.

    This avoids contaminating the global singleton's PostgREST session
    (sign_in_with_password stores the user token, which would cause all
    subsequent DB queries to run under RLS instead of service_role).
    """
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    return create_client(url, key)


class RealtimeConfig(BaseModel):
    supabase_url: str
    supabase_anon_key: str


@router.get("/config", response_model=ApiResponse[RealtimeConfig])
def get_public_config():
    """Return public Supabase config needed by CLI for Realtime subscriptions."""
    url = os.environ.get("SUPABASE_URL", "")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not anon_key:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL or SUPABASE_ANON_KEY not configured on server",
        )
    return ApiResponse.success(data=RealtimeConfig(
        supabase_url=url, supabase_anon_key=anon_key,
    ))


@router.post("/login", response_model=ApiResponse[LoginResponse])
def login(body: LoginRequest):
    try:
        auth_client = _make_auth_client()
        result = auth_client.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })

        session = result.session
        if not session:
            raise HTTPException(status_code=401, detail="Login failed: unable to create session")

        return ApiResponse.success(data=LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in,
            user_email=result.user.email if result.user else body.email,
        ))

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "Invalid login" in error_msg or "invalid" in error_msg.lower():
            raise HTTPException(status_code=401, detail="Invalid email or password")
        raise HTTPException(status_code=401, detail=f"Login failed: {error_msg}")


@router.post("/refresh", response_model=ApiResponse[LoginResponse])
def refresh_token(body: RefreshRequest):
    try:
        auth_client = _make_auth_client()
        result = auth_client.auth.refresh_session(body.refresh_token)

        session = result.session
        if not session:
            raise HTTPException(status_code=401, detail="Refresh failed: invalid session")

        return ApiResponse.success(data=LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in,
            user_email=result.user.email if result.user else "",
        ))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Refresh failed: {str(e)}")


class InitializeResponse(BaseModel):
    org_id: str
    is_new_org: bool


@router.post("/initialize", response_model=ApiResponse[InitializeResponse])
def initialize_user(
    current_user: CurrentUser = Depends(get_current_user),
    init_service: UserInitializationService = Depends(get_initialization_service),
):
    """Idempotent user initialization: ensures profile + default org + membership exist."""
    result = init_service.ensure_initialized(
        user_id=current_user.user_id,
        email=current_user.email,
        display_name=current_user.user_metadata.get("full_name") if current_user.user_metadata else None,
    )
    return ApiResponse.success(data=InitializeResponse(**result))

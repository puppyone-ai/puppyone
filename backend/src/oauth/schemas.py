"""OAuth API schemas."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class OAuthAuthorizeRequest(BaseModel):
    """Request for OAuth authorization."""

    pass


class OAuthAuthorizeResponse(BaseModel):
    """Response containing OAuth authorization URL."""

    authorization_url: str


class OAuthCallbackRequest(BaseModel):
    """Request for OAuth callback."""

    code: str
    state: Optional[str] = None


class OAuthCallbackResponse(BaseModel):
    """Response for OAuth callback."""

    success: bool
    message: str
    workspace_name: Optional[str] = None
    username: Optional[str] = None


class OAuthStatusResponse(BaseModel):
    """Response for OAuth status check."""

    connected: bool
    workspace_name: Optional[str] = None
    username: Optional[str] = None
    connected_at: Optional[datetime] = None


class OAuthDisconnectResponse(BaseModel):
    """Response for OAuth disconnect."""

    success: bool
    message: str

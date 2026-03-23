"""OAuth router — factory-generated endpoints for all providers.

Each provider gets 4 endpoints (authorize, callback, status, disconnect)
generated from a shared template. This replaces ~1200 lines of duplicated
code with a ~120-line factory + provider config table.
"""

from typing import Annotated, Callable

from fastapi import APIRouter, Depends, HTTPException

from src.config import settings
from src.platform.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse
from src.oauth.dependencies import (
    get_notion_service,
    get_github_service,
    get_google_sheets_service,
    get_gmail_service,
    get_google_drive_service,
    get_google_calendar_service,
    get_google_docs_service,
    get_linear_service,
    get_airtable_service,
)
from src.oauth.schemas import (
    OAuthAuthorizeResponse,
    OAuthCallbackRequest,
    OAuthCallbackResponse,
    OAuthStatusResponse,
    OAuthDisconnectResponse,
)

router = APIRouter(prefix="/oauth", tags=["oauth"])


# ── Provider configuration ────────────────────────────────────

def _check_notion() -> bool:
    return bool(settings.NOTION_CLIENT_ID and settings.NOTION_CLIENT_SECRET)

def _check_github() -> bool:
    return bool(settings.GITHUB_CLIENT_ID and settings.GITHUB_CLIENT_SECRET)

def _check_google() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)

def _check_linear() -> bool:
    return bool(settings.LINEAR_CLIENT_ID and settings.LINEAR_CLIENT_SECRET)

def _check_airtable() -> bool:
    return bool(settings.AIRTABLE_CLIENT_ID and settings.AIRTABLE_CLIENT_SECRET)


OAUTH_PROVIDERS: list[dict] = [
    {"name": "Notion",          "slug": "notion",          "dep": get_notion_service,          "check": _check_notion},
    {"name": "GitHub",          "slug": "github",          "dep": get_github_service,          "check": _check_github},
    {"name": "Google Sheets",   "slug": "google-sheets",   "dep": get_google_sheets_service,   "check": _check_google},
    {"name": "Linear",          "slug": "linear",          "dep": get_linear_service,          "check": _check_linear},
    {"name": "Airtable",        "slug": "airtable",        "dep": get_airtable_service,        "check": _check_airtable},
    {"name": "Gmail",           "slug": "gmail",           "dep": get_gmail_service,           "check": _check_google},
    {"name": "Google Drive",    "slug": "google-drive",    "dep": get_google_drive_service,    "check": _check_google},
    {"name": "Google Calendar",  "slug": "google-calendar", "dep": get_google_calendar_service, "check": _check_google},
    {"name": "Google Docs",     "slug": "google-docs",     "dep": get_google_docs_service,     "check": _check_google},
]


# ── Endpoint factory ──────────────────────────────────────────

def _register_oauth_provider(
    target_router: APIRouter,
    name: str,
    slug: str,
    dep: Callable,
    check: Callable[[], bool],
) -> None:
    """Register the 4 standard OAuth endpoints for a single provider."""

    @target_router.get(
        f"/{slug}/authorize",
        response_model=ApiResponse[OAuthAuthorizeResponse],
        name=f"{slug}_authorize",
    )
    async def authorize(service=Depends(dep)):
        f"""Get {name} OAuth authorization URL."""
        try:
            if not check():
                raise HTTPException(
                    status_code=500,
                    detail=f"{name} OAuth is not configured. "
                           f"Please set the required environment variables.",
                )
            authorization_url, _ = await service.get_authorization_url()
            return ApiResponse.success(
                data=OAuthAuthorizeResponse(authorization_url=authorization_url),
                message=f"{name} authorization URL generated",
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to generate {name} authorization URL: {e}",
            )

    @target_router.post(
        f"/{slug}/callback",
        response_model=ApiResponse[OAuthCallbackResponse],
        name=f"{slug}_callback",
    )
    async def callback(
        request: OAuthCallbackRequest,
        current_user=Depends(get_current_user),
        service=Depends(dep),
    ):
        f"""Handle {name} OAuth callback."""
        try:
            success, message, connection_info = await service.handle_callback(
                user_id=current_user.user_id, code=request.code,
            )
            return ApiResponse.success(
                data=OAuthCallbackResponse(
                    success=success,
                    message=message,
                    workspace_name=(
                        connection_info.get("workspace_name")
                        if connection_info else None
                    ),
                ),
                message=f"{name} OAuth callback handled",
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to handle {name} callback: {e}",
            )

    @target_router.get(
        f"/{slug}/status",
        response_model=ApiResponse[OAuthStatusResponse],
        name=f"{slug}_status",
    )
    async def status(
        current_user=Depends(get_current_user),
        service=Depends(dep),
    ):
        f"""Check {name} connection status."""
        try:
            connection = await service.get_connection(current_user.user_id)
            if connection:
                is_expired = await service.is_token_expired(current_user.user_id)
                if is_expired:
                    connection = await service.refresh_token_if_needed(
                        current_user.user_id
                    )
                return ApiResponse.success(
                    data=OAuthStatusResponse(
                        connected=connection is not None,
                        workspace_name=connection.workspace_name if connection else None,
                        connected_at=connection.created_at if connection else None,
                    ),
                    message=f"{name} connection status retrieved",
                )
            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=False, workspace_name=None, connected_at=None,
                ),
                message=f"{name} connection status retrieved",
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to check {name} status: {e}",
            )

    @target_router.delete(
        f"/{slug}/disconnect",
        response_model=ApiResponse[OAuthDisconnectResponse],
        name=f"{slug}_disconnect",
    )
    async def disconnect(
        current_user=Depends(get_current_user),
        service=Depends(dep),
    ):
        f"""Disconnect {name} integration."""
        try:
            success = await service.disconnect(current_user.user_id)
            if success:
                return ApiResponse.success(
                    data=OAuthDisconnectResponse(
                        success=True,
                        message=f"Successfully disconnected from {name}",
                    ),
                    message=f"{name} disconnected",
                )
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message=f"No active {name} connection found",
                ),
                message=f"No active {name} connection",
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to disconnect from {name}: {e}",
            )


# ── Register all providers ────────────────────────────────────

for _provider in OAUTH_PROVIDERS:
    _register_oauth_provider(
        router,
        name=_provider["name"],
        slug=_provider["slug"],
        dep=_provider["dep"],
        check=_provider["check"],
    )

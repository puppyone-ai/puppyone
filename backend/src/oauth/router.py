"""OAuth router for handling third-party platform authentication."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.config import settings
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse
from src.oauth.dependencies import (
    get_notion_service,
    get_github_service,
    get_google_sheets_service,
    get_gmail_service,
    get_google_drive_service,
    get_google_calendar_service,
    get_linear_service,
    get_airtable_service,
)
from src.oauth.notion_service import NotionOAuthService
from src.oauth.github_service import GithubOAuthService
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.oauth.gmail_service import GmailOAuthService
from src.oauth.google_drive_service import GoogleDriveOAuthService
from src.oauth.google_calendar_service import GoogleCalendarOAuthService
from src.oauth.linear_service import LinearOAuthService
from src.oauth.airtable_service import AirtableOAuthService
from src.oauth.schemas import (
    OAuthAuthorizeResponse,
    OAuthCallbackRequest,
    OAuthCallbackResponse,
    OAuthStatusResponse,
    OAuthDisconnectResponse,
)

router = APIRouter(prefix="/oauth", tags=["oauth"])


@router.get("/notion/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def notion_authorize(
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)],
):
    """Get Notion OAuth authorization URL."""
    try:
        # Check if Notion OAuth is properly configured
        if not settings.NOTION_CLIENT_ID or not settings.NOTION_CLIENT_SECRET:
            raise HTTPException(
                status_code=500,
                detail="Notion OAuth is not configured. Please set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables.",
            )

        authorization_url, _ = await notion_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="授权URL生成成功",
        )
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to generate authorization URL: {str(e)}"
        )


@router.post("/notion/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def notion_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)],
):
    """Handle Notion OAuth callback."""
    try:
        success, message, connection_info = await notion_service.handle_callback(
            user_id=current_user.user_id, code=request.code
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("workspace_name")
                if connection_info
                else None,
            ),
            message="OAuth回调处理完成",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to handle Notion callback: {str(e)}"
        )


@router.get("/notion/status", response_model=ApiResponse[OAuthStatusResponse])
async def notion_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)],
):
    """Check Notion connection status."""
    try:
        connection = await notion_service.get_connection(current_user.user_id)

        if connection:
            # Check if token is expired
            is_expired = await notion_service.is_token_expired(current_user.user_id)
            if is_expired:
                # Try to refresh token
                connection = await notion_service.refresh_token_if_needed(
                    current_user.user_id
                )

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Notion连接状态获取成功",
            )
        else:
            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=False, workspace_name=None, connected_at=None
                ),
                message="Notion连接状态获取成功",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to check Notion status: {str(e)}"
        )


@router.delete(
    "/notion/disconnect", response_model=ApiResponse[OAuthDisconnectResponse]
)
async def notion_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)],
):
    """Disconnect Notion integration."""
    try:
        success = await notion_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True, message="Successfully disconnected from Notion"
                ),
                message="Notion断开连接成功",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False, message="No active Notion connection found"
                ),
                message="没有找到活跃的Notion连接",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to disconnect from Notion: {str(e)}"
        )


@router.get("/github/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def github_authorize(
    github_service: Annotated[GithubOAuthService, Depends(get_github_service)],
):
    """Get GitHub OAuth authorization URL."""
    try:
        if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
            raise HTTPException(
                status_code=500,
                detail="GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.",
            )

        authorization_url, _ = await github_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="GitHub授权URL生成成功",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate GitHub authorization URL: {str(e)}",
        )


@router.post("/github/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def github_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    github_service: Annotated[GithubOAuthService, Depends(get_github_service)],
):
    """Handle GitHub OAuth callback."""
    try:
        success, message, connection_info = await github_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("username")
                if connection_info
                else None,
                username=connection_info.get("username") if connection_info else None,
            ),
            message="GitHub OAuth回调处理完成",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle GitHub callback: {str(e)}",
        )


@router.get("/github/status", response_model=ApiResponse[OAuthStatusResponse])
async def github_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    github_service: Annotated[GithubOAuthService, Depends(get_github_service)],
):
    """Check GitHub connection status."""
    try:
        connection = await github_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await github_service.is_token_expired(current_user.user_id)
            if is_expired:
                connection = await github_service.refresh_token_if_needed(
                    current_user.user_id
                )

            username = None
            if connection:
                metadata = (
                    connection.metadata if isinstance(connection.metadata, dict) else {}
                )
                if connection.workspace_name:
                    username = connection.workspace_name
                elif metadata.get("user"):
                    username = metadata["user"].get("login")

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    username=username,
                    connected_at=connection.created_at if connection else None,
                ),
                message="GitHub连接状态获取成功",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                username=None,
                connected_at=None,
            ),
            message="GitHub连接状态获取成功",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check GitHub status: {str(e)}",
        )


@router.delete(
    "/github/disconnect", response_model=ApiResponse[OAuthDisconnectResponse]
)
async def github_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    github_service: Annotated[GithubOAuthService, Depends(get_github_service)],
):
    """Disconnect GitHub integration."""
    try:
        success = await github_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from GitHub",
                ),
                message="GitHub断开连接成功",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active GitHub connection found",
                ),
                message="没有找到活跃的GitHub连接",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from GitHub: {str(e)}",
        )


# OAuth callback route for browser redirects
@router.get("/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def oauth_callback_browser(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)],
    code: str = Query(..., description="Authorization code"),
    state: str = Query(None, description="OAuth state parameter"),
):
    """Handle OAuth callback from browser redirect."""
    try:
        success, message, connection_info = await notion_service.handle_callback(
            user_id=current_user.user_id, code=code
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("workspace_name")
                if connection_info
                else None,
            ),
            message="OAuth回调处理完成",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to handle OAuth callback: {str(e)}"
        )


# Google Sheets OAuth endpoints
@router.get(
    "/google-sheets/authorize", response_model=ApiResponse[OAuthAuthorizeResponse]
)
async def google_sheets_authorize(
    google_sheets_service: Annotated[
        GoogleSheetsOAuthService, Depends(get_google_sheets_service)
    ],
):
    """Get Google Sheets OAuth authorization URL."""
    try:
        if (
            not settings.GOOGLE_SHEETS_CLIENT_ID
            or not settings.GOOGLE_SHEETS_CLIENT_SECRET
        ):
            raise HTTPException(
                status_code=500,
                detail="Google Sheets OAuth is not configured. Please set GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET environment variables.",
            )

        authorization_url, _ = await google_sheets_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="Google Sheets authorization URL generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Google Sheets authorization URL: {str(e)}",
        )


@router.post(
    "/google-sheets/callback", response_model=ApiResponse[OAuthCallbackResponse]
)
async def google_sheets_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    google_sheets_service: Annotated[
        GoogleSheetsOAuthService, Depends(get_google_sheets_service)
    ],
):
    """Handle Google Sheets OAuth callback."""
    try:
        success, message, connection_info = await google_sheets_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("email")
                if connection_info
                else None,
            ),
            message="Google Sheets OAuth callback processed",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Google Sheets callback: {str(e)}",
        )


@router.get("/google-sheets/status", response_model=ApiResponse[OAuthStatusResponse])
async def google_sheets_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    google_sheets_service: Annotated[
        GoogleSheetsOAuthService, Depends(get_google_sheets_service)
    ],
):
    """Check Google Sheets connection status."""
    try:
        connection = await google_sheets_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await google_sheets_service.is_token_expired(
                current_user.user_id
            )
            if is_expired:
                connection = await google_sheets_service.refresh_token_if_needed(
                    current_user.user_id
                )

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Google Sheets connection status retrieved",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                connected_at=None,
            ),
            message="Google Sheets connection status retrieved",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Google Sheets status: {str(e)}",
        )


@router.delete(
    "/google-sheets/disconnect", response_model=ApiResponse[OAuthDisconnectResponse]
)
async def google_sheets_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    google_sheets_service: Annotated[
        GoogleSheetsOAuthService, Depends(get_google_sheets_service)
    ],
):
    """Disconnect Google Sheets integration."""
    try:
        success = await google_sheets_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Google Sheets",
                ),
                message="Google Sheets disconnected",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Google Sheets connection found",
                ),
                message="No active Google Sheets connection",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Google Sheets: {str(e)}",
        )


# Linear OAuth endpoints
@router.get("/linear/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def linear_authorize(
    linear_service: Annotated[LinearOAuthService, Depends(get_linear_service)],
):
    """Get Linear OAuth authorization URL."""
    try:
        if not settings.LINEAR_CLIENT_ID or not settings.LINEAR_CLIENT_SECRET:
            raise HTTPException(
                status_code=500,
                detail="Linear OAuth is not configured. Please set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET environment variables.",
            )

        authorization_url, _ = await linear_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="Linear authorization URL generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Linear authorization URL: {str(e)}",
        )


@router.post("/linear/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def linear_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    linear_service: Annotated[LinearOAuthService, Depends(get_linear_service)],
):
    """Handle Linear OAuth callback."""
    try:
        success, message, connection_info = await linear_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("username")
                if connection_info
                else None,
            ),
            message="Linear OAuth callback processed",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Linear callback: {str(e)}",
        )


@router.get("/linear/status", response_model=ApiResponse[OAuthStatusResponse])
async def linear_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    linear_service: Annotated[LinearOAuthService, Depends(get_linear_service)],
):
    """Check Linear connection status."""
    try:
        connection = await linear_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await linear_service.is_token_expired(current_user.user_id)
            if is_expired:
                connection = await linear_service.refresh_token_if_needed(
                    current_user.user_id
                )

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Linear connection status retrieved",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                connected_at=None,
            ),
            message="Linear connection status retrieved",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Linear status: {str(e)}",
        )


@router.delete(
    "/linear/disconnect", response_model=ApiResponse[OAuthDisconnectResponse]
)
async def linear_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    linear_service: Annotated[LinearOAuthService, Depends(get_linear_service)],
):
    """Disconnect Linear integration."""
    try:
        success = await linear_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Linear",
                ),
                message="Linear disconnected",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Linear connection found",
                ),
                message="No active Linear connection",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Linear: {str(e)}",
        )


# Airtable OAuth endpoints
@router.get("/airtable/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def airtable_authorize(
    airtable_service: Annotated[AirtableOAuthService, Depends(get_airtable_service)],
):
    """Get Airtable OAuth authorization URL."""
    try:
        if not settings.AIRTABLE_CLIENT_ID or not settings.AIRTABLE_CLIENT_SECRET:
            raise HTTPException(
                status_code=500,
                detail="Airtable OAuth is not configured. Please set AIRTABLE_CLIENT_ID and AIRTABLE_CLIENT_SECRET environment variables.",
            )

        authorization_url, _ = await airtable_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="Airtable authorization URL generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Airtable authorization URL: {str(e)}",
        )


@router.post("/airtable/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def airtable_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    airtable_service: Annotated[AirtableOAuthService, Depends(get_airtable_service)],
):
    """Handle Airtable OAuth callback."""
    try:
        success, message, connection_info = await airtable_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
            state=request.state,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("workspace")
                if connection_info
                else None,
            ),
            message="Airtable OAuth callback processed",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Airtable callback: {str(e)}",
        )


@router.get("/airtable/status", response_model=ApiResponse[OAuthStatusResponse])
async def airtable_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    airtable_service: Annotated[AirtableOAuthService, Depends(get_airtable_service)],
):
    """Check Airtable connection status."""
    try:
        connection = await airtable_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await airtable_service.is_token_expired(current_user.user_id)
            if is_expired:
                connection = await airtable_service.refresh_token_if_needed(
                    current_user.user_id
                )

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Airtable connection status retrieved",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                connected_at=None,
            ),
            message="Airtable connection status retrieved",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Airtable status: {str(e)}",
        )


@router.delete(
    "/airtable/disconnect", response_model=ApiResponse[OAuthDisconnectResponse]
)
async def airtable_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    airtable_service: Annotated[AirtableOAuthService, Depends(get_airtable_service)],
):
    """Disconnect Airtable integration."""
    try:
        success = await airtable_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Airtable",
                ),
                message="Airtable disconnected",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Airtable connection found",
                ),
                message="No active Airtable connection",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Airtable: {str(e)}",
        )


# ==================== Gmail OAuth endpoints ====================

@router.get("/gmail/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def gmail_authorize(
    gmail_service: Annotated[GmailOAuthService, Depends(get_gmail_service)],
):
    """Get Gmail OAuth authorization URL."""
    try:
        client_id = settings.GMAIL_CLIENT_ID or settings.GOOGLE_SHEETS_CLIENT_ID
        client_secret = settings.GMAIL_CLIENT_SECRET or settings.GOOGLE_SHEETS_CLIENT_SECRET
        
        if not client_id or not client_secret:
            raise HTTPException(
                status_code=500,
                detail="Gmail OAuth is not configured. Please set GMAIL_CLIENT_ID/SECRET or GOOGLE_SHEETS_CLIENT_ID/SECRET environment variables.",
            )

        authorization_url, _ = await gmail_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="Gmail authorization URL generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Gmail authorization URL: {str(e)}",
        )


@router.post("/gmail/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def gmail_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    gmail_service: Annotated[GmailOAuthService, Depends(get_gmail_service)],
):
    """Handle Gmail OAuth callback."""
    try:
        success, message, connection_info = await gmail_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("email") if connection_info else None,
            ),
            message="Gmail OAuth callback processed",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Gmail callback: {str(e)}",
        )


@router.get("/gmail/status", response_model=ApiResponse[OAuthStatusResponse])
async def gmail_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    gmail_service: Annotated[GmailOAuthService, Depends(get_gmail_service)],
):
    """Check Gmail connection status."""
    try:
        connection = await gmail_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await gmail_service.is_token_expired(current_user.user_id)
            if is_expired:
                connection = await gmail_service.refresh_token_if_needed(current_user.user_id)

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Gmail connection status retrieved",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                connected_at=None,
            ),
            message="Gmail connection status retrieved",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Gmail status: {str(e)}",
        )


@router.delete("/gmail/disconnect", response_model=ApiResponse[OAuthDisconnectResponse])
async def gmail_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    gmail_service: Annotated[GmailOAuthService, Depends(get_gmail_service)],
):
    """Disconnect Gmail integration."""
    try:
        success = await gmail_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Gmail",
                ),
                message="Gmail disconnected",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Gmail connection found",
                ),
                message="No active Gmail connection",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Gmail: {str(e)}",
        )


# ==================== Google Drive OAuth endpoints ====================

@router.get("/google-drive/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def google_drive_authorize(
    google_drive_service: Annotated[GoogleDriveOAuthService, Depends(get_google_drive_service)],
):
    """Get Google Drive OAuth authorization URL."""
    try:
        client_id = settings.GOOGLE_DRIVE_CLIENT_ID or settings.GOOGLE_SHEETS_CLIENT_ID
        client_secret = settings.GOOGLE_DRIVE_CLIENT_SECRET or settings.GOOGLE_SHEETS_CLIENT_SECRET
        
        if not client_id or not client_secret:
            raise HTTPException(
                status_code=500,
                detail="Google Drive OAuth is not configured. Please set GOOGLE_DRIVE_CLIENT_ID/SECRET or GOOGLE_SHEETS_CLIENT_ID/SECRET environment variables.",
            )

        authorization_url, _ = await google_drive_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="Google Drive authorization URL generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Google Drive authorization URL: {str(e)}",
        )


@router.post("/google-drive/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def google_drive_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    google_drive_service: Annotated[GoogleDriveOAuthService, Depends(get_google_drive_service)],
):
    """Handle Google Drive OAuth callback."""
    try:
        success, message, connection_info = await google_drive_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("email") if connection_info else None,
            ),
            message="Google Drive OAuth callback processed",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Google Drive callback: {str(e)}",
        )


@router.get("/google-drive/status", response_model=ApiResponse[OAuthStatusResponse])
async def google_drive_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    google_drive_service: Annotated[GoogleDriveOAuthService, Depends(get_google_drive_service)],
):
    """Check Google Drive connection status."""
    try:
        connection = await google_drive_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await google_drive_service.is_token_expired(current_user.user_id)
            if is_expired:
                connection = await google_drive_service.refresh_token_if_needed(current_user.user_id)

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Google Drive connection status retrieved",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                connected_at=None,
            ),
            message="Google Drive connection status retrieved",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Google Drive status: {str(e)}",
        )


@router.delete("/google-drive/disconnect", response_model=ApiResponse[OAuthDisconnectResponse])
async def google_drive_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    google_drive_service: Annotated[GoogleDriveOAuthService, Depends(get_google_drive_service)],
):
    """Disconnect Google Drive integration."""
    try:
        success = await google_drive_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Google Drive",
                ),
                message="Google Drive disconnected",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Google Drive connection found",
                ),
                message="No active Google Drive connection",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Google Drive: {str(e)}",
        )


# ==================== Google Calendar OAuth endpoints ====================

@router.get("/google-calendar/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def google_calendar_authorize(
    google_calendar_service: Annotated[GoogleCalendarOAuthService, Depends(get_google_calendar_service)],
):
    """Get Google Calendar OAuth authorization URL."""
    try:
        client_id = settings.GOOGLE_CALENDAR_CLIENT_ID or settings.GOOGLE_SHEETS_CLIENT_ID
        client_secret = settings.GOOGLE_CALENDAR_CLIENT_SECRET or settings.GOOGLE_SHEETS_CLIENT_SECRET
        
        if not client_id or not client_secret:
            raise HTTPException(
                status_code=500,
                detail="Google Calendar OAuth is not configured. Please set GOOGLE_CALENDAR_CLIENT_ID/SECRET or GOOGLE_SHEETS_CLIENT_ID/SECRET environment variables.",
            )

        authorization_url, _ = await google_calendar_service.get_authorization_url()
        return ApiResponse.success(
            data=OAuthAuthorizeResponse(authorization_url=authorization_url),
            message="Google Calendar authorization URL generated successfully",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate Google Calendar authorization URL: {str(e)}",
        )


@router.post("/google-calendar/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def google_calendar_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    google_calendar_service: Annotated[GoogleCalendarOAuthService, Depends(get_google_calendar_service)],
):
    """Handle Google Calendar OAuth callback."""
    try:
        success, message, connection_info = await google_calendar_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code,
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("email") if connection_info else None,
            ),
            message="Google Calendar OAuth callback processed",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Google Calendar callback: {str(e)}",
        )


@router.get("/google-calendar/status", response_model=ApiResponse[OAuthStatusResponse])
async def google_calendar_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    google_calendar_service: Annotated[GoogleCalendarOAuthService, Depends(get_google_calendar_service)],
):
    """Check Google Calendar connection status."""
    try:
        connection = await google_calendar_service.get_connection(current_user.user_id)

        if connection:
            is_expired = await google_calendar_service.is_token_expired(current_user.user_id)
            if is_expired:
                connection = await google_calendar_service.refresh_token_if_needed(current_user.user_id)

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None,
                ),
                message="Google Calendar connection status retrieved",
            )

        return ApiResponse.success(
            data=OAuthStatusResponse(
                connected=False,
                workspace_name=None,
                connected_at=None,
            ),
            message="Google Calendar connection status retrieved",
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Google Calendar status: {str(e)}",
        )


@router.delete("/google-calendar/disconnect", response_model=ApiResponse[OAuthDisconnectResponse])
async def google_calendar_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    google_calendar_service: Annotated[GoogleCalendarOAuthService, Depends(get_google_calendar_service)],
):
    """Disconnect Google Calendar integration."""
    try:
        success = await google_calendar_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Google Calendar",
                ),
                message="Google Calendar disconnected",
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Google Calendar connection found",
                ),
                message="No active Google Calendar connection",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Google Calendar: {str(e)}",
        )

"""OAuth router for handling third-party platform authentication."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from src.config import settings
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse
from src.oauth.dependencies import get_notion_service, get_github_service
from src.oauth.notion_service import NotionOAuthService
from src.oauth.github_service import GithubOAuthService
from src.oauth.schemas import (
    OAuthAuthorizeResponse,
    OAuthCallbackRequest,
    OAuthCallbackResponse,
    OAuthStatusResponse,
    OAuthDisconnectResponse
)

router = APIRouter(prefix="/oauth", tags=["oauth"])


@router.get("/notion/authorize", response_model=ApiResponse[OAuthAuthorizeResponse])
async def notion_authorize(
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)]
):
    """Get Notion OAuth authorization URL."""
    try:
        # Check if Notion OAuth is properly configured
        if not settings.NOTION_CLIENT_ID or not settings.NOTION_CLIENT_SECRET:
            raise HTTPException(
                status_code=500,
                detail="Notion OAuth is not configured. Please set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables."
            )

        authorization_url, _ = await notion_service.get_authorization_url()
        return ApiResponse.success(data=OAuthAuthorizeResponse(authorization_url=authorization_url), message="授权URL生成成功")
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate authorization URL: {str(e)}")


@router.post("/notion/callback", response_model=ApiResponse[OAuthCallbackResponse])
async def notion_callback(
    request: OAuthCallbackRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)]
):
    """Handle Notion OAuth callback."""
    try:
        success, message, connection_info = await notion_service.handle_callback(
            user_id=current_user.user_id,
            code=request.code
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("workspace_name") if connection_info else None
            ),
            message="OAuth回调处理完成"
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle Notion callback: {str(e)}"
        )


@router.get("/notion/status", response_model=ApiResponse[OAuthStatusResponse])
async def notion_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)]
):
    """Check Notion connection status."""
    try:
        connection = await notion_service.get_connection(current_user.user_id)

        if connection:
            # Check if token is expired
            is_expired = await notion_service.is_token_expired(current_user.user_id)
            if is_expired:
                # Try to refresh token
                connection = await notion_service.refresh_token_if_needed(current_user.user_id)

            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=connection is not None,
                    workspace_name=connection.workspace_name if connection else None,
                    connected_at=connection.created_at if connection else None
                ),
                message="Notion连接状态获取成功"
            )
        else:
            return ApiResponse.success(
                data=OAuthStatusResponse(
                    connected=False,
                    workspace_name=None,
                    connected_at=None
                ),
                message="Notion连接状态获取成功"
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check Notion status: {str(e)}"
        )


@router.delete("/notion/disconnect", response_model=ApiResponse[OAuthDisconnectResponse])
async def notion_disconnect(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)]
):
    """Disconnect Notion integration."""
    try:
        success = await notion_service.disconnect(current_user.user_id)

        if success:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=True,
                    message="Successfully disconnected from Notion"
                ),
                message="Notion断开连接成功"
            )
        else:
            return ApiResponse.success(
                data=OAuthDisconnectResponse(
                    success=False,
                    message="No active Notion connection found"
                ),
                message="没有找到活跃的Notion连接"
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disconnect from Notion: {str(e)}"
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
        raise HTTPException(status_code=500, detail=f"Failed to generate GitHub authorization URL: {str(e)}")


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
                workspace_name=connection_info.get("username") if connection_info else None,
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
                connection = await github_service.refresh_token_if_needed(current_user.user_id)

            username = None
            if connection:
                metadata = connection.metadata if isinstance(connection.metadata, dict) else {}
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


@router.delete("/github/disconnect", response_model=ApiResponse[OAuthDisconnectResponse])
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
    state: str = Query(None, description="OAuth state parameter")
):
    """Handle OAuth callback from browser redirect."""
    try:
        success, message, connection_info = await notion_service.handle_callback(
            user_id=current_user.user_id,
            code=code
        )

        return ApiResponse.success(
            data=OAuthCallbackResponse(
                success=success,
                message=message,
                workspace_name=connection_info.get("workspace_name") if connection_info else None
            ),
            message="OAuth回调处理完成"
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to handle OAuth callback: {str(e)}"
        )
"""OAuth dependencies for FastAPI."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer

from src.auth.dependencies import get_current_user
from src.oauth.notion_service import NotionOAuthService
from src.oauth.github_service import GithubOAuthService
from src.oauth.repository import OAuthRepository


# Security scheme for OAuth endpoints
oauth_scheme = HTTPBearer(auto_error=False)


def get_notion_service() -> NotionOAuthService:
    """Get Notion OAuth service instance."""
    return NotionOAuthService()


def get_github_service() -> GithubOAuthService:
    """Get GitHub OAuth service instance."""
    return GithubOAuthService()


def get_oauth_repository() -> OAuthRepository:
    """Get OAuth repository instance."""
    return OAuthRepository()


async def get_current_notion_connection(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)]
):
    """Get current user's Notion connection or raise 401."""
    connection = await notion_service.get_connection(current_user.user_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not connected to Notion. Please authorize first."
        )

    return connection
"""OAuth dependencies for FastAPI."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer

from src.auth.dependencies import get_current_user
from src.oauth.notion_service import NotionOAuthService
from src.oauth.github_service import GithubOAuthService
from src.oauth.google_sheets_service import GoogleSheetsOAuthService
from src.oauth.gmail_service import GmailOAuthService
from src.oauth.google_drive_service import GoogleDriveOAuthService
from src.oauth.google_calendar_service import GoogleCalendarOAuthService
from src.oauth.google_docs_service import GoogleDocsOAuthService
from src.oauth.linear_service import LinearOAuthService
from src.oauth.airtable_service import AirtableOAuthService
from src.oauth.repository import OAuthRepository


# Security scheme for OAuth endpoints
oauth_scheme = HTTPBearer(auto_error=False)


def get_notion_service() -> NotionOAuthService:
    """Get Notion OAuth service instance."""
    return NotionOAuthService()


def get_github_service() -> GithubOAuthService:
    """Get GitHub OAuth service instance."""
    return GithubOAuthService()


def get_google_sheets_service() -> GoogleSheetsOAuthService:
    """Get Google Sheets OAuth service instance."""
    return GoogleSheetsOAuthService()


def get_linear_service() -> LinearOAuthService:
    """Get Linear OAuth service instance."""
    return LinearOAuthService()


def get_airtable_service() -> AirtableOAuthService:
    """Get Airtable OAuth service instance."""
    return AirtableOAuthService()


def get_gmail_service() -> GmailOAuthService:
    """Get Gmail OAuth service instance."""
    return GmailOAuthService()


def get_google_drive_service() -> GoogleDriveOAuthService:
    """Get Google Drive OAuth service instance."""
    return GoogleDriveOAuthService()


def get_google_calendar_service() -> GoogleCalendarOAuthService:
    """Get Google Calendar OAuth service instance."""
    return GoogleCalendarOAuthService()


def get_google_docs_service() -> GoogleDocsOAuthService:
    """Get Google Docs OAuth service instance."""
    return GoogleDocsOAuthService()


def get_oauth_repository() -> OAuthRepository:
    """Get OAuth repository instance."""
    return OAuthRepository()


async def get_current_notion_connection(
    current_user: Annotated[dict, Depends(get_current_user)],
    notion_service: Annotated[NotionOAuthService, Depends(get_notion_service)],
):
    """Get current user's Notion connection or raise 401."""
    connection = await notion_service.get_connection(current_user.user_id)

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not connected to Notion. Please authorize first.",
        )

    return connection

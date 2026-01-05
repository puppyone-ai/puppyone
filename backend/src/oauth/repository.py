"""OAuth repository for database operations."""

from typing import Optional

from src.supabase.client import SupabaseClient
from src.oauth.models import (
    OAuthConnection,
    OAuthConnectionCreate,
    OAuthConnectionUpdate,
)


class OAuthRepository:
    """Repository for OAuth connection operations."""

    def __init__(self):
        supabase_client = SupabaseClient()
        self.supabase = supabase_client.get_client()

    async def create(self, connection_create: OAuthConnectionCreate) -> OAuthConnection:
        """Create a new OAuth connection."""
        # Check if connection already exists for this user and provider
        existing = await self.get_by_user_and_provider(
            connection_create.user_id, connection_create.provider
        )

        if existing:
            # Update existing connection
            update_data = OAuthConnectionUpdate(
                access_token=connection_create.access_token,
                refresh_token=connection_create.refresh_token,
                token_type=connection_create.token_type,
                expires_at=connection_create.expires_at,
                workspace_id=connection_create.workspace_id,
                workspace_name=connection_create.workspace_name,
                bot_id=connection_create.bot_id,
                metadata=connection_create.metadata,
            )
            return await self.update(existing.id, update_data)

        # Create new connection
        data = {
            "user_id": connection_create.user_id,
            "provider": connection_create.provider,
            "access_token": connection_create.access_token,
            "refresh_token": connection_create.refresh_token,
            "token_type": connection_create.token_type,
            "expires_at": connection_create.expires_at.isoformat()
            if connection_create.expires_at
            else None,
            "workspace_id": connection_create.workspace_id,
            "workspace_name": connection_create.workspace_name,
            "bot_id": connection_create.bot_id,
            "metadata": connection_create.metadata,
        }

        response = self.supabase.table("oauth_connection").insert(data).execute()

        if not response.data:
            raise Exception("Failed to create OAuth connection")

        return OAuthConnection(**response.data[0])

    async def get_by_id(self, connection_id: int) -> Optional[OAuthConnection]:
        """Get OAuth connection by ID."""
        response = (
            self.supabase.table("oauth_connection")
            .select("*")
            .eq("id", connection_id)
            .execute()
        )

        if not response.data:
            return None

        return OAuthConnection(**response.data[0])

    async def get_by_user_and_provider(
        self, user_id: str, provider: str
    ) -> Optional[OAuthConnection]:
        """Get OAuth connection by user ID and provider."""
        response = (
            self.supabase.table("oauth_connection")
            .select("*")
            .eq("user_id", user_id)
            .eq("provider", provider)
            .execute()
        )

        if not response.data:
            return None

        return OAuthConnection(**response.data[0])

    async def update(
        self, connection_id: int, update_data: OAuthConnectionUpdate
    ) -> OAuthConnection:
        """Update OAuth connection."""
        data = {}

        if update_data.access_token is not None:
            data["access_token"] = update_data.access_token
        if update_data.refresh_token is not None:
            data["refresh_token"] = update_data.refresh_token
        if update_data.token_type is not None:
            data["token_type"] = update_data.token_type
        if update_data.expires_at is not None:
            data["expires_at"] = update_data.expires_at.isoformat()
        if update_data.workspace_id is not None:
            data["workspace_id"] = update_data.workspace_id
        if update_data.workspace_name is not None:
            data["workspace_name"] = update_data.workspace_name
        if update_data.bot_id is not None:
            data["bot_id"] = update_data.bot_id
        if update_data.metadata is not None:
            data["metadata"] = update_data.metadata

        response = (
            self.supabase.table("oauth_connection")
            .update(data)
            .eq("id", connection_id)
            .execute()
        )

        if not response.data:
            raise Exception("Failed to update OAuth connection")

        return OAuthConnection(**response.data[0])

    async def delete(self, connection_id: int) -> bool:
        """Delete OAuth connection."""
        response = (
            self.supabase.table("oauth_connection")
            .delete()
            .eq("id", connection_id)
            .execute()
        )
        return len(response.data) > 0

    async def delete_by_user_and_provider(self, user_id: str, provider: str) -> bool:
        """Delete OAuth connection by user ID and provider."""
        response = (
            self.supabase.table("oauth_connection")
            .delete()
            .eq("user_id", user_id)
            .eq("provider", provider)
            .execute()
        )
        return len(response.data) > 0

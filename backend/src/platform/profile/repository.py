"""
Profile Repository

Defines the data access interface and Supabase implementation for Profile
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from supabase import Client

from src.platform.profile.models import Profile, ProfileUpdate
from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error


class ProfileRepositoryBase(ABC):
    """Abstract Profile repository interface"""

    @abstractmethod
    def get_by_user_id(self, user_id: str) -> Optional[Profile]:
        """Get Profile by user ID"""

    @abstractmethod
    def create(self, user_id: str, email: str) -> Optional[Profile]:
        """Create a new Profile record"""

    @abstractmethod
    def get_or_create(self, user_id: str, email: str) -> Optional[Profile]:
        """Get Profile, auto-create if it does not exist"""

    @abstractmethod
    def update(self, user_id: str, data: ProfileUpdate) -> Optional[Profile]:
        """Update Profile"""

    @abstractmethod
    def mark_onboarded(
        self, user_id: str, demo_project_id: Optional[int] = None
    ) -> Optional[Profile]:
        """Mark user as having completed Onboarding"""

    @abstractmethod
    def reset_onboarding(self, user_id: str) -> Optional[Profile]:
        """Reset user Onboarding status (for testing)"""


class ProfileRepositorySupabase(ProfileRepositoryBase):
    """Supabase-based Profile repository implementation"""

    TABLE_NAME = "profiles"

    def __init__(self, client: Optional[Client] = None):
        if client is None:
            self._client = SupabaseClient().get_client()
        else:
            self._client = client

    def create(self, user_id: str, email: str) -> Optional[Profile]:
        """
        Create a new Profile record

        If Profile already exists, return the existing record (upsert behavior)
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            insert_data = {
                "user_id": user_id,
                "email": email,
                "has_onboarded": False,
                "created_at": now,
                "updated_at": now,
            }

            # Use upsert to avoid duplicate insert errors
            response = (
                self._client.table(self.TABLE_NAME)
                .upsert(insert_data, on_conflict="user_id")
                .execute()
            )

            if response.data and len(response.data) > 0:
                log_info(f"Profile created/retrieved for user {user_id}")
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to create profile for user {user_id}: {e}")
            return None

    def get_or_create(self, user_id: str, email: str) -> Optional[Profile]:
        """
        Get Profile, auto-create if it does not exist

        This is the preferred retrieval method, ensuring Profile always exists
        """
        profile = self.get_by_user_id(user_id)
        if profile is not None:
            return profile

        # Profile does not exist, create a new one
        log_info(f"Profile not found for user {user_id}, creating new one")
        return self.create(user_id, email)

    def _row_to_model(self, row: dict) -> Profile:
        """Convert a database row to a Profile model"""
        return Profile(
            user_id=row["user_id"],
            email=row["email"],
            display_name=row.get("display_name"),
            avatar_url=row.get("avatar_url"),
            default_org_id=row.get("default_org_id"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            has_onboarded=row.get("has_onboarded", False),
            onboarded_at=row.get("onboarded_at"),
            demo_project_id=row.get("demo_project_id"),
        )

    def get_by_user_id(self, user_id: str) -> Optional[Profile]:
        """Get Profile by user ID"""
        try:
            response = (
                self._client.table(self.TABLE_NAME)
                .select("*")
                .eq("user_id", user_id)
                .single()
                .execute()
            )

            if response.data:
                return self._row_to_model(response.data)
            return None

        except Exception as e:
            # Supabase throws an exception when no data is found
            log_error(f"Failed to get profile for user {user_id}: {e}")
            return None

    def update(self, user_id: str, data: ProfileUpdate) -> Optional[Profile]:
        """Update Profile"""
        try:
            update_data = data.model_dump(exclude_unset=True, exclude_none=True)
            update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

            response = (
                self._client.table(self.TABLE_NAME)
                .update(update_data)
                .eq("user_id", user_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to update profile for user {user_id}: {e}")
            return None

    def mark_onboarded(
        self, user_id: str, demo_project_id: Optional[int] = None
    ) -> Optional[Profile]:
        """Mark user as having completed Onboarding"""
        try:
            now = datetime.now(timezone.utc).isoformat()
            update_data = {
                "has_onboarded": True,
                "onboarded_at": now,
                "updated_at": now,
            }

            if demo_project_id is not None:
                update_data["demo_project_id"] = demo_project_id

            response = (
                self._client.table(self.TABLE_NAME)
                .update(update_data)
                .eq("user_id", user_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                log_info(f"User {user_id} marked as onboarded")
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to mark user {user_id} as onboarded: {e}")
            return None

    def reset_onboarding(self, user_id: str) -> Optional[Profile]:
        """Reset user Onboarding status (for testing)"""
        try:
            now = datetime.now(timezone.utc).isoformat()
            update_data = {
                "has_onboarded": False,
                "onboarded_at": None,
                "demo_project_id": None,
                "updated_at": now,
            }

            response = (
                self._client.table(self.TABLE_NAME)
                .update(update_data)
                .eq("user_id", user_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                log_info(f"User {user_id} onboarding status reset")
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to reset onboarding for user {user_id}: {e}")
            return None




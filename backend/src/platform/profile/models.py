"""
Profile Data Models

Defines business domain models for user Profile
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Profile(BaseModel):
    """User Profile domain model"""

    user_id: str = Field(..., description="User ID (UUID, references auth.users)")
    email: str = Field(..., description="User email")
    display_name: str | None = Field(None, description="Display name")
    avatar_url: str | None = Field(None, description="Avatar URL")
    default_org_id: str | None = Field(None, description="Default organization ID")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Update time")

    # Onboarding related fields
    has_onboarded: bool = Field(
        default=False, description="Whether first-time Onboarding has been completed"
    )
    onboarded_at: datetime | None = Field(
        None, description="Time when Onboarding was completed"
    )
    demo_project_id: str | None = Field(
        None, description="Auto-created demo project ID (UUID)"
    )

    model_config = ConfigDict(from_attributes=True)


class ProfileUpdate(BaseModel):
    """Profile update data"""

    display_name: str | None = None
    avatar_url: str | None = None
    default_org_id: str | None = None
    has_onboarded: bool | None = None
    onboarded_at: datetime | None = None
    demo_project_id: str | None = None




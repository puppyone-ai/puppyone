"""
Profile Data Models

Defines business domain models for user Profile
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class Profile(BaseModel):
    """User Profile domain model"""

    user_id: str = Field(..., description="User ID (UUID, references auth.users)")
    email: str = Field(..., description="User email")
    display_name: Optional[str] = Field(None, description="Display name")
    avatar_url: Optional[str] = Field(None, description="Avatar URL")
    default_org_id: Optional[str] = Field(None, description="Default organization ID")
    created_at: datetime = Field(..., description="Creation time")
    updated_at: datetime = Field(..., description="Update time")

    # Onboarding related fields
    has_onboarded: bool = Field(
        default=False, description="Whether first-time Onboarding has been completed"
    )
    onboarded_at: Optional[datetime] = Field(
        None, description="Time when Onboarding was completed"
    )
    demo_project_id: Optional[int] = Field(
        None, description="Auto-created Demo Project ID"
    )

    model_config = ConfigDict(from_attributes=True)


class ProfileUpdate(BaseModel):
    """Profile update data"""

    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    default_org_id: Optional[str] = None
    has_onboarded: Optional[bool] = None
    onboarded_at: Optional[datetime] = None
    demo_project_id: Optional[int] = None




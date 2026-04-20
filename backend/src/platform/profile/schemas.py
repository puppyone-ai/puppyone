"""
Profile API Schemas

Defines API request and response models for Profile
"""

from datetime import datetime

from pydantic import BaseModel


class ProfileResponse(BaseModel):
    """Profile response model"""

    user_id: str
    email: str
    display_name: str | None = None
    avatar_url: str | None = None
    default_org_id: str | None = None
    has_onboarded: bool
    onboarded_at: datetime | None = None
    demo_project_id: str | None = None
    created_at: datetime
    updated_at: datetime

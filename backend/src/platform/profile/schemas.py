"""
Profile API Schemas

Defines API request and response models for Profile
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ProfileResponse(BaseModel):
    """Profile response model"""

    user_id: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    default_org_id: Optional[str] = None
    has_onboarded: bool
    onboarded_at: Optional[datetime] = None
    demo_project_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class OnboardingStatusResponse(BaseModel):
    """Onboarding status response"""

    has_onboarded: bool = Field(..., description="Whether Onboarding has been completed")
    demo_project_id: Optional[int] = Field(None, description="Demo Project ID")
    redirect_to: str = Field(
        ..., description="Path the frontend should redirect to"
    )
    is_new_user: bool = Field(..., description="Whether this is a new user (needs welcome dialog)")


class OnboardingCompleteRequest(BaseModel):
    """Complete Onboarding request"""

    demo_project_id: Optional[int] = Field(
        None, description="Demo Project ID (if already created)"
    )


class ResetOnboardingResponse(BaseModel):
    """Reset Onboarding response"""

    success: bool
    message: str




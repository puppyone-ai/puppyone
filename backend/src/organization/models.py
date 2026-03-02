from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class Organization(BaseModel):
    id: str
    name: str
    slug: str
    avatar_url: Optional[str] = None
    type: str = "team"
    plan: str = "free"
    seat_limit: int = 5
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrgMember(BaseModel):
    id: str
    org_id: str
    user_id: str
    role: str = "member"
    joined_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrgInvitation(BaseModel):
    id: str
    org_id: str
    email: str
    role: str = "member"
    token: str
    status: str = "pending"
    invited_by: str
    expires_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

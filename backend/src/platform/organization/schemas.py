from typing import Optional, List
from pydantic import BaseModel


class CreateOrganization(BaseModel):
    name: str
    slug: Optional[str] = None


class UpdateOrganization(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None


class InviteMember(BaseModel):
    email: str
    role: str = "member"


class UpdateMemberRole(BaseModel):
    role: str


class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    avatar_url: Optional[str] = None
    plan: str
    seat_limit: int
    created_at: str
    member_count: Optional[int] = None


class OrgMemberOut(BaseModel):
    id: str
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    joined_at: str


class OrgInvitationOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    expires_at: str
    created_at: str

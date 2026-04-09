
from pydantic import BaseModel


class CreateOrganization(BaseModel):
    name: str
    slug: str | None = None


class UpdateOrganization(BaseModel):
    name: str | None = None
    avatar_url: str | None = None


class InviteMember(BaseModel):
    email: str
    role: str = "member"


class UpdateMemberRole(BaseModel):
    role: str


class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    avatar_url: str | None = None
    plan: str
    seat_limit: int
    created_at: str
    member_count: int | None = None


class OrgMemberOut(BaseModel):
    id: str
    user_id: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    role: str
    joined_at: str


class OrgInvitationOut(BaseModel):
    id: str
    email: str
    role: str
    status: str
    expires_at: str
    created_at: str

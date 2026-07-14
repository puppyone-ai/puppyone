from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from src.platform.repository_target.schemas import RepositoryTargetSchema
from src.platform.workspace_binding.models import BindingMode


class WorkspaceBindingCreate(BaseModel):
    workspace_instance_id: str = Field(min_length=16, max_length=200)
    cloud_origin: str = Field(min_length=8, max_length=300)
    target: RepositoryTargetSchema
    mode: BindingMode = BindingMode.READ_WRITE

    @field_validator("workspace_instance_id")
    @classmethod
    def validate_instance_id(cls, value: str) -> str:
        normalized = value.strip()
        if any(character.isspace() for character in normalized):
            raise ValueError("workspace_instance_id cannot contain whitespace")
        return normalized

class GitRemoteOut(BaseModel):
    url: str
    target: RepositoryTargetSchema
    username: str = "x-puppyone-token"


class WorkspaceBindingOut(BaseModel):
    id: str
    org_id: str
    target: RepositoryTargetSchema
    scope_path: str | None = None
    workspace_instance_id: str
    bound_user_id: str
    cloud_origin: str
    mode: BindingMode
    status: str
    usable: bool = True
    unusable_reason: str | None = None
    created_at: str
    updated_at: str
    last_seen_at: str
    revoked_at: str | None = None
    credential: str | None = None
    remote: GitRemoteOut


class LegacyRemoteResolveRequest(BaseModel):
    remote_url: str = Field(min_length=8, max_length=2048)


class LegacyRemoteCandidateOut(BaseModel):
    target: RepositoryTargetSchema
    requires_confirmation: bool = True


class CanonicalRemoteContextOut(BaseModel):
    """Authorized, secret-free canonical locator resolution."""

    target: RepositoryTargetSchema


class WorkspaceBindingCredentialOut(BaseModel):
    binding_id: str
    credential: str
    remote: GitRemoteOut

from __future__ import annotations

from typing import Literal

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
    # Human Project capabilities are context metadata, not machine authority.
    # They let Desktop enter an already-authorized Project without issuing a
    # second Project lookup merely to construct navigation.
    capabilities: list[str] | None = None
    created_at: str
    updated_at: str
    last_seen_at: str
    revoked_at: str | None = None
    credential: str | None = None
    remote: GitRemoteOut


class LegacyRemoteResolveRequest(BaseModel):
    remote_url: str = Field(min_length=8, max_length=2048)


class CanonicalRemoteResolveRequest(BaseModel):
    remote_url: str = Field(min_length=8, max_length=2048)


class LegacyRemoteCandidateOut(BaseModel):
    target: RepositoryTargetSchema
    requires_confirmation: bool = True


class CanonicalProjectSummaryOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    org_id: str
    visibility: str
    bound_git_branch: str
    updated_at: str | None = None
    effective_role: Literal["admin", "editor", "viewer"]
    grant_source: Literal["org_owner", "project_member", "org_visibility"]
    capabilities: list[str]


class CanonicalRemoteContextOut(BaseModel):
    """Secret-free authorized UI context for one canonical Project locator."""

    target: RepositoryTargetSchema
    project: CanonicalProjectSummaryOut
    scope_path: str | None = None


class WorkspaceBindingCredentialOut(BaseModel):
    binding_id: str
    credential: str
    remote: GitRemoteOut

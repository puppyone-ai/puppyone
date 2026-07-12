from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

from src.platform.workspace_binding.models import BindingKind, BindingMode


class WorkspaceBindingCreate(BaseModel):
    workspace_instance_id: str = Field(min_length=16, max_length=200)
    cloud_origin: str = Field(min_length=8, max_length=300)
    binding_kind: BindingKind = BindingKind.FULL
    scope_id: str | None = None
    mode: BindingMode = BindingMode.READ_WRITE

    @field_validator("workspace_instance_id")
    @classmethod
    def validate_instance_id(cls, value: str) -> str:
        normalized = value.strip()
        if any(character.isspace() for character in normalized):
            raise ValueError("workspace_instance_id cannot contain whitespace")
        return normalized

    @model_validator(mode="after")
    def validate_binding_shape(self):
        if self.binding_kind is BindingKind.SCOPED and not self.scope_id:
            raise ValueError("scope_id is required for a scoped binding")
        return self


class WorkspaceBindingOut(BaseModel):
    id: str
    org_id: str
    project_id: str
    scope_id: str
    scope_path: str | None = None
    workspace_instance_id: str
    bound_user_id: str
    cloud_origin: str
    binding_kind: BindingKind
    mode: BindingMode
    status: str
    usable: bool = True
    unusable_reason: str | None = None
    created_at: str
    updated_at: str
    last_seen_at: str
    revoked_at: str | None = None
    credential: str | None = None


class LegacyRemoteResolveRequest(BaseModel):
    remote_url: str = Field(min_length=8, max_length=2048)


class LegacyRemoteCandidateOut(BaseModel):
    project_id: str
    scope_id: str
    binding_kind: BindingKind
    requires_confirmation: bool = True


class WorkspaceBindingCredentialOut(BaseModel):
    binding_id: str
    credential: str

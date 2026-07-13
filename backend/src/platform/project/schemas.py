"""
Project API Schemas

Defines frontend API request/response models, matching the frontend ProjectInfo type.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ProjectOut(BaseModel):
    """Project metadata response.

    Versioned files are intentionally not part of this contract. Directory
    listings and file reads belong to the Content API so project metadata can
    stay fast and available even when a historical content object is damaged.
    """

    id: str
    name: str
    description: str | None = None
    org_id: str
    visibility: str = "org"
    bound_git_branch: str = "main"
    updated_at: str | None = None
    access_point_count: int = 0
    effective_role: Literal["admin", "editor", "viewer"]
    grant_source: Literal["org_owner", "project_member", "org_visibility"]
    capabilities: list[str]


class ProjectAuthorizationOut(BaseModel):
    project_id: str
    org_id: str
    effective_role: Literal["admin", "editor", "viewer"]
    grant_source: Literal["org_owner", "project_member", "org_visibility"]
    capabilities: list[str]


class ProjectCreate(BaseModel):
    """Create project request"""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    org_id: str | None = None
    seed: bool = False
    template: str | None = Field(
        default=None,
        pattern=r"^[a-z0-9][a-z0-9._-]{0,127}$",
    )
    template_release_id: str | None = Field(
        default=None,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._+@-]{0,127}$",
    )

    @model_validator(mode="after")
    def release_requires_template(self) -> "ProjectCreate":
        if self.template_release_id and not self.template:
            raise ValueError("template_release_id requires template")
        return self


class ProjectUpdate(BaseModel):
    """Update project request"""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    visibility: Literal["org", "private"] | None = None
    bound_git_branch: str | None = None


class ProjectMemberOut(BaseModel):
    """Project member output"""

    id: str
    user_id: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    role: Literal["admin", "editor", "viewer"]
    created_at: str


class AddProjectMember(BaseModel):
    """Add project member"""

    user_id: str
    role: Literal["admin", "editor", "viewer"] = "editor"


class UpdateProjectMemberRole(BaseModel):
    """Update project member role"""

    role: Literal["admin", "editor", "viewer"]

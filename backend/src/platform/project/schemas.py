"""
Project API Schemas

Defines frontend API request/response models, matching the frontend ProjectInfo type.
"""


from pydantic import BaseModel


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


class ProjectCreate(BaseModel):
    """Create project request"""

    name: str
    description: str | None = None
    org_id: str | None = None
    seed: bool = False
    template: str | None = None


class ProjectUpdate(BaseModel):
    """Update project request"""

    name: str | None = None
    description: str | None = None
    visibility: str | None = None
    bound_git_branch: str | None = None


class ProjectMemberOut(BaseModel):
    """Project member output"""

    id: str
    user_id: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    role: str
    created_at: str


class AddProjectMember(BaseModel):
    """Add project member"""

    user_id: str
    role: str = "editor"


class UpdateProjectMemberRole(BaseModel):
    """Update project member role"""

    role: str

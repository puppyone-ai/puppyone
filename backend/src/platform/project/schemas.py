"""
Project API Schemas

Defines frontend API request/response models, matching the frontend ProjectInfo type.
"""

from typing import Optional, List
from pydantic import BaseModel


class NodeInfo(BaseModel):
    """Node information (simplified, used for project listing)"""

    id: str
    name: str
    type: str  # folder | json | markdown | image | pdf | video | file
    rows: Optional[int] = None


class ProjectOut(BaseModel):
    """Project output model - matches frontend ProjectInfo type"""

    id: str
    name: str
    description: Optional[str] = None
    nodes: List[NodeInfo] = []
    updated_at: Optional[str] = None
    access_point_count: int = 0


class ProjectCreate(BaseModel):
    """Create project request"""

    name: str
    description: Optional[str] = None
    org_id: Optional[str] = None
    seed: bool = False


class ProjectUpdate(BaseModel):
    """Update project request"""

    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None


class ProjectMemberOut(BaseModel):
    """Project member output"""

    id: str
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    created_at: str


class AddProjectMember(BaseModel):
    """Add project member"""

    user_id: str
    role: str = "editor"


class UpdateProjectMemberRole(BaseModel):
    """Update project member role"""

    role: str

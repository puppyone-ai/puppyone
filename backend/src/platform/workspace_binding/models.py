from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from src.platform.authorization.models import ProjectGrant
from src.platform.project.models import Project
from src.platform.repository_target.models import RepositoryTarget


class BindingMode(StrEnum):
    READ = "r"
    READ_WRITE = "rw"


class BindingStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"


@dataclass(frozen=True, slots=True)
class WorkspaceBinding:
    id: str
    org_id: str
    target: RepositoryTarget
    workspace_instance_id: str
    bound_user_id: str
    cloud_origin: str
    mode: BindingMode
    status: BindingStatus
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None = None
    scope_path: str | None = None

    @property
    def project_id(self) -> str:
        return self.target.project_id


@dataclass(frozen=True, slots=True)
class CanonicalProjectContext:
    """Authorized human UI context derived from a canonical Git URL.

    It carries no machine credential and creates no WorkspaceBinding. Runtime
    Git authorization remains a separate Version Engine admission path.
    """

    project: Project
    grant: ProjectGrant
    target: RepositoryTarget
    scope_path: str | None

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class BindingKind(StrEnum):
    FULL = "full"
    SCOPED = "scoped"


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
    project_id: str
    scope_id: str
    workspace_instance_id: str
    bound_user_id: str
    cloud_origin: str
    binding_kind: BindingKind
    mode: BindingMode
    status: BindingStatus
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None = None
    scope_path: str | None = None

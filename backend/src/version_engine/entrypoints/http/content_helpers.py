"""Shared helpers for content router sub-modules."""

from __future__ import annotations

from fastapi import HTTPException

from src.exceptions import ErrorCode, NotFoundException
from src.version_engine.entrypoints.http.schemas import VersionEntryResponse
from src.version_engine.read.tree_reader import VersionEntry
from src.platform.auth.models import CurrentUser
from src.platform.project.service import ProjectService

_WRITE_ROLES = frozenset({"owner", "admin", "editor"})


def ensure_project_access(
    project_service: ProjectService,
    current_user: CurrentUser,
    project_id: str,
) -> str:
    """Check that the user belongs to the project. Returns the member role."""
    role = project_service.verify_project_access(project_id, current_user.user_id)
    if not role:
        raise NotFoundException(
            f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
        )
    return role


def ensure_write_access(
    project_service: ProjectService,
    current_user: CurrentUser,
    project_id: str,
) -> str:
    """Check membership AND require a write-capable role (owner/admin/editor).

    Viewers are rejected with 403.
    """
    role = ensure_project_access(project_service, current_user, project_id)
    if role not in _WRITE_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Viewers cannot perform write operations",
        )
    return role


def entry_to_response(entry: VersionEntry) -> VersionEntryResponse:
    return VersionEntryResponse(
        name=entry.name,
        path=entry.path,
        type=entry.type,
        content_hash=entry.content_hash,
        size_bytes=entry.size_bytes,
        mime_type=entry.mime_type,
        children_count=entry.children_count,
        integrity_status=entry.integrity_status,
    )

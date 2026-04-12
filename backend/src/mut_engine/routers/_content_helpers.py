"""Shared helpers for content router sub-modules."""

from __future__ import annotations

from src.exceptions import ErrorCode, NotFoundException
from src.mut_engine.schemas import MutEntryResponse
from src.mut_engine.services.tree_reader import MutEntry
from src.platform.auth.models import CurrentUser
from src.platform.project.service import ProjectService


def ensure_project_access(
    project_service: ProjectService,
    current_user: CurrentUser,
    project_id: str,
) -> None:
    """Check that the user has *any* access to the project.

    TODO(auth): This only checks membership (org_members / project_members)
    but does NOT enforce the member's *role*.  A user with role='viewer' in
    project_members will pass this check and be allowed to perform write
    operations (write, mkdir, mv, rm, restore, bulk-write).  To fix this
    properly, verify_project_access should return the role string (it already
    does), and callers performing mutations should reject 'viewer' role.
    Example:
        role = project_service.verify_project_access(project_id, current_user.user_id)
        if not role:
            raise NotFoundException(...)
        if role == "viewer":
            raise PermissionException("Viewers cannot perform write operations", ...)
    """
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise NotFoundException(
            f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
        )


def entry_to_response(entry: MutEntry) -> MutEntryResponse:
    return MutEntryResponse(
        name=entry.name,
        path=entry.path,
        type=entry.type,
        content_hash=entry.content_hash,
        size_bytes=entry.size_bytes,
        mime_type=entry.mime_type,
        children_count=entry.children_count,
    )

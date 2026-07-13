"""Binding lifecycle. Binding identity never grants Project access."""

from __future__ import annotations

import re
from dataclasses import replace
from urllib.parse import urlsplit

from src.exceptions import ErrorCode, NotFoundException, PermissionException, ValidationException
from src.platform.authorization.models import ProjectAction, ProjectGrant
from src.platform.authorization.service import AuthorizationService
from src.platform.workspace_binding.models import BindingKind, BindingMode, WorkspaceBinding
from src.platform.workspace_binding.repository import WorkspaceBindingRepository
from src.platform.workspace_binding.schemas import WorkspaceBindingCreate
from src.version_engine.entrypoints.git.locator import parse_canonical_git_url


_ACCESS_REMOTE_RE = re.compile(r"/git/ap/([^/?#]+?)(?:\.git)?$")


def normalize_cloud_origin(raw_origin: str) -> str:
    parts = urlsplit(raw_origin.strip())
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ValidationException("cloud_origin must be an HTTP(S) origin")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValidationException("cloud_origin cannot contain credentials or query data")
    if parts.path not in {"", "/"}:
        raise ValidationException("cloud_origin must not contain a path")
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def _validate_remote_origin(parts, expected_origin: str | None) -> None:
    if (
        parts.scheme not in {"http", "https"}
        or not parts.netloc
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise ValidationException(
            "Remote must be a credential-free HTTP(S) URL without query data"
        )
    if expected_origin and normalize_cloud_origin(expected_origin) != (
        f"{parts.scheme.lower()}://{parts.netloc.lower()}"
    ):
        raise ValidationException("Remote belongs to a different Cloud origin")


class WorkspaceBindingService:
    def __init__(
        self,
        repository: WorkspaceBindingRepository,
        authorization: AuthorizationService,
    ):
        self._repository = repository
        self._authorization = authorization

    def _usable(
        self, binding: WorkspaceBinding, grant: ProjectGrant
    ) -> tuple[bool, str | None]:
        if binding.status.value != "active":
            return False, "binding_revoked"
        if binding.bound_user_id != grant.user_id:
            return False, "wrong_account"
        if binding.mode is BindingMode.READ_WRITE and not grant.allows(
            ProjectAction.BIND_READWRITE
        ):
            return False, "role_downgraded"
        scope = self._repository.get_scope(
            binding.project_id, binding.scope_id, root=False
        )
        if scope is None:
            return False, "scope_missing"
        if (
            binding.mode is BindingMode.READ_WRITE
            and scope.get("mode") != "rw"
        ):
            return False, "scope_mode_downgraded"
        return True, None

    def create(
        self,
        project_id: str,
        user_id: str,
        payload: WorkspaceBindingCreate,
    ) -> tuple[WorkspaceBinding, str | None, bool, str | None]:
        action = (
            ProjectAction.BIND_READWRITE
            if payload.mode is BindingMode.READ_WRITE
            else ProjectAction.BIND_READONLY
        )
        grant = self._authorization.authorize(project_id, user_id, action)
        origin = normalize_cloud_origin(payload.cloud_origin)

        existing = self._repository.get_active_by_instance(
            payload.workspace_instance_id
        )
        if existing:
            if existing.bound_user_id != user_id:
                raise PermissionException(
                    "Workspace is already bound by another account",
                    code=ErrorCode.FORBIDDEN,
                )
            if (
                existing.project_id != project_id
                or existing.cloud_origin != origin
                or existing.binding_kind is not payload.binding_kind
                or existing.mode is not payload.mode
                or (payload.scope_id and existing.scope_id != payload.scope_id)
            ):
                raise PermissionException(
                    "Workspace is already bound; detach it before rebinding",
                    code=ErrorCode.FORBIDDEN,
                )
            usable, reason = self._usable(existing, grant)
            return self._with_scope_path(existing), None, usable, reason

        scope = self._repository.get_scope(
            project_id,
            payload.scope_id,
            root=payload.binding_kind is BindingKind.FULL,
        )
        if scope is None:
            raise ValidationException("Requested Project scope does not exist")
        if payload.binding_kind is BindingKind.SCOPED and scope.get("is_root"):
            raise ValidationException("A scoped binding requires a non-root scope")
        if payload.binding_kind is BindingKind.FULL and not scope.get("is_root"):
            raise ValidationException("A full binding requires the canonical root scope")
        if payload.mode is BindingMode.READ_WRITE and scope.get("mode") != "rw":
            raise PermissionException(
                "Binding mode cannot exceed scope mode", code=ErrorCode.FORBIDDEN
            )

        surface = self._repository.get_git_surface(project_id, str(scope["id"]))
        if surface is None:
            raise ValidationException("The selected scope has no active Git surface")
        binding, credential = self._repository.create_with_credential(
            org_id=grant.org_id,
            project_id=project_id,
            scope_id=str(scope["id"]),
            workspace_instance_id=payload.workspace_instance_id,
            bound_user_id=user_id,
            cloud_origin=origin,
            binding_kind=payload.binding_kind,
            mode=payload.mode,
            access_surface_id=str(surface["id"]),
        )
        return self._with_scope_path(binding), credential, True, None

    def _with_scope_path(self, binding: WorkspaceBinding) -> WorkspaceBinding:
        scope = self._repository.get_scope(
            binding.project_id, binding.scope_id, root=False
        )
        return replace(
            binding,
            scope_path=str(scope.get("path") or "") if scope else None,
        )

    def get(self, binding_id: str, user_id: str) -> tuple[WorkspaceBinding, bool, str | None]:
        binding = self._repository.get_by_id(binding_id)
        if binding is None:
            raise NotFoundException("Workspace binding not found", code=ErrorCode.NOT_FOUND)
        grant = self._authorization.authorize(
            binding.project_id, user_id, ProjectAction.BIND_READONLY
        )
        binding = self._with_scope_path(binding)
        if binding.bound_user_id != user_id:
            return binding, False, "wrong_account"
        usable, reason = self._usable(binding, grant)
        return binding, usable, reason

    def heartbeat(self, binding_id: str, user_id: str) -> tuple[WorkspaceBinding, bool, str | None]:
        binding, usable, reason = self.get(binding_id, user_id)
        if usable:
            updated = self._repository.heartbeat(binding.id, user_id)
            binding = self._with_scope_path(updated) if updated else binding
        return binding, usable, reason

    def revoke(self, binding_id: str, user_id: str) -> None:
        binding = self._repository.get_for_user(binding_id, user_id)
        if binding is None:
            raise NotFoundException("Workspace binding not found", code=ErrorCode.NOT_FOUND)
        # Revoking one's own credential only removes authority, so it remains
        # available after Project access loss and is safe to retry.
        if not self._repository.revoke(binding_id, user_id):
            raise NotFoundException("Active workspace binding not found", code=ErrorCode.NOT_FOUND)

    def list_for_project(
        self, project_id: str, user_id: str, *, all_users: bool = False
    ) -> list[WorkspaceBinding]:
        action = ProjectAction.BIND_MANAGE if all_users else ProjectAction.BIND_READONLY
        self._authorization.authorize(project_id, user_id, action)
        rows = self._repository.list_by_project(
            project_id, user_id=None if all_users else user_id
        )
        return [self._with_scope_path(binding) for binding in rows]

    def revoke_as_admin(
        self, binding_id: str, project_id: str, actor_user_id: str
    ) -> None:
        self._authorization.authorize(
            project_id, actor_user_id, ProjectAction.BIND_MANAGE
        )
        if not self._repository.revoke_admin(
            binding_id, project_id, actor_user_id
        ):
            raise NotFoundException(
                "Active workspace binding not found", code=ErrorCode.NOT_FOUND
            )

    def rotate_credential(self, binding_id: str, user_id: str) -> str:
        binding = self._repository.get_for_user(binding_id, user_id)
        if binding is None:
            raise NotFoundException(
                "Workspace binding not found", code=ErrorCode.NOT_FOUND
            )
        action = (
            ProjectAction.BIND_READWRITE
            if binding.mode is BindingMode.READ_WRITE
            else ProjectAction.BIND_READONLY
        )
        self._authorization.authorize(binding.project_id, user_id, action)
        credential = self._repository.rotate_credential(binding_id, user_id)
        if credential is None:
            raise NotFoundException(
                "Active workspace binding not found", code=ErrorCode.NOT_FOUND
            )
        return credential

    def revoke_credential(self, binding_id: str, user_id: str) -> None:
        # Self-revocation only narrows machine authority and deliberately does
        # not require current Project access, so compensation still works
        # after a concurrent role removal.
        binding = self._repository.get_for_user(binding_id, user_id)
        if binding is None or not self._repository.revoke_credential(
            binding_id, user_id
        ):
            raise NotFoundException(
                "Workspace binding not found", code=ErrorCode.NOT_FOUND
            )

    def resolve_legacy_remote(
        self,
        remote_url: str,
        user_id: str,
        *,
        expected_origin: str | None = None,
    ) -> tuple[str, str, BindingKind]:
        parts = urlsplit(remote_url.strip())
        _validate_remote_origin(parts, expected_origin)
        match = _ACCESS_REMOTE_RE.search(parts.path)
        if not match:
            raise ValidationException("Remote is not a PuppyOne Access remote")
        raw_token = match.group(1)
        if raw_token.lower().endswith(".git"):
            raw_token = raw_token[:-4]
        resolved = self._repository.resolve_credential(raw_token)
        if resolved is None:
            raise NotFoundException("Remote credential is invalid", code=ErrorCode.NOT_FOUND)
        project_id = str(resolved["project_id"])
        scope_id = str(resolved["scope_id"])
        self._authorization.authorize(project_id, user_id, ProjectAction.PROJECT_READ)
        scope = self._repository.get_scope(project_id, scope_id, root=False)
        if scope is None:
            raise NotFoundException("Remote scope not found", code=ErrorCode.NOT_FOUND)
        kind = BindingKind.FULL if scope.get("is_root") else BindingKind.SCOPED
        return project_id, scope_id, kind

    def resolve_canonical_remote(
        self,
        remote_url: str,
        user_id: str,
        *,
        expected_origin: str | None = None,
    ) -> tuple[str, str, BindingKind]:
        parts = urlsplit(remote_url.strip())
        _validate_remote_origin(parts, expected_origin)
        locator = parse_canonical_git_url(remote_url)
        if locator is None:
            raise ValidationException(
                "Remote is not a credential-free canonical PuppyOne Git remote"
            )
        self._authorization.authorize(
            locator.project_id,
            user_id,
            ProjectAction.PROJECT_READ,
        )
        scope = self._repository.get_scope(
            locator.project_id,
            locator.scope_id,
            root=locator.scope_id is None,
        )
        if scope is None:
            raise NotFoundException(
                "Remote scope not found", code=ErrorCode.NOT_FOUND
            )
        is_root = bool(scope.get("is_root"))
        if locator.scope_id is not None and is_root:
            raise ValidationException(
                "The canonical root scope must use the Project Git URL"
            )
        kind = BindingKind.FULL if is_root else BindingKind.SCOPED
        return locator.project_id, str(scope["id"]), kind

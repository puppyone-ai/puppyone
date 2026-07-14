"""Binding lifecycle. Binding identity never grants Project access."""

from __future__ import annotations

import re
from dataclasses import replace
from urllib.parse import urlsplit

from src.exceptions import (
    AppException,
    ErrorCode,
    NotFoundException,
    PermissionException,
    ValidationException,
)
from src.platform.authorization.models import ProjectAction, ProjectGrant
from src.platform.authorization.service import AuthorizationService
from src.platform.repository_target.models import (
    ProjectRootTarget,
    RepositoryTarget,
    ScopeTarget,
)
from src.platform.repository_target.schemas import repository_target_domain
from src.platform.workspace_binding.models import BindingMode, WorkspaceBinding
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
        if isinstance(binding.target, ScopeTarget):
            scope = self._repository.get_scope(
                binding.project_id, binding.target.scope_id
            )
            if scope is None:
                return False, "scope_missing"
            if (
                binding.mode is BindingMode.READ_WRITE
                and scope.get("max_mode") != "rw"
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
        target = repository_target_domain(payload.target)
        if target.project_id != project_id:
            raise AppException(
                code=ErrorCode.TARGET_KIND_MISMATCH,
                status_code=422,
                message="Workspace Binding target Project mismatch",
            )

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
                or existing.target != target
                or existing.mode is not payload.mode
            ):
                raise PermissionException(
                    "Workspace is already bound; detach it before rebinding",
                    code=ErrorCode.FORBIDDEN,
                )
            usable, reason = self._usable(existing, grant)
            return self._with_scope_path(existing), None, usable, reason

        scope = None
        if isinstance(target, ScopeTarget):
            scope = self._repository.get_scope(project_id, target.scope_id)
            if scope is None:
                raise NotFoundException(
                    "Requested repository Scope does not exist",
                    code=ErrorCode.SCOPE_NOT_FOUND,
                )
            if (
                payload.mode is BindingMode.READ_WRITE
                and scope.get("max_mode") != "rw"
            ):
                raise PermissionException(
                    "Binding mode cannot exceed Scope mode", code=ErrorCode.FORBIDDEN
                )

        binding, credential = self._repository.create_with_credential(
            org_id=grant.org_id,
            project_id=project_id,
            target=target,
            workspace_instance_id=payload.workspace_instance_id,
            bound_user_id=user_id,
            cloud_origin=origin,
            mode=payload.mode,
        )
        return self._with_scope_path(binding), credential, True, None

    def _with_scope_path(self, binding: WorkspaceBinding) -> WorkspaceBinding:
        scope = (
            self._repository.get_scope(binding.project_id, binding.target.scope_id)
            if isinstance(binding.target, ScopeTarget)
            else None
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
    ) -> RepositoryTarget:
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
        scope_id = (
            str(resolved["scope_id"])
            if resolved.get("scope_id") is not None
            else None
        )
        self._authorization.authorize(project_id, user_id, ProjectAction.PROJECT_READ)
        if scope_id is None:
            return ProjectRootTarget(project_id=project_id)
        scope = self._repository.get_scope(project_id, scope_id)
        if scope is None:
            raise NotFoundException(
                "Remote Scope not found", code=ErrorCode.SCOPE_NOT_FOUND
            )
        return ScopeTarget(project_id=project_id, scope_id=scope_id)

    def resolve_canonical_remote(
        self,
        remote_url: str,
        user_id: str,
        *,
        expected_origin: str | None = None,
    ) -> RepositoryTarget:
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
        if locator.scope_id is None:
            return ProjectRootTarget(project_id=locator.project_id)
        scope = self._repository.get_scope(locator.project_id, locator.scope_id)
        if scope is None:
            raise NotFoundException(
                "Remote Scope not found", code=ErrorCode.SCOPE_NOT_FOUND
            )
        return ScopeTarget(
            project_id=locator.project_id,
            scope_id=locator.scope_id,
        )

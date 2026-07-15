"""Binding lifecycle. Binding identity never grants Project access."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import replace
from typing import TypeVar
from urllib.parse import urlsplit

import httpx

from src.exceptions import (
    AppException,
    ErrorCode,
    NotFoundException,
    PermissionException,
    ServiceUnavailableException,
    ValidationException,
)
from src.platform.authorization.models import ProjectAction, ProjectGrant
from src.platform.authorization.service import AuthorizationService
from src.platform.project.repository import ProjectRepositoryBase
from src.platform.repository_target.models import (
    ProjectRootTarget,
    RepositoryTarget,
    ScopeTarget,
)
from src.platform.repository_target.schemas import repository_target_domain
from src.platform.workspace_binding.models import (
    BindingMode,
    CanonicalProjectContext,
    WorkspaceBinding,
)
from src.platform.workspace_binding.repository import WorkspaceBindingRepository
from src.platform.workspace_binding.schemas import WorkspaceBindingCreate
from src.version_engine.entrypoints.git.locator import parse_canonical_git_url

_ACCESS_REMOTE_RE = re.compile(r"/git/ap/([^/?#]+?)(?:\.git)?$")
_DEPENDENCY_READ_ATTEMPTS = 2
_logger = logging.getLogger("puppyone.workspace_binding")
_T = TypeVar("_T")


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
        raise ValidationException("Remote must be a credential-free HTTP(S) URL without query data")
    if expected_origin and normalize_cloud_origin(expected_origin) != (
        f"{parts.scheme.lower()}://{parts.netloc.lower()}"
    ):
        raise ValidationException("Remote belongs to a different Cloud origin")


class WorkspaceBindingService:
    def __init__(
        self,
        repository: WorkspaceBindingRepository,
        authorization: AuthorizationService,
        project_repository: ProjectRepositoryBase,
    ):
        self._repository = repository
        self._authorization = authorization
        self._project_repository = project_repository

    @staticmethod
    def _run_dependency(
        operation: str,
        callback: Callable[[], _T],
        *,
        attempts: int,
    ) -> _T:
        """Run one storage operation without confusing an outage with absence.

        Read-only control-plane calls receive one immediate retry because an
        HTTP transport failure occurs before PostgREST can provide a domain
        result and is safe to replay. Writes use one attempt only: an
        interrupted response is not proof that a mutation was not committed.
        """

        last_error: httpx.TransportError | None = None
        for attempt in range(1, max(1, attempts) + 1):
            try:
                return callback()
            except httpx.TransportError as exc:
                last_error = exc
                _logger.warning(
                    "workspace_binding_storage_transport_failure",
                    extra={
                        "operation": operation,
                        "attempt": attempt,
                        "attempts": max(1, attempts),
                        "error_type": type(exc).__name__,
                    },
                )
        assert last_error is not None
        raise ServiceUnavailableException(
            "Cloud project binding is temporarily unavailable"
        ) from last_error

    @classmethod
    def _read_dependency(cls, operation: str, callback: Callable[[], _T]) -> _T:
        return cls._run_dependency(
            operation,
            callback,
            attempts=_DEPENDENCY_READ_ATTEMPTS,
        )

    @classmethod
    def _write_dependency(cls, operation: str, callback: Callable[[], _T]) -> _T:
        return cls._run_dependency(operation, callback, attempts=1)

    def _usable(
        self,
        binding: WorkspaceBinding,
        grant: ProjectGrant,
        scope: dict | None,
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
            if scope is None:
                return False, "scope_missing"
            if binding.mode is BindingMode.READ_WRITE and scope.get("max_mode") != "rw":
                return False, "scope_mode_downgraded"
        return True, None

    def _scope_for_target(
        self,
        target: RepositoryTarget,
        *,
        operation: str,
    ) -> dict | None:
        if isinstance(target, ProjectRootTarget):
            return None
        scope = self._read_dependency(
            operation,
            lambda: self._repository.get_scope(target.project_id, target.scope_id),
        )
        if scope is None:
            return None
        if (
            str(scope.get("id") or "") != target.scope_id
            or str(scope.get("project_id") or "") != target.project_id
        ):
            return None
        return scope

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

        existing = self._read_dependency(
            "binding.get_active_by_instance",
            lambda: self._repository.get_active_by_instance(payload.workspace_instance_id),
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
            scope = self._scope_for_target(
                existing.target,
                operation="scope.get_existing",
            )
            usable, reason = self._usable(existing, grant, scope)
            return self._with_scope_path(existing, scope), None, usable, reason

        scope = None
        if isinstance(target, ScopeTarget):
            scope = self._scope_for_target(
                target,
                operation="scope.get_requested",
            )
            if scope is None:
                raise NotFoundException(
                    "Requested repository Scope does not exist",
                    code=ErrorCode.SCOPE_NOT_FOUND,
                )
            if payload.mode is BindingMode.READ_WRITE and scope.get("max_mode") != "rw":
                raise PermissionException(
                    "Binding mode cannot exceed Scope mode", code=ErrorCode.FORBIDDEN
                )

        binding, credential = self._write_dependency(
            "binding.create",
            lambda: self._repository.create_with_credential(
                org_id=grant.org_id,
                project_id=project_id,
                target=target,
                workspace_instance_id=payload.workspace_instance_id,
                bound_user_id=user_id,
                cloud_origin=origin,
                mode=payload.mode,
            ),
        )
        return self._with_scope_path(binding, scope), credential, True, None

    @staticmethod
    def _with_scope_path(binding: WorkspaceBinding, scope: dict | None) -> WorkspaceBinding:
        return replace(
            binding,
            scope_path=str(scope.get("path") or "") if scope else None,
        )

    def get(
        self, binding_id: str, user_id: str
    ) -> tuple[WorkspaceBinding, bool, str | None, ProjectGrant]:
        binding = self._read_dependency(
            "binding.get_by_id",
            lambda: self._repository.get_by_id(binding_id),
        )
        if binding is None:
            raise NotFoundException("Workspace binding not found", code=ErrorCode.NOT_FOUND)
        grant = self._authorization.authorize(
            binding.project_id, user_id, ProjectAction.BIND_READONLY
        )
        scope = self._scope_for_target(
            binding.target,
            operation="scope.get_for_binding",
        )
        binding = self._with_scope_path(binding, scope)
        if binding.bound_user_id != user_id:
            return binding, False, "wrong_account", grant
        usable, reason = self._usable(binding, grant, scope)
        return binding, usable, reason, grant

    def heartbeat(
        self, binding_id: str, user_id: str
    ) -> tuple[WorkspaceBinding, bool, str | None, ProjectGrant]:
        binding, usable, reason, grant = self.get(binding_id, user_id)
        if usable:
            updated = self._write_dependency(
                "binding.heartbeat",
                lambda: self._repository.heartbeat(binding.id, user_id),
            )
            binding = replace(updated, scope_path=binding.scope_path) if updated else binding
        return binding, usable, reason, grant

    def revoke(self, binding_id: str, user_id: str) -> None:
        binding = self._read_dependency(
            "binding.get_for_user",
            lambda: self._repository.get_for_user(binding_id, user_id),
        )
        if binding is None:
            raise NotFoundException("Workspace binding not found", code=ErrorCode.NOT_FOUND)
        # Revoking one's own credential only removes authority, so it remains
        # available after Project access loss and is safe to retry.
        if not self._write_dependency(
            "binding.revoke",
            lambda: self._repository.revoke(binding_id, user_id),
        ):
            raise NotFoundException("Active workspace binding not found", code=ErrorCode.NOT_FOUND)

    def list_for_project(
        self, project_id: str, user_id: str, *, all_users: bool = False
    ) -> list[WorkspaceBinding]:
        action = ProjectAction.BIND_MANAGE if all_users else ProjectAction.BIND_READONLY
        self._authorization.authorize(project_id, user_id, action)
        rows = self._read_dependency(
            "binding.list_by_project",
            lambda: self._repository.list_by_project(
                project_id, user_id=None if all_users else user_id
            ),
        )
        return [
            self._with_scope_path(
                binding,
                self._scope_for_target(
                    binding.target,
                    operation="scope.get_for_binding_list",
                ),
            )
            for binding in rows
        ]

    def revoke_as_admin(self, binding_id: str, project_id: str, actor_user_id: str) -> None:
        self._authorization.authorize(project_id, actor_user_id, ProjectAction.BIND_MANAGE)
        if not self._write_dependency(
            "binding.revoke_admin",
            lambda: self._repository.revoke_admin(binding_id, project_id, actor_user_id),
        ):
            raise NotFoundException("Active workspace binding not found", code=ErrorCode.NOT_FOUND)

    def rotate_credential(self, binding_id: str, user_id: str) -> str:
        binding = self._read_dependency(
            "binding.get_for_credential_rotation",
            lambda: self._repository.get_for_user(binding_id, user_id),
        )
        if binding is None:
            raise NotFoundException("Workspace binding not found", code=ErrorCode.NOT_FOUND)
        action = (
            ProjectAction.BIND_READWRITE
            if binding.mode is BindingMode.READ_WRITE
            else ProjectAction.BIND_READONLY
        )
        self._authorization.authorize(binding.project_id, user_id, action)
        credential = self._write_dependency(
            "binding.rotate_credential",
            lambda: self._repository.rotate_credential(binding_id, user_id),
        )
        if credential is None:
            raise NotFoundException("Active workspace binding not found", code=ErrorCode.NOT_FOUND)
        return credential

    def revoke_credential(self, binding_id: str, user_id: str) -> None:
        # Self-revocation only narrows machine authority and deliberately does
        # not require current Project access, so compensation still works
        # after a concurrent role removal.
        binding = self._read_dependency(
            "binding.get_for_credential_revoke",
            lambda: self._repository.get_for_user(binding_id, user_id),
        )
        if binding is None or not self._write_dependency(
            "binding.revoke_credential",
            lambda: self._repository.revoke_credential(binding_id, user_id),
        ):
            raise NotFoundException("Workspace binding not found", code=ErrorCode.NOT_FOUND)

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
        resolved = self._read_dependency(
            "binding.resolve_legacy_credential",
            lambda: self._repository.resolve_credential(raw_token),
        )
        if resolved is None:
            raise NotFoundException("Remote credential is invalid", code=ErrorCode.NOT_FOUND)
        project_id = str(resolved["project_id"])
        scope_id = str(resolved["scope_id"]) if resolved.get("scope_id") is not None else None
        self._authorization.authorize(project_id, user_id, ProjectAction.PROJECT_READ)
        if scope_id is None:
            return ProjectRootTarget(project_id=project_id)
        scope = self._read_dependency(
            "scope.get_for_legacy_remote",
            lambda: self._repository.get_scope(project_id, scope_id),
        )
        if scope is None:
            raise NotFoundException("Remote Scope not found", code=ErrorCode.SCOPE_NOT_FOUND)
        return ScopeTarget(project_id=project_id, scope_id=scope_id)

    def resolve_canonical_remote(
        self,
        remote_url: str,
        user_id: str,
        *,
        expected_origin: str | None = None,
    ) -> CanonicalProjectContext:
        parts = urlsplit(remote_url.strip())
        _validate_remote_origin(parts, expected_origin)
        locator = parse_canonical_git_url(remote_url)
        if locator is None:
            raise ValidationException(
                "Remote is not a credential-free canonical PuppyOne Git remote"
            )
        grant = self._authorization.authorize(
            locator.project_id,
            user_id,
            ProjectAction.PROJECT_READ,
        )
        project = self._read_dependency(
            "project.get_for_canonical_remote",
            lambda: self._project_repository.get_by_id(locator.project_id),
        )
        if project is None or project.org_id != grant.org_id:
            raise NotFoundException("Remote project not found", code=ErrorCode.NOT_FOUND)

        if locator.scope_id is None:
            target: RepositoryTarget = ProjectRootTarget(project_id=locator.project_id)
            scope_path = None
        else:
            target = ScopeTarget(
                project_id=locator.project_id,
                scope_id=locator.scope_id,
            )
            scope = self._scope_for_target(
                target,
                operation="scope.get_for_canonical_remote",
            )
            if scope is None:
                raise NotFoundException(
                    "Remote Scope not found",
                    code=ErrorCode.SCOPE_NOT_FOUND,
                )
            scope_path = str(scope.get("path") or "").strip("/")
        if isinstance(target, ScopeTarget) and not scope_path:
            raise ValidationException("A scoped Git URL must resolve to a non-root scope path")

        return CanonicalProjectContext(
            project=project,
            grant=grant,
            target=target,
            scope_path=scope_path,
        )

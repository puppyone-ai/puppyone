from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.exceptions import PermissionException, ValidationException
from src.platform.authorization.models import (
    GrantSource,
    ProjectGrant,
    ProjectRole,
    ROLE_CAPABILITIES,
)
from src.platform.workspace_binding.models import (
    BindingKind,
    BindingMode,
    BindingStatus,
    WorkspaceBinding,
)
from src.platform.workspace_binding.schemas import WorkspaceBindingCreate
from src.platform.workspace_binding.service import (
    WorkspaceBindingService,
    normalize_cloud_origin,
)


class AuthorizationStub:
    def __init__(self, role: ProjectRole):
        self.role = role

    def authorize(self, project_id, user_id, action):
        grant = ProjectGrant(
            project_id=project_id,
            org_id="org-1",
            user_id=user_id,
            role=self.role,
            source=GrantSource.PROJECT_MEMBER,
            capabilities=ROLE_CAPABILITIES[self.role],
        )
        if not grant.allows(action):
            raise PermissionException()
        return grant


class BindingRepositoryStub:
    def __init__(self, *, scope=None, existing=None):
        self.scope = scope or {
            "id": "scope-root",
            "project_id": "project-1",
            "is_root": True,
            "mode": "rw",
        }
        self.existing = existing
        self.created = []

    def get_active_by_instance(self, *_args):
        return self.existing

    def get_scope(self, *_args, **_kwargs):
        return self.scope

    def get_cli_surface(self, *_args):
        return {"id": "surface-cli"}

    def create_with_credential(self, **kwargs):
        self.created.append(kwargs)
        now = datetime.now(UTC)
        return (
            WorkspaceBinding(
                id="binding-1",
                org_id=kwargs["org_id"],
                project_id=kwargs["project_id"],
                scope_id=kwargs["scope_id"],
                workspace_instance_id=kwargs["workspace_instance_id"],
                bound_user_id=kwargs["bound_user_id"],
                cloud_origin=kwargs["cloud_origin"],
                binding_kind=kwargs["binding_kind"],
                mode=kwargs["mode"],
                status=BindingStatus.ACTIVE,
                created_at=now,
                updated_at=now,
                last_seen_at=now,
            ),
            "pwb_secret",
        )


def _payload(**overrides):
    values = {
        "workspace_instance_id": "workspace-instance-0001",
        "cloud_origin": "HTTPS://Cloud.PuppyOne.AI/",
        "binding_kind": BindingKind.FULL,
        "scope_id": None,
        "mode": BindingMode.READ_WRITE,
    }
    values.update(overrides)
    return WorkspaceBindingCreate(**values)


def test_cloud_origin_is_canonical_and_rejects_paths_or_credentials():
    assert normalize_cloud_origin("HTTPS://Cloud.PuppyOne.AI/") == "https://cloud.puppyone.ai"
    for invalid in (
        "file:///tmp/repo",
        "https://user:secret@example.com",
        "https://example.com/api",
        "https://example.com?token=secret",
    ):
        with pytest.raises(ValidationException):
            normalize_cloud_origin(invalid)


def test_editor_can_create_full_readwrite_binding_with_independent_credential():
    repository = BindingRepositoryStub()
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.EDITOR)
    )
    binding, credential, usable, reason = service.create(
        "project-1", "user-1", _payload()
    )
    assert binding.binding_kind is BindingKind.FULL
    assert binding.scope_id == "scope-root"
    assert credential == "pwb_secret"
    assert usable is True and reason is None
    assert repository.created[0]["cloud_origin"] == "https://cloud.puppyone.ai"


def test_viewer_can_bind_readonly_but_not_readwrite():
    repository = BindingRepositoryStub()
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.VIEWER)
    )
    with pytest.raises(PermissionException):
        service.create("project-1", "user-1", _payload())
    binding, _credential, usable, _reason = service.create(
        "project-1",
        "user-1",
        _payload(mode=BindingMode.READ),
    )
    assert binding.mode is BindingMode.READ
    assert usable


def test_non_root_scope_never_creates_full_binding():
    repository = BindingRepositoryStub(
        scope={"id": "scope-child", "is_root": False, "mode": "rw"}
    )
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.EDITOR)
    )
    with pytest.raises(ValidationException):
        service.create("project-1", "user-1", _payload(scope_id="scope-child"))


def test_scope_read_mode_caps_binding_mode():
    repository = BindingRepositoryStub(
        scope={"id": "scope-root", "is_root": True, "mode": "r"}
    )
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.ADMIN)
    )
    with pytest.raises(PermissionException):
        service.create("project-1", "user-1", _payload())


def test_existing_rw_binding_fails_closed_after_scope_mode_downgrade():
    now = datetime.now(UTC)
    existing = WorkspaceBinding(
        id="binding-1",
        org_id="org-1",
        project_id="project-1",
        scope_id="scope-root",
        workspace_instance_id="workspace-instance-0001",
        bound_user_id="user-1",
        cloud_origin="https://cloud.puppyone.ai",
        binding_kind=BindingKind.FULL,
        mode=BindingMode.READ_WRITE,
        status=BindingStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        last_seen_at=now,
    )
    repository = BindingRepositoryStub(
        scope={"id": "scope-root", "is_root": True, "mode": "r"},
        existing=existing,
    )
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.EDITOR)
    )
    _binding, credential, usable, reason = service.create(
        "project-1", "user-1", _payload()
    )
    assert credential is None
    assert usable is False
    assert reason == "scope_mode_downgraded"

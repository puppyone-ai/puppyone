from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.exceptions import (
    AppException,
    ErrorCode,
    PermissionException,
    ValidationException,
)
from src.platform.authorization.models import (
    GrantSource,
    ProjectGrant,
    ProjectRole,
    ROLE_CAPABILITIES,
)
from src.platform.repository_target.models import ProjectRootTarget, ScopeTarget
from src.platform.workspace_binding.models import (
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
        self.scope = scope
        self.existing = existing
        self.created = []
        self.revoked_credentials = []

    def get_active_by_instance(self, *_args):
        return self.existing

    def get_for_user(self, binding_id, user_id):
        if (
            self.existing
            and self.existing.id == binding_id
            and self.existing.bound_user_id == user_id
        ):
            return self.existing
        return None

    def revoke_credential(self, binding_id, user_id):
        self.revoked_credentials.append((binding_id, user_id))
        return True

    def get_scope(self, *_args, **_kwargs):
        return self.scope

    def get_git_surface(self, *_args):
        return {"id": "surface-git"}

    def create_with_credential(self, **kwargs):
        self.created.append(kwargs)
        now = datetime.now(UTC)
        return (
            WorkspaceBinding(
                id="binding-1",
                org_id=kwargs["org_id"],
                target=kwargs["target"],
                workspace_instance_id=kwargs["workspace_instance_id"],
                bound_user_id=kwargs["bound_user_id"],
                cloud_origin=kwargs["cloud_origin"],
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
        "target": {"kind": "project_root", "project_id": "project-1"},
        "mode": BindingMode.READ_WRITE,
    }
    values.update(overrides)
    return WorkspaceBindingCreate(**values)


def _binding(*, target=None, mode=BindingMode.READ_WRITE):
    now = datetime.now(UTC)
    return WorkspaceBinding(
        id="binding-1",
        org_id="org-1",
        target=target or ProjectRootTarget(project_id="project-1"),
        workspace_instance_id="workspace-instance-0001",
        bound_user_id="user-1",
        cloud_origin="https://cloud.puppyone.ai",
        mode=mode,
        status=BindingStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        last_seen_at=now,
    )


def test_cloud_origin_is_canonical_and_rejects_paths_or_credentials():
    assert normalize_cloud_origin("HTTPS://Cloud.PuppyOne.AI/") == (
        "https://cloud.puppyone.ai"
    )
    for invalid in (
        "file:///tmp/repo",
        "https://user:secret@example.com",
        "https://example.com/api",
        "https://example.com?token=secret",
    ):
        with pytest.raises(ValidationException):
            normalize_cloud_origin(invalid)


def test_remote_discovery_rejects_wrong_origin_or_url_credentials_before_lookup():
    service = WorkspaceBindingService(
        BindingRepositoryStub(), AuthorizationStub(ProjectRole.ADMIN)
    )

    with pytest.raises(ValidationException, match="different Cloud origin"):
        service.resolve_canonical_remote(
            "https://evil.example/git/project-1.git",
            "user-1",
            expected_origin="https://cloud.puppyone.ai",
        )
    with pytest.raises(ValidationException, match="credential-free"):
        service.resolve_legacy_remote(
            "https://user:secret@cloud.puppyone.ai/git/ap/legacy.git",
            "user-1",
            expected_origin="https://cloud.puppyone.ai",
        )


def test_editor_can_bind_project_root_with_independent_credential():
    repository = BindingRepositoryStub()
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.EDITOR)
    )

    binding, credential, usable, reason = service.create(
        "project-1", "user-1", _payload()
    )

    assert binding.target == ProjectRootTarget(project_id="project-1")
    assert credential == "pwb_secret"
    assert usable is True and reason is None
    assert repository.created[0]["cloud_origin"] == "https://cloud.puppyone.ai"
    assert repository.created[0]["target"] == ProjectRootTarget(
        project_id="project-1"
    )


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


def test_scope_target_is_explicit_and_must_belong_to_project():
    repository = BindingRepositoryStub(
        scope={"id": "scope-child", "project_id": "project-1", "max_mode": "rw"}
    )
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.EDITOR)
    )

    binding, *_ = service.create(
        "project-1",
        "user-1",
        _payload(
            target={
                "kind": "scope",
                "project_id": "project-1",
                "scope_id": "scope-child",
            }
        ),
    )

    assert binding.target == ScopeTarget(
        project_id="project-1", scope_id="scope-child"
    )
    with pytest.raises(AppException, match="target Project mismatch") as mismatch:
        service.create(
            "project-1",
            "user-1",
            _payload(target={"kind": "project_root", "project_id": "project-2"}),
        )
    assert mismatch.value.code is ErrorCode.TARGET_KIND_MISMATCH


def test_scope_read_mode_caps_binding_mode_but_root_has_no_scope_lookup():
    repository = BindingRepositoryStub(
        scope={"id": "scope-child", "project_id": "project-1", "max_mode": "r"}
    )
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.ADMIN)
    )

    with pytest.raises(PermissionException):
        service.create(
            "project-1",
            "user-1",
            _payload(
                target={
                    "kind": "scope",
                    "project_id": "project-1",
                    "scope_id": "scope-child",
                }
            ),
        )

    root, *_ = service.create("project-1", "user-1", _payload())
    assert isinstance(root.target, ProjectRootTarget)


def test_existing_scoped_rw_binding_fails_closed_after_scope_mode_downgrade():
    existing = _binding(
        target=ScopeTarget(project_id="project-1", scope_id="scope-child")
    )
    repository = BindingRepositoryStub(
        scope={"id": "scope-child", "project_id": "project-1", "max_mode": "r"},
        existing=existing,
    )
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.EDITOR)
    )

    _bound, credential, usable, reason = service.create(
        "project-1",
        "user-1",
        _payload(
            target={
                "kind": "scope",
                "project_id": "project-1",
                "scope_id": "scope-child",
            }
        ),
    )

    assert credential is None
    assert usable is False
    assert reason == "scope_mode_downgraded"


def test_binding_credential_compensation_preserves_binding_identity():
    existing = _binding()
    repository = BindingRepositoryStub(existing=existing)
    service = WorkspaceBindingService(
        repository, AuthorizationStub(ProjectRole.VIEWER)
    )

    service.revoke_credential("binding-1", "user-1")

    assert repository.existing is existing
    assert repository.revoked_credentials == [("binding-1", "user-1")]

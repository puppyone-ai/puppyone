from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest

from src.exceptions import (
    AppException,
    ErrorCode,
    NotFoundException,
    PermissionException,
    ServiceUnavailableException,
    ValidationException,
)
from src.platform.authorization.models import (
    ROLE_CAPABILITIES,
    GrantSource,
    ProjectGrant,
    ProjectRole,
)
from src.platform.project.models import Project
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


class DenyingAuthorizationStub:
    def authorize(self, *_args, **_kwargs):
        raise PermissionException()


class BindingRepositoryStub:
    def __init__(self, *, scope=None, existing=None):
        self.scope = scope
        self.existing = existing
        self.created = []
        self.revoked_credentials = []
        self.scope_reads = 0

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

    def get_by_id(self, binding_id):
        if self.existing and self.existing.id == binding_id:
            return self.existing
        return None

    def revoke_credential(self, binding_id, user_id):
        self.revoked_credentials.append((binding_id, user_id))
        return True

    def get_scope(self, *_args):
        self.scope_reads += 1
        return self.scope

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


class ProjectRepositoryStub:
    def __init__(self, project: Project | None = None, *, missing: bool = False):
        now = datetime.now(UTC)
        self.project = (
            None
            if missing
            else project
            or Project(
                id="project-1",
                name="Project One",
                description="A test project",
                org_id="org-1",
                visibility="private",
                bound_git_branch="main",
                created_at=now,
                updated_at=now,
            )
        )

    def get_by_id(self, project_id: str):
        if self.project and self.project.id == project_id:
            return self.project
        return None


def _service(repository, role=ProjectRole.EDITOR):
    return WorkspaceBindingService(
        repository,
        AuthorizationStub(role),
        ProjectRepositoryStub(),
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


def _scope(*, scope_id="scope-child", project_id="project-1", mode="rw", path="docs"):
    return {
        "id": scope_id,
        "project_id": project_id,
        "max_mode": mode,
        "path": path,
    }


def test_cloud_origin_is_canonical_and_rejects_paths_or_credentials():
    assert normalize_cloud_origin("HTTPS://Cloud.PuppyOne.AI/") == ("https://cloud.puppyone.ai")
    for invalid in (
        "file:///tmp/repo",
        "https://user:secret@example.com",
        "https://example.com/api",
        "https://example.com?token=secret",
    ):
        with pytest.raises(ValidationException):
            normalize_cloud_origin(invalid)


def test_remote_discovery_rejects_wrong_origin_or_url_credentials_before_lookup():
    service = _service(BindingRepositoryStub(), ProjectRole.ADMIN)

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


def test_canonical_project_remote_returns_authorized_root_context_without_root_scope():
    repository = BindingRepositoryStub()
    service = _service(repository)

    context = service.resolve_canonical_remote(
        "https://cloud.puppyone.ai/git/project-1.git",
        "user-1",
        expected_origin="https://cloud.puppyone.ai",
    )

    assert context.project.id == "project-1"
    assert context.grant.role is ProjectRole.EDITOR
    assert context.target == ProjectRootTarget(project_id="project-1")
    assert context.scope_path is None
    assert repository.scope_reads == 0


def test_canonical_scope_remote_returns_exact_scoped_context():
    repository = BindingRepositoryStub(scope=_scope(path="docs/private", mode="r"))
    service = _service(repository, ProjectRole.VIEWER)

    context = service.resolve_canonical_remote(
        "https://cloud.puppyone.ai/git/project-1/scopes/scope-child.git",
        "user-1",
        expected_origin="https://cloud.puppyone.ai",
    )

    assert context.target == ScopeTarget(
        project_id="project-1",
        scope_id="scope-child",
    )
    assert context.scope_path == "docs/private"
    assert repository.scope_reads == 1


def test_canonical_remote_fails_closed_for_missing_project_or_authorization():
    missing_project = WorkspaceBindingService(
        BindingRepositoryStub(),
        AuthorizationStub(ProjectRole.ADMIN),
        ProjectRepositoryStub(missing=True),
    )
    with pytest.raises(NotFoundException, match="project not found"):
        missing_project.resolve_canonical_remote(
            "https://cloud.puppyone.ai/git/project-1.git",
            "user-1",
            expected_origin="https://cloud.puppyone.ai",
        )

    denied = WorkspaceBindingService(
        BindingRepositoryStub(),
        DenyingAuthorizationStub(),
        ProjectRepositoryStub(),
    )
    with pytest.raises(PermissionException):
        denied.resolve_canonical_remote(
            "https://cloud.puppyone.ai/git/project-1.git",
            "user-1",
            expected_origin="https://cloud.puppyone.ai",
        )


def test_canonical_remote_fails_closed_for_missing_or_invalid_scope_geometry():
    malformed = _service(BindingRepositoryStub(), ProjectRole.ADMIN)
    with pytest.raises(ValidationException, match="canonical PuppyOne Git remote"):
        malformed.resolve_canonical_remote(
            "https://cloud.puppyone.ai/git/ap/legacy.git",
            "user-1",
            expected_origin="https://cloud.puppyone.ai",
        )

    for scope in (
        None,
        _scope(project_id="project-2"),
        _scope(scope_id="scope-other"),
    ):
        service = _service(BindingRepositoryStub(scope=scope), ProjectRole.ADMIN)
        with pytest.raises(NotFoundException, match="Scope not found"):
            service.resolve_canonical_remote(
                "https://cloud.puppyone.ai/git/project-1/scopes/scope-child.git",
                "user-1",
                expected_origin="https://cloud.puppyone.ai",
            )

    pathless = _service(
        BindingRepositoryStub(scope=_scope(path="")),
        ProjectRole.ADMIN,
    )
    with pytest.raises(ValidationException, match="non-root scope path"):
        pathless.resolve_canonical_remote(
            "https://cloud.puppyone.ai/git/project-1/scopes/scope-child.git",
            "user-1",
            expected_origin="https://cloud.puppyone.ai",
        )


def test_editor_can_bind_project_root_with_independent_credential():
    repository = BindingRepositoryStub()
    service = _service(repository)

    binding, credential, usable, reason = service.create("project-1", "user-1", _payload())

    assert binding.target == ProjectRootTarget(project_id="project-1")
    assert credential == "pwb_secret"
    assert usable is True and reason is None
    assert repository.scope_reads == 0
    assert repository.created[0]["cloud_origin"] == "https://cloud.puppyone.ai"
    assert repository.created[0]["target"] == ProjectRootTarget(project_id="project-1")


def test_viewer_can_bind_readonly_but_not_readwrite():
    repository = BindingRepositoryStub()
    service = _service(repository, ProjectRole.VIEWER)
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
    repository = BindingRepositoryStub(scope=_scope())
    service = _service(repository)

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

    assert binding.target == ScopeTarget(project_id="project-1", scope_id="scope-child")
    with pytest.raises(AppException, match="target Project mismatch") as mismatch:
        service.create(
            "project-1",
            "user-1",
            _payload(target={"kind": "project_root", "project_id": "project-2"}),
        )
    assert mismatch.value.code is ErrorCode.TARGET_KIND_MISMATCH


def test_scope_read_mode_caps_binding_mode_but_root_has_no_scope_lookup():
    repository = BindingRepositoryStub(scope=_scope(mode="r"))
    service = _service(repository, ProjectRole.ADMIN)

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

    reads_after_scope = repository.scope_reads
    root, *_ = service.create("project-1", "user-1", _payload())
    assert isinstance(root.target, ProjectRootTarget)
    assert repository.scope_reads == reads_after_scope


def test_existing_scoped_rw_binding_fails_closed_after_scope_mode_downgrade():
    existing = _binding(target=ScopeTarget(project_id="project-1", scope_id="scope-child"))
    repository = BindingRepositoryStub(
        scope=_scope(mode="r"),
        existing=existing,
    )
    service = _service(repository)

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


def test_get_binding_returns_current_human_grant_without_fake_root_scope_lookup():
    repository = BindingRepositoryStub(existing=_binding())
    service = _service(repository)

    binding, usable, reason, grant = service.get("binding-1", "user-1")

    assert binding.id == "binding-1"
    assert usable is True and reason is None
    assert grant.role is ProjectRole.EDITOR
    assert repository.scope_reads == 0


def test_get_binding_retries_one_transient_storage_transport_failure():
    class FlakyRepository(BindingRepositoryStub):
        binding_reads = 0

        def get_by_id(self, binding_id):
            self.binding_reads += 1
            if self.binding_reads == 1:
                raise httpx.ConnectError("transient TLS failure")
            return super().get_by_id(binding_id)

    repository = FlakyRepository(existing=_binding())
    service = _service(repository)

    binding, usable, reason, _grant = service.get("binding-1", "user-1")

    assert binding.id == "binding-1"
    assert usable is True and reason is None
    assert repository.binding_reads == 2


def test_get_binding_maps_persistent_storage_transport_failure_to_retryable_503():
    class UnavailableRepository(BindingRepositoryStub):
        binding_reads = 0

        def get_by_id(self, _binding_id):
            self.binding_reads += 1
            raise httpx.ConnectError("persistent TLS failure")

    repository = UnavailableRepository()
    service = _service(repository)

    with pytest.raises(ServiceUnavailableException) as unavailable:
        service.get("binding-1", "user-1")

    assert unavailable.value.status_code == 503
    assert unavailable.value.details == {"retryable": True}
    assert unavailable.value.headers == {"Retry-After": "1"}
    assert repository.binding_reads == 2


def test_binding_mutation_transport_failure_is_not_automatically_replayed():
    class InterruptedHeartbeatRepository(BindingRepositoryStub):
        heartbeat_calls = 0

        def heartbeat(self, _binding_id, _user_id):
            self.heartbeat_calls += 1
            raise httpx.ConnectError("response interrupted")

    repository = InterruptedHeartbeatRepository(existing=_binding())
    service = _service(repository)

    with pytest.raises(ServiceUnavailableException):
        service.heartbeat("binding-1", "user-1")

    assert repository.heartbeat_calls == 1


def test_binding_credential_compensation_preserves_binding_identity():
    existing = _binding()
    repository = BindingRepositoryStub(existing=existing)
    service = _service(repository, ProjectRole.VIEWER)

    service.revoke_credential("binding-1", "user-1")

    assert repository.existing is existing
    assert repository.revoked_credentials == [("binding-1", "user-1")]

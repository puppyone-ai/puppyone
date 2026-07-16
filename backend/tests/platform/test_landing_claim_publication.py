from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from src.config import settings
from src.platform.landing.service import LandingService
from src.platform.project.control_plane import IdempotentProjectResult
from src.platform.project.models import Project


def _project() -> Project:
    return Project(
        id="project-1",
        name="Guide Docs",
        description="Imported",
        org_id="org-1",
        created_by="user-1",
        created_at=datetime.now(UTC),
    )


class _S3:
    async def download_file(self, key: str) -> bytes:
        assert key == "landing/ticket/parsed/guide.md"
        return b"# Guide"


class _Entitlements:
    def enforced_limit_value(self, org_id: str, key: str):
        assert (org_id, key) == ("org-1", "projects.max")
        return 5


class _Writes:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def bulk_write(self, *args, **kwargs) -> None:
        self.calls.append((args, kwargs))


@pytest.mark.asyncio
async def test_landing_claim_replay_recovers_same_secret_without_duplicate_endpoint(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "JWT_SECRET", "landing-test-secret")
    monkeypatch.setattr(settings, "PUBLIC_URL", "https://cloud.example")
    ticket_id = uuid4()
    body = {
        "tid": ticket_id.hex,
        "kind": "pdf",
        "md_key": "landing/ticket/parsed/guide.md",
        "md_name": "guide.md",
        "src_name": "guide.pdf",
    }
    monkeypatch.setattr(
        "src.platform.landing.service.tickets.verify_ticket",
        lambda _ticket: body,
    )
    monkeypatch.setattr(
        "src.platform.landing.service.get_tool_spec",
        lambda _kind: SimpleNamespace(
            kind="pdf",
            scope_path="Guide",
            name_suffix=" Docs",
            readonly=True,
        ),
    )
    monkeypatch.setattr(
        "src.platform.landing.service.resolve_org_id",
        lambda _requested, _user: "org-1",
    )

    writes = _Writes()
    container = SimpleNamespace(write_commands=lambda: writes)
    monkeypatch.setattr(
        "src.version_engine.bootstrap.dependencies.build_worker_version_engine_container",
        lambda: container,
    )

    scope_calls: list[dict] = []

    class Scope:
        def create(self, **kwargs):
            scope_calls.append(kwargs)
            return SimpleNamespace(id="scope-1")

    monkeypatch.setattr("src.platform.landing.service.ScopeService", Scope)

    endpoints: list[dict] = []
    endpoint_secrets: list[str] = []

    class Mcp:
        def create_endpoint(self, **kwargs):
            endpoint_secrets.append(kwargs["api_key"])
            endpoint = {
                "id": "endpoint-1",
                "name": kwargs["name"],
                "path": kwargs["path"],
                "api_key": kwargs["api_key"],
            }
            endpoints.append(endpoint)
            return endpoint

        def list_endpoints(self, project_id: str):
            assert project_id == "project-1"
            return [{key: value for key, value in endpoints[0].items() if key != "api_key"}]

    monkeypatch.setattr("src.platform.landing.service.McpEndpointService", Mcp)

    class Credentials:
        def get_active_by_token(self, raw_token: str):
            assert raw_token == endpoint_secrets[0]
            return {"access_surface_id": "endpoint-1"}

    monkeypatch.setattr(
        "src.platform.landing.service.AccessCredentialRepository",
        Credentials,
    )

    publication_calls: list[dict] = []

    async def publish(**kwargs):
        publication_calls.append(kwargs)
        if len(publication_calls) == 1:
            await kwargs["initialize"](_project())
        return IdempotentProjectResult(
            project=_project(),
            replayed=len(publication_calls) > 1,
            ready=True,
        )

    monkeypatch.setattr("src.platform.landing.service.create_project_with_tree", publish)

    service = LandingService(
        _S3(),
        SimpleNamespace(),  # type: ignore[arg-type]
        _Entitlements(),  # type: ignore[arg-type]
        SimpleNamespace(),  # type: ignore[arg-type]
    )
    first = await service.claim(ticket="signed-ticket", user_id="user-1")
    replay = await service.claim(ticket="signed-ticket", user_id="user-1")

    assert len(endpoints) == 1
    assert len(scope_calls) == 1
    assert len(writes.calls) == 1
    assert first["mcp"]["api_key"] == replay["mcp"]["api_key"] == endpoint_secrets[0]
    assert first["mcp"]["api_key"]
    assert UUID(publication_calls[0]["operation_key"]).version == 4
    assert publication_calls[0]["operation_key"] == str(ticket_id)
    assert publication_calls[0]["source_fingerprint"] == {
        "kind": "landing-claim",
        "ticket_id": str(ticket_id),
        "tool_kind": "pdf",
        "source_key": "landing/ticket/parsed/guide.md",
        "content_sha256": hashlib.sha256(b"# Guide").hexdigest(),
    }

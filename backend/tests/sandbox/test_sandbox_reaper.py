"""Tests for sandbox reaper using new AgentSandboxRegistry."""

from unittest.mock import AsyncMock

import pytest

from src.infra.scheduler.jobs.sandbox_reaper import reap_idle_sandboxes


@pytest.mark.asyncio
async def test_reaper_calls_writeback_and_destroy(monkeypatch):
    """Reaper should find idle sessions, write back, and destroy."""
    captured: dict = {}

    class _FakeClient:
        def clone(self):
            return {}
        def push(self, **kwargs):
            return {"status": "ok", "version": 1}

    class _FakeSession:
        sandbox_session_id = "sandbox-1"
        chat_session_id = "chat-1"
        agent_id = "agent-1"
        version_client = _FakeClient()
        cloned_files = {}
        scope_path = "docs"
        readonly = False
        project_id = "proj-1"
        parent_path = "docs"

    class _FakeRegistry:
        def get_idle_sessions(self):
            return [_FakeSession()]
        def remove(self, chat_session_id):
            captured["removed"] = chat_session_id

    sandbox_service = AsyncMock()
    sandbox_service.exec = AsyncMock(return_value={"success": True, "output": ""})
    sandbox_service.stop = AsyncMock()

    monkeypatch.setattr(
        "src.connectors.agent.sandbox_session.get_agent_sandbox_registry",
        lambda: _FakeRegistry(),
    )
    monkeypatch.setattr(
        "src.infra.sandbox.dependencies.get_sandbox_service",
        lambda: sandbox_service,
    )

    await reap_idle_sandboxes()

    assert captured["removed"] == "chat-1"
    sandbox_service.stop.assert_awaited_once_with("sandbox-1")

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.infra.scheduler.jobs.sandbox_reaper import reap_idle_sandboxes


@pytest.mark.asyncio
async def test_reaper_passes_parent_path_to_writeback(monkeypatch):
    captured: dict = {}

    session = SimpleNamespace(
        agent_id="agent-1",
        chat_session_id="chat-1",
        sandbox_session_id="sandbox-1",
        manifest=SimpleNamespace(files={"dummy": object()}),
        readonly=False,
        project_id="proj-1",
        parent_path="docs",
    )

    class _Registry:
        def get_idle_sessions(self):
            return [session]

        def remove(self, chat_session_id: str):
            captured["removed"] = chat_session_id

    async def _diff_and_writeback(**kwargs):
        captured["operator_info"] = kwargs["operator_info"]
        return []

    sandbox_service = SimpleNamespace(stop=AsyncMock())

    monkeypatch.setattr("src.sandbox.registry.get_sandbox_registry", lambda: _Registry())
    monkeypatch.setattr("src.sandbox.registry.diff_and_writeback", _diff_and_writeback)
    monkeypatch.setattr("src.sandbox.dependencies.get_sandbox_service", lambda: sandbox_service)
    monkeypatch.setattr("src.mut_engine.dependencies.create_mut_ops", lambda: object())

    await reap_idle_sandboxes()

    assert captured["operator_info"]["project_id"] == "proj-1"
    assert captured["operator_info"]["parent_path"] == "docs"
    sandbox_service.stop.assert_awaited_once_with("sandbox-1")
    assert captured["removed"] == "chat-1"

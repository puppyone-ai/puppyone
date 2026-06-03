from __future__ import annotations

import pytest

from src.infra.scheduler.jobs.sync_job import _execute_sync_pull_async


class FakeSyncEngine:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []

    async def execute(self, sync_id: str, trigger_type: str = "manual"):
        self.calls.append((sync_id, trigger_type))
        return {"run_id": "run-1"}


@pytest.mark.asyncio
async def test_scheduled_sync_job_records_scheduled_trigger(monkeypatch):
    engine = FakeSyncEngine()

    import src.connectors.datasource.dependencies as deps

    monkeypatch.setattr(deps, "create_sync_engine", lambda: engine)

    result = await _execute_sync_pull_async("conn-1")

    assert result["status"] == "success"
    assert engine.calls == [("conn-1", "scheduled")]

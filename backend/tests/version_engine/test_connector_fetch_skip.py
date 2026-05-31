"""GAP-9: a connector whose data plane is external (Filesystem connector
syncs via the Git adapter, not the SyncEngine) declares PULL/PUSH for the
UI but raises NotImplementedError from fetch()/push(). The push path already
treated that as "skipped"; the fetch path used to fall through to the
generic error handler and flip the sync into a FAILED state. These tests
lock in symmetric "skipped" handling.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.connectors.datasource._base import BaseConnector, ConnectorSpec, Capability
from src.connectors.datasource.engine import SyncEngine


class ExternalDataPlaneConnector(BaseConnector):
    """A connector that advertises sync but has no in-engine data plane."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="filesystem-like",
            display_name="External",
            capabilities=Capability.PULL | Capability.PUSH,
            supported_directions=["bidirectional"],
        )

    async def fetch(self, config, credentials):
        raise NotImplementedError("data plane is the Git adapter")


def _make_engine():
    sync = MagicMock()
    sync.id = "s1"
    sync.status = "active"
    sync.provider = "filesystem-like"
    sync.config = {}
    sync.created_by = "u1"
    sync.path = "docs"
    sync.project_id = "p1"
    sync.remote_hash = ""

    sync_repo = MagicMock()
    sync_repo.get_by_id.return_value = sync

    run = MagicMock()
    run.id = "r1"
    run_repo = MagicMock()
    run_repo.create.return_value = run

    registry = MagicMock()
    registry.get.return_value = ExternalDataPlaneConnector()
    registry.resolve_credentials = AsyncMock(return_value=None)

    return SyncEngine(registry, sync_repo, run_repo), sync_repo, run_repo


@pytest.mark.asyncio
async def test_fetch_not_implemented_is_skipped_not_failed():
    engine, sync_repo, run_repo = _make_engine()

    result = await engine.execute("s1")

    assert result is None
    # MUST NOT be recorded as an error/failure
    sync_repo.update_error.assert_not_called()
    # run is completed as skipped
    assert run_repo.complete.call_args.kwargs.get("status") == "skipped"


@pytest.mark.asyncio
async def test_fetch_not_implemented_keeps_sync_active():
    engine, sync_repo, run_repo = _make_engine()

    await engine.execute("s1")

    # the sync is left healthy ("active"), not stuck in "syncing"/"error"
    statuses = [c.args[1] for c in sync_repo.update_status.call_args_list if len(c.args) >= 2]
    assert statuses[-1] == "active"

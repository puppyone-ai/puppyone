"""Shared fixtures for mut_engine tests.

Lifted here from ``test_git_native_transaction_engine.py`` so newer test
modules (``test_engine_resolve.py``) can reuse the in-memory
``server_repo`` / ``repo_manager`` without copy-pasting the boilerplate.
The original test file keeps its own copies because pytest still picks
up the closer-scoped fixtures when both exist; conftest acts as a
fallback for everyone else.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.mut_engine.application.object_store import ObjectStore
from src.mut_engine.server.repo_manager import MutRepoManager


@pytest.fixture
def memory_store(tmp_path) -> ObjectStore:
    obj_dir = tmp_path / "objects"
    obj_dir.mkdir()
    return ObjectStore(obj_dir)


@pytest.fixture
def server_repo(memory_store):
    from src.mut_engine.server.scope_manager import ScopeManager
    from src.mut_engine.server.server_repo import PuppyOneServerRepo

    from tests.mut_engine.test_server_repo import (
        FakeAuditManager,
        FakeHistoryManager,
    )

    history = FakeHistoryManager()
    audit = FakeAuditManager()

    class FakeScopeBackend:
        def __init__(self):
            self._scopes = {}

        def get(self, sid):
            return self._scopes.get(sid)

        def put(self, sid, scope):
            self._scopes[sid] = scope

        def delete(self, sid):
            return self._scopes.pop(sid, None) is not None

        def list_all(self):
            return list(self._scopes.values())

    return PuppyOneServerRepo(
        project_id="test-proj",
        project_name="Test Project",
        store=memory_store,
        history=history,
        audit=audit,
        scopes=ScopeManager(FakeScopeBackend()),
    )


@pytest.fixture
def repo_manager(server_repo):
    manager = MagicMock(spec=MutRepoManager)
    manager.get_server_repo.return_value = server_repo
    return manager

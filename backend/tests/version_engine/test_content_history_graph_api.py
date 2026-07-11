from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.version_engine.bootstrap.dependencies import (
    get_product_operation_adapter,
    get_repo_manager,
    get_version_admin_service,
    get_version_ref_store,
)
from src.version_engine.entrypoints.http.content_history import history_router
from src.version_engine.read.admin import VersionAdminService
from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.git_object_format import EMPTY_TREE_SHA1


class _History:
    def __init__(self, head_commit_id: str, entries: list[dict]) -> None:
        self._head_commit_id = head_commit_id
        self._entries = {entry["commit_id"]: entry for entry in entries}

    def get_scope_head_commit_id(self, scope_path: str) -> str:
        assert scope_path == ""
        return self._head_commit_id

    def get_head_commit_id(self) -> str:
        return self._head_commit_id

    def get_entries(self, commit_ids: list[str]) -> list[dict]:
        return [self._entries[commit_id] for commit_id in commit_ids if commit_id in self._entries]

    def get_entry(self, commit_id: str) -> dict | None:
        return self._entries.get(commit_id)

    def get_since(self, since_commit_id: str, limit: int = 0) -> list[dict]:
        entries = list(self._entries.values())
        if since_commit_id:
            anchor = next(
                (index for index, entry in enumerate(entries) if entry["commit_id"] == since_commit_id),
                None,
            )
            return entries[anchor + 1:] if anchor is not None else []
        return entries[-limit:] if limit > 0 else entries


class _RepoManager:
    def __init__(self, store: ObjectStore, history: _History) -> None:
        self.repo = SimpleNamespace(store=store, history=history)

    def get_repo(self, project_id: str):
        assert project_id == "project-1"
        return self.repo


class _VersionRefs:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def list_refs(
        self,
        project_id: str,
        scope_path: str = "",
        *,
        strict: bool = False,
    ) -> list[dict]:
        assert project_id == "project-1"
        assert scope_path == ""
        assert strict is True
        return self.rows


class _ProjectService:
    def verify_project_access(self, project_id: str, user_id: str) -> str:
        assert project_id == "project-1"
        assert user_id == "user-1"
        return "viewer"


class _Operations:
    def get_root_hash(self, project_id: str) -> str:
        assert project_id == "project-1"
        return EMPTY_TREE_SHA1


def test_topological_history_api_returns_all_refs_merge_parents_and_cursor_pages(tmp_path):
    store = ObjectStore(tmp_path / "objects")
    base = _put_commit(store, [], 1, "Base")
    main = _put_commit(store, [base], 2, "Main work")
    feature = _put_commit(store, [base], 3, "Feature work")
    merge = _put_commit(store, [main, feature], 4, "Merge feature")
    history = _History(merge, [
        _history_entry(base, "Base", 1),
        _history_entry(main, "Main work", 2),
        # Feature intentionally has no transaction row. It exists only behind
        # the named ref and still must appear in the all-branches graph.
        _history_entry(merge, "Merge feature", 4),
    ])
    refs = _VersionRefs([
        {"ref_name": "refs/heads/feature", "ref_type": "branch", "commit_id": feature},
        {"ref_name": "refs/tags/v1", "ref_type": "tag", "commit_id": main},
    ])
    client = _client(store, history, refs)

    first_response = client.get(
        "/api/v1/content/project-1/commits",
        params={"order": "topo", "limit": 2},
    )
    assert first_response.status_code == 200
    first = first_response.json()["data"]
    assert first["head_commit_id"] == merge
    assert first["total"] == 4
    assert first["has_more"] is True
    assert first["next_cursor"] == feature
    assert [commit["commit_id"] for commit in first["commits"]] == [merge, feature]
    assert first["commits"][0]["parent_ids"] == [main, feature]
    assert first["commits"][1]["message"] == "Feature work"
    assert [ref["ref_name"] for ref in first["refs"]] == [
        "refs/heads/main",
        "refs/heads/feature",
        "refs/tags/v1",
    ]

    second_response = client.get(
        "/api/v1/content/project-1/commits",
        params={"order": "topo", "limit": 2, "cursor": first["next_cursor"]},
    )
    assert second_response.status_code == 200
    second = second_response.json()["data"]
    assert [commit["commit_id"] for commit in second["commits"]] == [main, base]
    assert second["has_more"] is False
    assert second["next_cursor"] is None

    ordered = [
        *[commit["commit_id"] for commit in first["commits"]],
        *[commit["commit_id"] for commit in second["commits"]],
    ]
    assert len(ordered) == len(set(ordered)) == 4
    assert ordered.index(merge) < ordered.index(main)
    assert ordered.index(merge) < ordered.index(feature)
    assert ordered.index(main) < ordered.index(base)
    assert ordered.index(feature) < ordered.index(base)


def test_topological_history_api_rejects_cursor_from_another_ref_snapshot(tmp_path):
    store = ObjectStore(tmp_path / "objects")
    head = _put_commit(store, [], 1, "Head")
    client = _client(store, _History(head, [_history_entry(head, "Head", 1)]), _VersionRefs([]))

    response = client.get(
        "/api/v1/content/project-1/commits",
        params={"order": "topo", "cursor": "f" * 40},
    )

    assert response.status_code == 400
    assert "cursor" in response.json()["detail"]


def test_linear_history_contract_keeps_ascending_catch_up_and_adds_parent_ids(tmp_path):
    store = ObjectStore(tmp_path / "objects")
    base = _put_commit(store, [], 1, "Base")
    middle = _put_commit(store, [base], 2, "Middle")
    head = _put_commit(store, [middle], 3, "Head")
    history = _History(head, [
        _history_entry(base, "Base", 1),
        _history_entry(middle, "Middle", 2),
        _history_entry(head, "Head", 3),
    ])
    client = _client(store, history, _VersionRefs([]))

    latest = client.get(
        "/api/v1/content/project-1/commits",
        params={"limit": 2},
    ).json()["data"]
    assert [commit["commit_id"] for commit in latest["commits"]] == [middle, head]
    assert latest["commits"][0]["parent_ids"] == [base]

    catch_up = client.get(
        "/api/v1/content/project-1/commits",
        params={"limit": 1, "since_commit_id": middle},
    ).json()["data"]
    assert [commit["commit_id"] for commit in catch_up["commits"]] == [head]
    assert catch_up["head_commit_id"] == head


def _client(store: ObjectStore, history: _History, refs: _VersionRefs) -> TestClient:
    repo_manager = _RepoManager(store, history)
    app = FastAPI()
    app.include_router(history_router, prefix="/api/v1/content")
    app.dependency_overrides[get_repo_manager] = lambda: repo_manager
    app.dependency_overrides[get_version_admin_service] = lambda: VersionAdminService(repo_manager)
    app.dependency_overrides[get_version_ref_store] = lambda: refs
    app.dependency_overrides[get_product_operation_adapter] = lambda: _Operations()
    app.dependency_overrides[get_project_service] = lambda: _ProjectService()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id="user-1",
        role="authenticated",
    )
    return TestClient(app)


def _put_commit(
    store: ObjectStore,
    parents: list[str],
    timestamp: int,
    message: str,
) -> str:
    lines = [f"tree {EMPTY_TREE_SHA1}"]
    lines.extend(f"parent {parent}" for parent in parents)
    lines.extend([
        f"author Test Author <author@example.com> {timestamp} +0000",
        f"committer Test Author <author@example.com> {timestamp} +0000",
        "",
        f"{message}\n",
    ])
    return store.put_commit("\n".join(lines).encode())


def _history_entry(commit_id: str, message: str, timestamp: int) -> dict:
    return {
        "commit_id": commit_id,
        "who": "user:test",
        "message": message,
        "changes": [{"path": f"{message.lower().replace(' ', '-')}.md", "action": "update"}],
        "conflicts": [],
        "root_hash": EMPTY_TREE_SHA1,
        "scope_hash": EMPTY_TREE_SHA1,
        "scope_path": "",
        "created_at": f"1970-01-01T00:00:0{timestamp}+00:00",
    }

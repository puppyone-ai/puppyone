import datetime as dt
from types import SimpleNamespace

import src.tool.router as tool_router
from src.auth.models import CurrentUser
from src.tool.models import Tool
from src.tool.router import create_search_tool_async
from src.tool.schemas import ToolCreate


class _FakeBackgroundTasks:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def add_task(self, fn, *args, **kwargs):
        self.calls.append({"fn": fn, "args": args, "kwargs": kwargs})


class _FakeToolService:
    def __init__(self) -> None:
        self.created_payload = None
        self.node_check_calls: list[tuple[str, str]] = []

        now = dt.datetime(2026, 1, 11, tzinfo=dt.timezone.utc)
        self._tool = Tool(
            id="tool_1",
            created_at=now,
            user_id="u1",
            project_id="project_1",
            node_id="node_123",
            json_path="/scope",
            type="search",
            name="my_search",
            alias=None,
            description=None,
            input_schema=None,
            output_schema=None,
            metadata={},
        )

    def get_node_with_access_check(self, user_id: str, node_id: str):
        self.node_check_calls.append((user_id, node_id))
        return SimpleNamespace(project_id="project_1", type="json")

    def create(self, **kwargs):
        self.created_payload = dict(kwargs)
        return self._tool


class _FakeSearchService:
    async def index_scope(self, **kwargs):
        raise AssertionError("index_scope should run in background task")


class _FakeSupabaseClient:
    def get_client(self):
        return object()


class _FakeSearchIndexTaskRepository:
    last_instance = None

    def __init__(self, client) -> None:
        self.client = client
        self.upsert_calls = []
        _FakeSearchIndexTaskRepository.last_instance = self

    def upsert(self, task):
        self.upsert_calls.append(task)


def test_create_search_tool_triggers_pending_task_and_background_indexing(monkeypatch):
    monkeypatch.setattr(tool_router, "SupabaseClient", _FakeSupabaseClient)
    monkeypatch.setattr(
        tool_router, "SearchIndexTaskRepository", _FakeSearchIndexTaskRepository
    )

    tool_service = _FakeToolService()
    search_service = _FakeSearchService()
    background_tasks = _FakeBackgroundTasks()

    payload = ToolCreate(
        node_id="node_123",
        json_path="/scope",
        type="search",
        name="my_search",
        alias=None,
        description=None,
        input_schema=None,
        output_schema=None,
        metadata={},
    )
    current_user = CurrentUser(user_id="u1", role="authenticated")

    resp = create_search_tool_async(
        payload=payload,
        background_tasks=background_tasks,  # type: ignore[arg-type]
        tool_service=tool_service,  # type: ignore[arg-type]
        search_service=search_service,  # type: ignore[arg-type]
        current_user=current_user,
    )

    assert resp.code == 0
    assert tool_service.node_check_calls == [("u1", "node_123")]
    assert tool_service.created_payload is not None
    assert tool_service.created_payload["node_id"] == "node_123"

    repo = _FakeSearchIndexTaskRepository.last_instance
    assert repo is not None
    assert len(repo.upsert_calls) == 1

    pending_task = repo.upsert_calls[0]
    assert pending_task.status == "pending"
    assert pending_task.project_id == "project_1"
    assert pending_task.node_id == "node_123"
    assert pending_task.json_path == "/scope"

    assert len(background_tasks.calls) == 1
    call = background_tasks.calls[0]
    assert call["fn"] is tool_router._run_search_indexing_background
    assert call["kwargs"]["tool_id"] == "tool_1"
    assert call["kwargs"]["user_id"] == "u1"
    assert call["kwargs"]["project_id"] == "project_1"
    assert call["kwargs"]["node_id"] == "node_123"
    assert call["kwargs"]["json_path"] == "/scope"

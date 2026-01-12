import datetime as dt

import pytest

from src.auth.models import CurrentUser
from src.search.service import SearchIndexStats
from src.tool.models import Tool
from src.tool.router import create_tool
from src.tool.schemas import ToolCreate


class _FakeToolService:
    def __init__(self) -> None:
        self.created_payload = None
        self.updated_patches: list[dict] = []

        now = dt.datetime(2026, 1, 11, tzinfo=dt.timezone.utc)
        self._tool = Tool(
            id=1,
            created_at=now,
            user_id="u1",
            table_id=123,
            json_path="/scope",
            type="search",
            name="my_search",
            alias=None,
            description=None,
            input_schema=None,
            output_schema=None,
            metadata={},
        )

    def create(self, **kwargs):
        self.created_payload = dict(kwargs)
        # 模拟 DB 回写：metadata 按创建入参返回
        self._tool.metadata = kwargs.get("metadata")
        return self._tool

    def update(self, *, tool_id: int, user_id: str, patch: dict):
        assert tool_id == self._tool.id
        assert user_id == self._tool.user_id
        self.updated_patches.append(dict(patch))
        if "metadata" in patch:
            self._tool.metadata = patch["metadata"]
        return self._tool


class _FakeTable:
    def __init__(self, project_id: int):
        self.project_id = project_id


class _FakeTableService:
    def __init__(self) -> None:
        self.called = False

    def get_by_id_with_access_check(self, table_id: int, user_id: str):
        self.called = True
        assert table_id == 123
        assert user_id == "u1"
        return _FakeTable(project_id=999)


class _FakeSearchService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def index_scope(self, *, project_id: int, table_id: int, json_path: str):
        self.calls.append(
            {"project_id": project_id, "table_id": table_id, "json_path": json_path}
        )
        return SearchIndexStats(nodes_count=1, chunks_count=2, indexed_chunks_count=2)


@pytest.mark.asyncio
async def test_create_search_tool_triggers_indexing_and_updates_metadata():
    tool_service = _FakeToolService()
    table_service = _FakeTableService()
    search_service = _FakeSearchService()

    payload = ToolCreate(
        table_id=123,
        json_path="/scope",
        type="search",
        name="my_search",
        alias=None,
        description=None,
        input_schema=None,
        output_schema=None,
        metadata={},
    )
    current_user = CurrentUser(user_id="u1", role="user")

    resp = await create_tool(
        payload=payload,
        tool_service=tool_service,  # type: ignore[arg-type]
        table_service=table_service,  # type: ignore[arg-type]
        search_service=search_service,  # type: ignore[arg-type]
        current_user=current_user,
    )

    assert resp.code == 0
    assert table_service.called is True
    assert len(search_service.calls) == 1
    assert search_service.calls[0]["project_id"] == 999

    # 创建时应写入 search_index（至少 configured_at/status）
    created_meta = tool_service.created_payload["metadata"]
    assert "search_index" in created_meta
    assert created_meta["search_index"]["status"] in {"pending", "indexing", "ready"}

    # 成功 indexing 后应更新为 ready 并写入计数
    final_meta = resp.data.metadata  # type: ignore[union-attr]
    assert final_meta["search_index"]["status"] == "ready"
    assert final_meta["search_index"]["indexed_chunks_count"] == 2


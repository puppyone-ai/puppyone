"""McpV2Service bound tools list tests (service-level)

覆盖：
- enabled 绑定默认返回、disabled 默认不返回
- include_disabled=true 时包含 disabled
"""

from __future__ import annotations

from datetime import UTC, datetime

from src.mcp_v2.service import McpV2Service
from src.tool.models import Tool


class _FakeToolRepo:
    def __init__(self, tools: dict[str, Tool]):
        self._tools = tools

    def get_by_id(self, tool_id: str):
        return self._tools.get(tool_id)


class _FakeRepo:
    def __init__(self, bindings: list[object]):
        self._bindings = bindings

    def get_mcp_bindings_by_mcp_id(self, mcp_id: int):
        return self._bindings


def _binding(*, binding_id: int, tool_id: str, status: bool):
    B = type("B", (), {})
    b = B()
    b.id = binding_id
    b.tool_id = tool_id
    b.status = status
    return b


def test_list_bound_tools_by_mcp_id_filters_disabled_by_default():
    svc = McpV2Service.__new__(McpV2Service)
    svc._repo = _FakeRepo(  # type: ignore[attr-defined]
        bindings=[
            _binding(binding_id=10, tool_id="100", status=True),
            _binding(binding_id=11, tool_id="101", status=False),
        ]
    )
    svc._tool_repo = _FakeToolRepo(  # type: ignore[attr-defined]
        tools={
            "100": Tool(
                id="100",
                created_at=datetime.now(UTC),
                user_id="u",
                node_id="node-1",
                json_path="",
                type="query_data",
                name="t1",
            ),
            "101": Tool(
                id="101",
                created_at=datetime.now(UTC),
                user_id="u",
                node_id="node-1",
                json_path="",
                type="query_data",
                name="t2",
            ),
        }
    )

    out = svc.list_bound_tools_by_mcp_id(1)
    assert len(out) == 1
    assert out[0].tool_id == "100"
    assert out[0].binding_status is True


def test_list_bound_tools_by_mcp_id_include_disabled_true():
    svc = McpV2Service.__new__(McpV2Service)
    svc._repo = _FakeRepo(  # type: ignore[attr-defined]
        bindings=[
            _binding(binding_id=10, tool_id="100", status=True),
            _binding(binding_id=11, tool_id="101", status=False),
        ]
    )
    svc._tool_repo = _FakeToolRepo(  # type: ignore[attr-defined]
        tools={
            "100": Tool(
                id="100",
                created_at=datetime.now(UTC),
                user_id="u",
                node_id="node-1",
                json_path="",
                type="query_data",
                name="t1",
            ),
            "101": Tool(
                id="101",
                created_at=datetime.now(UTC),
                user_id="u",
                node_id="node-1",
                json_path="",
                type="query_data",
                name="t2",
            ),
        }
    )

    out = svc.list_bound_tools_by_mcp_id(1, include_disabled=True)
    assert len(out) == 2
    assert {t.tool_id for t in out} == {"100", "101"}
    assert {t.binding_id for t in out} == {10, 11}

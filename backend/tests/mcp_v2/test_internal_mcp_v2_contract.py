"""
internal /internal/mcp-v2/{api_key} 契约测试（轻量）

通过覆盖 get_supabase_repository 依赖，验证返回结构稳定。
"""

from __future__ import annotations

from datetime import datetime, UTC
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.internal.router import router as internal_router, verify_internal_secret


class _FakeTool:
    def __init__(self, id: int, name: str):
        self.id = id
        self.created_at = datetime.now(UTC)
        self.user_id = "u"
        self.table_id = 1
        self.json_path = ""
        self.type = "get_all_data"
        self.name = name
        self.alias = None
        self.description = ""
        self.input_schema = {"type": "object"}
        self.output_schema = None
        self.metadata = None

    def model_dump(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "user_id": self.user_id,
            "table_id": self.table_id,
            "json_path": self.json_path,
            "type": self.type,
            "name": self.name,
            "alias": self.alias,
            "description": self.description,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "metadata": self.metadata,
        }


class _FakeRepo:
    def __init__(self):
        self._mcp = type(
            "M",
            (),
            {"id": 1, "api_key": "k", "user_id": "u", "name": "n", "status": True},
        )()

    def get_mcp_v2_by_api_key(self, api_key: str):
        return self._mcp if api_key == "k" else None

    def get_mcp_bindings_by_mcp_id(self, mcp_id: int):
        B = type("B", (), {})
        b1 = B()
        b1.id = 10
        b1.mcp_id = mcp_id
        b1.tool_id = 100
        b1.status = True
        b2 = B()
        b2.id = 11
        b2.mcp_id = mcp_id
        b2.tool_id = 101
        b2.status = False  # should be filtered out
        return [b1, b2]

    def get_tool(self, tool_id: int):
        if tool_id == 100:
            return _FakeTool(100, "t1")
        if tool_id == 101:
            return _FakeTool(101, "t2")
        return None


def test_internal_mcp_v2_contract_shape():
    app = FastAPI()
    app.include_router(internal_router)

    # override internal secret verifier + repo dep
    app.dependency_overrides[verify_internal_secret] = lambda: None

    from src.supabase.dependencies import get_supabase_repository

    app.dependency_overrides[get_supabase_repository] = lambda: _FakeRepo()

    c = TestClient(app)
    resp = c.get("/internal/mcp-v2/k")
    assert resp.status_code == 200
    body = resp.json()
    assert "mcp_v2" in body
    assert "bound_tools" in body
    assert body["mcp_v2"]["api_key"] == "k"
    assert isinstance(body["bound_tools"], list)
    # status=false binding should be filtered
    assert len(body["bound_tools"]) == 1
    assert body["bound_tools"][0]["tool"]["name"] == "t1"



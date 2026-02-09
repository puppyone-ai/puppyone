"""
迁移脚本：把存量 MCP（旧表）迁移为 MCP v2 + Tool + Binding

默认使用环境变量 SUPABASE_URL / SUPABASE_KEY 连接 Supabase。

用法示例：
  python script/migrate_mcp_to_v2.py --dry-run
  python script/migrate_mcp_to_v2.py --limit 10
"""

from __future__ import annotations

import argparse
from typing import Any, Dict, List, Optional

from src.supabase.dependencies import get_supabase_repository
from src.supabase.mcp_binding.schemas import McpBindingCreate
from src.supabase.mcp_v2.schemas import McpV2Create
from src.supabase.tools.schemas import ToolCreate


DEFAULT_INPUT_SCHEMAS: dict[str, dict[str, Any]] = {
    "get_data_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    "get_all_data": {"type": "object", "properties": {}, "additionalProperties": False},
    "query_data": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "JMESPath查询表达式"}},
        "required": ["query"],
        "additionalProperties": False,
    },
    "create": {
        "type": "object",
        "properties": {
            "elements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"key": {"type": "string"}, "content": {}},
                    "required": ["key", "content"],
                },
            }
        },
        "required": ["elements"],
        "additionalProperties": False,
    },
    "update": {
        "type": "object",
        "properties": {
            "updates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"key": {"type": "string"}, "content": {}},
                    "required": ["key", "content"],
                },
            }
        },
        "required": ["updates"],
        "additionalProperties": False,
    },
    "delete": {
        "type": "object",
        "properties": {"keys": {"type": "array", "items": {"type": "string"}}},
        "required": ["keys"],
        "additionalProperties": False,
    },
    "preview": {"type": "object", "properties": {}, "additionalProperties": False},
    "select": {
        "type": "object",
        "properties": {
            "field": {"type": "string", "description": "用于匹配的字段名"},
            "keys": {"type": "array", "items": {"type": "string"}, "description": "要匹配的值列表"},
        },
        "required": ["field", "keys"],
        "additionalProperties": False,
    },
}


DEFAULT_NAMES: dict[str, str] = {
    "get_data_schema": "get_data_schema",
    "get_all_data": "get_all_data",
    "query_data": "query_data",
    "create": "create_element",
    "update": "update_element",
    "delete": "delete_element",
    "preview": "preview_data",
    "select": "select_data",
}


def _unique_name(desired: str, used: set[str]) -> str:
    if desired not in used:
        used.add(desired)
        return desired
    i = 2
    while True:
        cand = f"{desired}_{i}"
        if cand not in used:
            used.add(cand)
            return cand
        i += 1


def _tool_def_name(tools_definition: Optional[Dict[str, Any]], tool_type: str) -> Optional[str]:
    if not tools_definition or not isinstance(tools_definition, dict):
        return None
    v = tools_definition.get(tool_type)
    if isinstance(v, dict):
        name = v.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def _tool_def_desc(tools_definition: Optional[Dict[str, Any]], tool_type: str) -> Optional[str]:
    if not tools_definition or not isinstance(tools_definition, dict):
        return None
    v = tools_definition.get(tool_type)
    if isinstance(v, dict):
        desc = v.get("description")
        if isinstance(desc, str) and desc.strip():
            return desc.strip()
    return None


def build_tools_from_legacy_mcp(mcp: Any) -> list[ToolCreate]:
    """
    从旧 McpResponse / dict 构造将要写入 tool 表的数据列表。
    """
    tools: list[ToolCreate] = []
    used_names: set[str] = set()

    table_id = int(getattr(mcp, "table_id", None) or 0)
    json_path = getattr(mcp, "json_path", None) or ""
    user_id = getattr(mcp, "user_id", None)
    tools_definition = getattr(mcp, "tools_definition", None)
    register_tools = getattr(mcp, "register_tools", None) or []
    preview_keys = getattr(mcp, "preview_keys", None)

    # register_tools 为空时，按旧默认启用基础工具（不含 preview/select）
    if not register_tools:
        register_tools = ["get_data_schema", "get_all_data", "query_data", "create", "update", "delete"]

    def add_tool(tool_type: str, *, metadata: Optional[dict] = None) -> None:
        raw_name = _tool_def_name(tools_definition, tool_type) or DEFAULT_NAMES[tool_type]
        name = _unique_name(raw_name, used_names)
        desc = _tool_def_desc(tools_definition, tool_type) or ""
        tools.append(
            ToolCreate(
                user_id=user_id,
                table_id=table_id,
                json_path=json_path,
                type=tool_type,
                name=name,
                alias=None,
                description=desc,
                input_schema=DEFAULT_INPUT_SCHEMAS.get(tool_type),
                output_schema=None,
                metadata=metadata,
            )
        )

    # 读工具
    for t in ["get_data_schema", "get_all_data", "query_data"]:
        if t in register_tools or "query" in register_tools:
            add_tool(t)

    # 写工具
    for t in ["create", "update", "delete"]:
        if t in register_tools:
            add_tool(t)

    # preview/select：老字段 preview_keys 存在时才迁移
    if preview_keys and isinstance(preview_keys, list) and len(preview_keys) > 0:
        add_tool("preview", metadata={"preview_keys": preview_keys})
        add_tool("select", metadata={"preview_keys": preview_keys})

    return tools


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不写入数据库")
    parser.add_argument("--limit", type=int, default=0, help="最多迁移多少条旧 MCP（0 表示全部）")
    args = parser.parse_args()

    repo = get_supabase_repository()

    # 注意：这里沿用当前代码的 SupabaseRepository.get_mcps（底层表名由仓库决定）
    legacy_mcps = repo.get_mcps(limit=args.limit or 10000)
    if args.limit:
        legacy_mcps = legacy_mcps[: args.limit]

    print(f"准备迁移旧 MCP 数量: {len(legacy_mcps)} (dry_run={args.dry_run})")

    for mcp in legacy_mcps:
        api_key = getattr(mcp, "api_key", None) or ""
        if not api_key:
            print("skip: legacy mcp missing api_key")
            continue

        user_id = getattr(mcp, "user_id", None)
        if not user_id:
            print(f"skip: api_key={api_key[:12]}... missing user_id")
            continue

        # 创建 mcp_v2（复用旧 api_key，最平滑）
        if args.dry_run:
            print(f"[dry-run] create mcp_v2 api_key={api_key[:12]}... user_id={user_id}")
            continue

        existed = repo.get_mcp_v2_by_api_key(api_key)
        if existed:
            mcp_v2 = existed
        else:
            mcp_v2 = repo.create_mcp_v2(
                McpV2Create(
                    user_id=user_id,
                    name=getattr(mcp, "name", None),
                    api_key=api_key,
                    status=bool(getattr(mcp, "status", False)),
                )
            )

        tools = build_tools_from_legacy_mcp(mcp)
        for t in tools:
            created_tool = repo.create_tool(t)
            repo.create_mcp_binding(
                McpBindingCreate(mcp_id=mcp_v2.id, tool_id=created_tool.id, status=True)
            )

        print(
            f"migrated: api_key={api_key[:12]}... -> mcp_v2.id={mcp_v2.id} tools={len(tools)}"
        )


if __name__ == "__main__":
    main()



"""
工具定义：tool_types / ToolDefinitionProvider / build_tools_list
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Literal, Optional

import mcp.types as mcp_types


tool_types = Literal[
    "get_data_schema",
    "get_all_data",
    "query_data",
    "create",
    "update",
    "delete",
    "preview",
    "select",
]

ALL_TOOLS_LIST = [
    "get_data_schema",
    "get_all_data",
    "query_data",
    "create",
    "update",
    "delete",
]

# 描述模板目录
DESCRIPTION_DIR = Path(__file__).parent.parent / "tool" / "description"


class ToolDefinitionProvider:
    """工具定义提供者，支持自定义工具名称和描述"""

    def __init__(self, tools_definition: Optional[Dict[str, Any]] = None):
        self.tools_definition = tools_definition or {}
        self.default_names: Dict[str, str] = {
            "get_data_schema": "get_data_schema",
            "get_all_data": "get_all_data",
            "query_data": "query_data",
            "create": "create_element",
            "update": "update_element",
            "delete": "delete_element",
            "preview": "preview_data",
            "select": "select_data",
        }
        # 缓存已加载的描述模板
        self._description_cache: Dict[str, str] = {}

    def _load_description_template(self, tool_type: str) -> str:
        """从文件加载描述模板"""
        if tool_type in self._description_cache:
            return self._description_cache[tool_type]

        template_path = DESCRIPTION_DIR / f"{tool_type}.txt"
        if template_path.exists():
            template = template_path.read_text(encoding="utf-8")
            self._description_cache[tool_type] = template
            return template

        # 降级到简单描述
        fallback = f"{tool_type} 工具"
        self._description_cache[tool_type] = fallback
        return fallback

    def get_tool_name(self, tool_type: tool_types) -> str:
        if tool_type in self.tools_definition:
            return self.tools_definition[tool_type].get(
                "name", self.default_names[tool_type]
            )
        return self.default_names[tool_type]

    def get_tool_description(self, tool_type: tool_types, table_info: Dict[str, Any]) -> str:
        # 优先使用自定义描述
        if tool_type in self.tools_definition:
            custom_desc = self.tools_definition[tool_type].get("description")
            if custom_desc:
                return custom_desc

        # 从模板文件加载并格式化
        template = self._load_description_template(tool_type)
        table_name = table_info.get("table_name", "未知表格")
        table_description = table_info.get("table_description", "")

        # 格式化表格描述
        table_description_str = f"描述：{table_description}" if table_description else ""

        return template.format(
            table_name=table_name,
            table_description=table_description_str,
        )


def build_tools_list(config: Dict[str, Any], tool_provider: ToolDefinitionProvider) -> list[mcp_types.Tool]:
    """根据配置构建工具列表"""
    tools: list[mcp_types.Tool] = []
    mcp_instance = config["mcp_instance"]
    table_metadata = config["table_metadata"]
    register_tools = mcp_instance.get("register_tools", ["query", "create", "update", "delete"])
    preview_keys = mcp_instance.get("preview_keys")

    table_info = {
        "table_name": table_metadata["name"],
        "table_description": table_metadata.get("description", ""),
    }

    # 读工具（由旧 query 拆分）
    if "query" in register_tools or "get_data_schema" in register_tools:
        t: tool_types = "get_data_schema"
        tools.append(
            mcp_types.Tool(
                name=tool_provider.get_tool_name(t),
                description=tool_provider.get_tool_description(t, table_info),
                inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
            )
        )

    if "query" in register_tools or "get_all_data" in register_tools:
        t = "get_all_data"
        tools.append(
            mcp_types.Tool(
                name=tool_provider.get_tool_name(t),
                description=tool_provider.get_tool_description(t, table_info),
                inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
            )
        )

    if "query" in register_tools or "query_data" in register_tools:
        t = "query_data"
        tools.append(
            mcp_types.Tool(
                name=tool_provider.get_tool_name(t),
                description=tool_provider.get_tool_description(t, table_info),
                inputSchema={
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "JMESPath查询表达式"}},
                    "required": ["query"],
                    "additionalProperties": False,
                },
            )
        )

    # 变更工具
    for t in ["create", "update", "delete"]:
        if t not in register_tools:
            continue

        tool_name = tool_provider.get_tool_name(t)  # type: ignore[arg-type]
        tool_description = tool_provider.get_tool_description(t, table_info)  # type: ignore[arg-type]

        if t == "create":
            input_schema = {
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
            }
        elif t == "update":
            input_schema = {
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
            }
        else:  # delete
            input_schema = {
                "type": "object",
                "properties": {"keys": {"type": "array", "items": {"type": "string"}}},
                "required": ["keys"],
                "additionalProperties": False,
            }

        tools.append(
            mcp_types.Tool(name=tool_name, description=tool_description, inputSchema=input_schema)
        )

    # LLM Retrieve 工具（只有配置了 preview_keys 才注册）
    if preview_keys and len(preview_keys) > 0:
        for t in ["preview", "select"]:
            tool_name = tool_provider.get_tool_name(t)  # type: ignore[arg-type]
            tool_description = tool_provider.get_tool_description(t, table_info)  # type: ignore[arg-type]

            if t == "preview":
                input_schema = {"type": "object", "properties": {}, "additionalProperties": False}
            else:
                input_schema = {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string", "description": "用于匹配的字段名"},
                        "keys": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "要匹配的值列表",
                        },
                    },
                    "required": ["field", "keys"],
                    "additionalProperties": False,
                }

            tools.append(
                mcp_types.Tool(name=tool_name, description=tool_description, inputSchema=input_schema)
            )

    return tools

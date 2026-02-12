"""mcp_service.server 的 POSIX 工具装配测试。"""

from __future__ import annotations

from mcp_service.server import _build_agent_tools_list, _find_access_and_tool_type


def _names(tools):
    return {tool.name for tool in tools}


def test_build_agent_tools_list_includes_posix_and_legacy_tools():
    config = {
        "mode": "agent",
        "agent": {"id": "agent-1", "name": "Agent"},
        "accesses": [
            {
                "node_id": "node-folder",
                "node_name": "docs",
                "node_type": "folder",
                "bash_readonly": False,
                "tool_query": True,
                "tool_create": True,
                "tool_update": True,
                "tool_delete": True,
                "json_path": "",
            }
        ],
        "tools": [
            {
                "tool_id": "tool-1",
                "name": "search_docs",
                "type": "search",
                "description": "Search docs",
            }
        ],
    }

    tools = _build_agent_tools_list(config)
    names = _names(tools)

    assert {
        "ls",
        "cat",
        "write",
        "mkdir",
        "rm",
        "node_0_get_schema",
        "node_0_get_all_data",
        "node_0_query_data",
        "node_0_create",
        "node_0_update",
        "node_0_delete",
        "tool_search_docs",
    }.issubset(names)

    legacy_descriptions = {
        tool.description for tool in tools if tool.name.startswith("node_0_")
    }
    assert legacy_descriptions
    assert all(description.startswith("[Legacy]") for description in legacy_descriptions)


def test_build_agent_tools_list_readonly_folder_has_readonly_posix_only():
    config = {
        "mode": "agent",
        "agent": {"id": "agent-1", "name": "Agent"},
        "accesses": [
            {
                "node_id": "node-folder",
                "node_name": "docs",
                "node_type": "folder",
                "bash_readonly": True,
                "tool_query": True,
                "tool_create": False,
                "tool_update": False,
                "tool_delete": False,
                "json_path": "",
            }
        ],
        "tools": [],
    }

    tools = _build_agent_tools_list(config)
    names = _names(tools)

    assert {"ls", "cat"}.issubset(names)
    assert "write" not in names
    assert "mkdir" not in names
    assert "rm" not in names


def test_build_agent_tools_list_without_folder_access_has_no_posix_tools():
    config = {
        "mode": "agent",
        "agent": {"id": "agent-1", "name": "Agent"},
        "accesses": [
            {
                "node_id": "node-json",
                "node_name": "users",
                "node_type": "json",
                "bash_readonly": False,
                "tool_query": True,
                "tool_create": True,
                "tool_update": True,
                "tool_delete": True,
                "json_path": "/users",
            }
        ],
        "tools": [],
    }

    tools = _build_agent_tools_list(config)
    names = _names(tools)

    assert "ls" not in names
    assert "cat" not in names
    assert "write" not in names
    assert "mkdir" not in names
    assert "rm" not in names


def test_find_access_and_tool_type_handles_custom_builtin_and_invalid():
    config = {
        "accesses": [
            {
                "node_id": "node-1",
                "tool_query": True,
                "tool_create": False,
                "tool_update": False,
                "tool_delete": False,
            }
        ],
        "tools": [{"name": "search_docs", "type": "search", "tool_id": "tool-1"}],
    }

    tool_config, tool_type, category = _find_access_and_tool_type(config, "tool_search_docs")
    assert tool_config is not None
    assert tool_config["tool_id"] == "tool-1"
    assert tool_type == "search"
    assert category == "custom"

    access, builtin_type, builtin_category = _find_access_and_tool_type(
        config, "node_0_get_schema"
    )
    assert access is config["accesses"][0]
    assert builtin_type == "get_schema"
    assert builtin_category == "builtin"

    assert _find_access_and_tool_type(config, "node_x_get_schema") == (None, None, None)
    assert _find_access_and_tool_type(config, "node_99_get_schema") == (None, None, None)
    assert _find_access_and_tool_type(config, "unknown") == (None, None, None)


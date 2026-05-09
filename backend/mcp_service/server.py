"""
MCP Server - Unified Agent mode implementation.
Built on the MCP Python SDK with dynamic tool configuration and multi-tenant isolation.

Only Agent mode is supported:
- Access via the Agent's mcp_api_key (prefixed with "mcp_")
- Configuration is read from the agent + agent_bash + agent_tool tables
- V2 mode and Legacy mode have been removed

Tool types:
1. Built-in tools (based on agent_bash): data CRUD operations
2. Custom tools (based on agent_tool): search, custom_script, etc.
"""
from __future__ import annotations

import contextlib
import json
from typing import Any, AsyncIterator

from mcp.server.lowlevel import Server as MCP_Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
import mcp.types as mcp_types

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.types import Receive, Scope, Send

from .cache import CacheManager
from .core.auth import extract_api_key

_ERR_NO_QUERY_PERMISSION = "Error: no query permission"
from .core.config_loader import load_mcp_config
from .core.session_registry import SessionRegistry
from .event_store import InMemoryEventStore
from .rpc.client import create_client
from .tool.fs_tool import FsToolImplementation
from .tool.table_tool import TableToolImplementation

# POSIX tool name set (used for call_tool routing)
_POSIX_TOOL_NAMES = frozenset({"ls", "cat", "write", "mkdir", "rm"})


def _build_agent_tools_list(config: dict[str, Any]) -> list[mcp_types.Tool]:
    """
    Generate an MCP tool list from the Agent configuration.

    Tool sources:
    1. agent_bash (accesses): data CRUD tools
       - tool_query: generates query_data tool
       - tool_create: generates create_data tool
       - tool_update: generates update_data tool
       - tool_delete: generates delete_data tool

    2. agent_tool (tools): custom tools
       - search: vector search tool
       - other custom tools
    """
    agent = config.get("agent", {})
    accesses = config.get("accesses", [])
    custom_tools = config.get("tools", [])
    _agent_name = agent.get("name", "Agent")

    tools: list[mcp_types.Tool] = []

    # ==========================================
    # Part 1: Built-in data CRUD tools (based on agent_bash)
    # ==========================================
    for idx, access in enumerate(accesses):
        path = access.get("path", "")
        _json_path = access.get("json_path", "")

        # Generate tool name prefix (use index to avoid conflicts)
        prefix = f"node_{idx}"

        # 1. Query tool (get_data_schema + get_all_data + query_data)
        if access.get("tool_query"):
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_get_schema",
                    description=f"[Legacy] Get JSON data schema (node: {path}). Prefer using 'cat' instead.",
                    inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
                )
            )
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_get_all_data",
                    description=f"[Legacy] Get all JSON data (node: {path}). Prefer using 'cat' instead.",
                    inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
                )
            )
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_query_data",
                    description=f"[Legacy] Query JSON data with JMESPath (node: {path}). Useful for fine-grained JSON queries.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "JMESPath query expression"},
                        },
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                )
            )

        # 2. Create tool
        if access.get("tool_create"):
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_create",
                    description=f"[Legacy] Create JSON data elements (node: {path}). Prefer using 'write' instead.",
                    inputSchema={
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
                )
            )

        # 3. Update tool
        if access.get("tool_update"):
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_update",
                    description=f"[Legacy] Update JSON data elements (node: {path}). Prefer using 'write' instead.",
                    inputSchema={
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
                )
            )

        # 4. Delete tool
        if access.get("tool_delete"):
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_delete",
                    description=f"[Legacy] Delete JSON data elements (node: {path}). Prefer using 'rm' instead.",
                    inputSchema={
                        "type": "object",
                        "properties": {"keys": {"type": "array", "items": {"type": "string"}}},
                        "required": ["keys"],
                        "additionalProperties": False,
                    },
                )
            )

    # ==========================================
    # Part 2: Custom tools (based on agent_tool)
    # ==========================================
    for tool_config in custom_tools:
        tool_name = tool_config.get("name", "")
        tool_type = tool_config.get("type", "")
        tool_description = tool_config.get("description") or f"{tool_name} tool"
        input_schema = tool_config.get("input_schema")

        if not tool_name:
            continue

        # Use tool_ prefix to distinguish custom tools from built-in tools
        mcp_tool_name = f"tool_{tool_name}"

        # Handle different tool types
        if tool_type == "search":
            # Search tool uses standard query input
            tools.append(
                mcp_types.Tool(
                    name=mcp_tool_name,
                    description=tool_description,
                    inputSchema=input_schema or {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "top_k": {"type": "integer", "description": "Number of results to return", "default": 5},
                        },
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                )
            )
        else:
            # Other custom tools use their defined input_schema
            tools.append(
                mcp_types.Tool(
                    name=mcp_tool_name,
                    description=tool_description,
                    inputSchema=input_schema or {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": True,
                    },
                )
            )

    # ==========================================
    # Part 3: POSIX filesystem tools (based on node_type)
    # ==========================================
    has_folder = any(a.get("node_type") == "folder" for a in accesses)
    if has_folder:
        tools.extend(_build_fs_tools_list(accesses))

    return tools


def _build_fs_tools_list(accesses: list[dict[str, Any]]) -> list[mcp_types.Tool]:
    """
    Generate the POSIX filesystem tool list.
    - Always registered: ls, cat
    - Registered when not readonly: write, mkdir, rm
    """
    has_write = any(not a.get("bash_readonly") for a in accesses)

    tools: list[mcp_types.Tool] = [
        mcp_types.Tool(
            name="ls",
            description=(
                "List directory contents. Returns entries with full paths. "
                "Use without path argument to list root directory."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": 'Absolute path to list, e.g. "/docs". Defaults to "/".',
                    },
                },
                "additionalProperties": False,
            },
        ),
        mcp_types.Tool(
            name="cat",
            description=(
                "Read file content. Returns JSON content, Markdown text, "
                "or file metadata depending on type. "
                "For folders, returns directory listing (same as ls)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": 'Absolute path to read, e.g. "/docs/readme.md".',
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        ),
    ]

    if has_write:
        tools.extend([
            mcp_types.Tool(
                name="write",
                description=(
                    "Write or create a file. If the file exists, updates its content. "
                    "If not, creates a new file (type inferred from extension: "
                    ".md -> Markdown, .json -> JSON). "
                    "Content should be a string for Markdown or an object for JSON."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": 'Absolute path, e.g. "/docs/new-doc.md".',
                        },
                        "content": {
                            "description": "File content: string for Markdown, object/array for JSON.",
                        },
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            ),
            mcp_types.Tool(
                name="mkdir",
                description="Create a new folder at the specified path.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": 'Absolute path for new folder, e.g. "/docs/drafts".',
                        },
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            ),
            mcp_types.Tool(
                name="rm",
                description="Remove a file or folder from the current tree.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": 'Absolute path to remove, e.g. "/docs/old-doc.md".',
                        },
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            ),
        ])

    return tools


def _find_access_and_tool_type(config: dict[str, Any], tool_name: str) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """
    Find the corresponding configuration and tool type by tool name.

    Tool naming convention:
    - Built-in tools: node_{idx}_{type}
    - Custom tools: tool_{name}

    Returns: (config, tool_type, tool_category)
    - tool_category: "builtin" or "custom"
    """
    accesses = config.get("accesses", [])
    custom_tools = config.get("tools", [])

    # Case 1: Custom tools (tool_ prefix)
    if tool_name.startswith("tool_"):
        custom_name = tool_name[5:]  # Strip the "tool_" prefix
        for tool_config in custom_tools:
            if tool_config.get("name") == custom_name:
                return tool_config, tool_config.get("type"), "custom"
        return None, None, None

    # Case 2: Built-in tools (node_ prefix)
    # Parse tool name: node_0_get_schema -> idx=0, type=get_schema
    parts = tool_name.split("_", 2)
    if len(parts) < 3 or parts[0] != "node":
        return None, None, None

    try:
        idx = int(parts[1])
    except ValueError:
        return None, None, None

    tool_type = parts[2]

    if idx >= len(accesses):
        return None, None, None

    return accesses[idx], tool_type, "builtin"


def build_starlette_app(*, json_response: bool = True) -> Starlette:
    """Build a Starlette application instance (MCP handler assembly)."""

    # 1. Create StreamableHTTPSessionManager
    ## MCP server
    mcp_server = MCP_Server("puppyone-contextbase-mcp")
    ## Session registry: used to notify active clients of tool changes
    sessions = SessionRegistry()
    ## Event store implementation: used for SSE event replay
    event_store = InMemoryEventStore()
    session_manager = StreamableHTTPSessionManager(
        app=mcp_server,
        event_store=event_store,
        json_response=json_response,
        stateless=False,
    )

    # 2. Create internal RPC client
    rpc_client = create_client()

    # 3. Create tool implementations
    table_tool = TableToolImplementation(rpc_client)

    ####################
    ### Protocol interface hooks
    ####################

    @mcp_server.list_tools()
    async def list_tools() -> list[mcp_types.Tool]:
        """List available tools (Agent mode only)."""
        try:
            ctx = mcp_server.request_context
            request = ctx.request
            if request is None:
                return []

            # 1. Extract api_key
            api_key = extract_api_key(request)
            # 2. Bind api_key and session for subsequent notifications
            await sessions.bind(api_key, ctx.session)

            # 3. Fetch Agent configuration
            config = await load_mcp_config(api_key, rpc_client)
            if not config:
                return []

            # Agent mode: generate tools from agent accesses
            if config.get("mode") == "agent":
                return _build_agent_tools_list(config)

            # Other modes are no longer supported
            return []
        except Exception as e:
            print(f"Error listing tools: {e}")
            return []

    @mcp_server.call_tool()
    async def call_tool(
        name: str, arguments: dict[str, Any]
    ) -> list[mcp_types.TextContent]:
        """Execute a tool call (Agent mode only)."""
        try:
            ctx = mcp_server.request_context
            request = ctx.request
            if request is None:
                raise RuntimeError("missing request context")

            api_key = extract_api_key(request)
            await sessions.bind(api_key, ctx.session)

            config = await load_mcp_config(api_key, rpc_client)
            if not config:
                return [
                    mcp_types.TextContent(type="text", text="Error: Agent configuration does not exist or failed to load")
                ]

            # Agent mode: execute based on agent accesses configuration
            if config.get("mode") != "agent":
                return [mcp_types.TextContent(type="text", text="Error: only Agent mode is supported")]

            result: Any = None

            # ==========================================
            # POSIX filesystem tools (ls, cat, write, mkdir, rm)
            # ==========================================
            if name in _POSIX_TOOL_NAMES:
                fs_tool = FsToolImplementation(rpc_client)
                project_id = config.get("agent", {}).get("project_id", "")
                fs_accesses = config.get("accesses", [])
                # SECURITY (C-3): the access_point owner is the principal we
                # impersonate when calling /internal/nodes/*. Without this,
                # the call gets rejected with HTTP 400 (X-Acting-User-Id
                # required).
                acting_user_id = config.get("agent", {}).get("user_id") or None

                # Runtime permission check: write/mkdir/rm require at least one non-readonly access
                if name in ("write", "mkdir", "rm"):
                    has_write = any(not a.get("bash_readonly") for a in fs_accesses)
                    if not has_write:
                        return [mcp_types.TextContent(
                            type="text",
                            text="Error: no write permission, all data sources are read-only"
                        )]

                if name == "ls":
                    result = await fs_tool.ls(
                        project_id, fs_accesses,
                        arguments.get("path", "/"),
                        acting_user_id=acting_user_id,
                    )
                elif name == "cat":
                    result = await fs_tool.cat(
                        project_id, fs_accesses,
                        arguments.get("path", "/"),
                        acting_user_id=acting_user_id,
                    )
                elif name == "write":
                    result = await fs_tool.write(
                        project_id, fs_accesses,
                        arguments.get("path", ""),
                        arguments.get("content"),
                        acting_user_id=acting_user_id,
                    )
                elif name == "mkdir":
                    result = await fs_tool.mkdir(
                        project_id, fs_accesses,
                        arguments.get("path", ""),
                        acting_user_id=acting_user_id,
                    )
                elif name == "rm":
                    agent_id = config.get("agent", {}).get("id", "system")
                    result = await fs_tool.rm(
                        project_id, fs_accesses,
                        arguments.get("path", ""),
                        user_id=agent_id,
                        acting_user_id=acting_user_id,
                    )
            else:
                # ==========================================
                # Legacy tool routing (node_{idx}_* and tool_*)
                # ==========================================
                tool_config, tool_type, tool_category = _find_access_and_tool_type(config, name)
                if not tool_config or not tool_type:
                    return [mcp_types.TextContent(type="text", text=f"Error: unknown tool name: {name}")]

                # Custom tool execution
                if tool_category == "custom":
                    tool_id = tool_config.get("tool_id", "")

                    if tool_type == "search":
                        query = arguments.get("query", "")
                        top_k = arguments.get("top_k", 5)
                        result = await rpc_client.search_tool_query(tool_id, query, top_k)
                    else:
                        return [mcp_types.TextContent(type="text", text=f"Error: unsupported custom tool type: {tool_type}")]

                # Built-in JSON CRUD tool execution (based on agent_bash)
                else:
                    access = tool_config
                    path = access.get("path", "")
                    json_path = access.get("json_path", "")

                    if not path:
                        return [mcp_types.TextContent(type="text", text="Error: path is missing")]

                    if tool_type == "get_schema":
                        if not access.get("tool_query"):
                            return [mcp_types.TextContent(type="text", text=_ERR_NO_QUERY_PERMISSION)]
                        result = await table_tool.get_data_schema(table_id=path, json_path=json_path)
                    elif tool_type == "get_all_data":
                        if not access.get("tool_query"):
                            return [mcp_types.TextContent(type="text", text=_ERR_NO_QUERY_PERMISSION)]
                        result = await table_tool.get_all_data(table_id=path, json_path=json_path)
                    elif tool_type == "query_data":
                        if not access.get("tool_query"):
                            return [mcp_types.TextContent(type="text", text=_ERR_NO_QUERY_PERMISSION)]
                        query = arguments.get("query")
                        result = await table_tool.query_data(table_id=path, json_path=json_path, query=query)
                    elif tool_type == "create":
                        if not access.get("tool_create"):
                            return [mcp_types.TextContent(type="text", text="Error: no create permission")]
                        elements = arguments.get("elements", [])
                        result = await table_tool.create_element(table_id=path, json_path=json_path, elements=elements)
                    elif tool_type == "update":
                        if not access.get("tool_update"):
                            return [mcp_types.TextContent(type="text", text="Error: no update permission")]
                        updates = arguments.get("updates", [])
                        result = await table_tool.update_element(table_id=path, json_path=json_path, updates=updates)
                    elif tool_type == "delete":
                        if not access.get("tool_delete"):
                            return [mcp_types.TextContent(type="text", text="Error: no delete permission")]
                        keys = arguments.get("keys", [])
                        result = await table_tool.delete_element(table_id=path, json_path=json_path, keys=keys)
                    else:
                        return [mcp_types.TextContent(type="text", text=f"Error: unsupported tool type: {tool_type}")]

            return [
                mcp_types.TextContent(
                    type="text", text=json.dumps(result, ensure_ascii=False, indent=2)
                )
            ]
        except Exception as e:
            import traceback

            error_text = f"Error: {e!s}\n\n{traceback.format_exc()}"
            return [mcp_types.TextContent(type="text", text=error_text)]

    async def handle_mcp(scope: Scope, receive: Receive, send: Send) -> None:
        await session_manager.handle_request(scope=scope, receive=receive, send=send)

    async def handle_healthz(_: Request) -> JSONResponse:
        cache_stats = await CacheManager.get_stats()
        return JSONResponse(
            {"status": "healthy", "service": "mcp-service", "cache": cache_stats}
        )

    async def handle_cache_invalidate(request: Request) -> JSONResponse:
        """
        Main service notifies this MCP server that instance data has changed;
        the corresponding cache entries must be invalidated.
        """
        try:
            body = await request.json()
            api_key = body.get("api_key")
            table_id = body.get("table_id")

            if api_key:
                await CacheManager.invalidate_config(api_key)
                notified = await sessions.notify_tools_list_changed(api_key)
                return JSONResponse(
                    {"message": f"Invalidated cache for api_key={api_key}", "notified_sessions": notified}
                )

            if table_id:
                await CacheManager.invalidate_all_table_data(table_id)
                return JSONResponse({"message": f"Invalidated cache for table_id={table_id}"})

            return JSONResponse({"error": "Missing api_key or table_id parameter"}, status_code=400)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @contextlib.asynccontextmanager
    async def lifespan(_: Starlette) -> AsyncIterator[None]:
        async with session_manager.run():
            yield
            await rpc_client.close()

    app = Starlette(
        routes=[
            Mount("/mcp", app=handle_mcp),
            Route("/healthz", handle_healthz, methods=["GET"]),
            Route("/cache/invalidate", handle_cache_invalidate, methods=["POST"]),
        ],
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app

def load_settings():
    """Load and validate settings (raises on failure so uvicorn surfaces the error at startup)."""
    from .settings import settings

    try:
        settings.validate()
    except ValueError as e:
        print(f"Configuration error: {e}")
        raise

    # Display settings (sensitive values are masked)
    print("MCP Server settings:")
    for key, value in settings.display().items():
        print(f"  {key}: {value}")
    print()

    return settings


def create_app() -> Starlette:
    """Create a Starlette application instance (same style as main service `src/main.py`: exports `app`)."""
    settings = load_settings()
    app = build_starlette_app()
    print(
        f"""
╔══════════════════════════════════════════════════════════╗
║  ContextBase MCP Server - Shared service mode           ║
╠══════════════════════════════════════════════════════════╣
║  Listen:   {settings.HOST}:{settings.PORT}                              ║
║  MCP:      http://{settings.HOST}:{settings.PORT}/mcp                   ║
║  Health:   http://{settings.HOST}:{settings.PORT}/healthz              ║
║  Cache:    {settings.CACHE_BACKEND} (TTL: {settings.CACHE_TTL}s)                    ║
╚══════════════════════════════════════════════════════════╝
"""
    )
    return app


# uvicorn start command (recommended to use uv run, consistent with main service):
# uv run uvicorn mcp_service.server:app --host 0.0.0.0 --port 3090 --reload --log-level info
app = create_app()

"""
MCP Server - 整合后的 Agent 模式实现
基于 MCP Python SDK，支持动态工具配置和多租户隔离

整合后只支持 Agent 模式：
- 通过 Agent 的 mcp_api_key（以 "mcp_" 开头）访问
- 配置从 agent + agent_bash + agent_tool 表读取
- V2 模式和 Legacy 模式已移除

工具类型：
1. 内置工具（基于 agent_bash）：数据 CRUD 操作
2. 自定义工具（基于 agent_tool）：search, custom_script 等
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
from .core.config_loader import load_mcp_config
from .core.session_registry import SessionRegistry
from .event_store import InMemoryEventStore
from .rpc.client import create_client
from .tool.table_tool import TableToolImplementation


def _build_agent_tools_list(config: dict[str, Any]) -> list[mcp_types.Tool]:
    """
    根据 Agent 配置生成 MCP 工具列表。
    
    工具来源：
    1. agent_bash (accesses): 数据 CRUD 工具
       - tool_query: 生成 query_data 工具
       - tool_create: 生成 create_data 工具
       - tool_update: 生成 update_data 工具
       - tool_delete: 生成 delete_data 工具
       
    2. agent_tool (tools): 自定义工具
       - search: 向量搜索工具
       - 其他自定义工具
    """
    agent = config.get("agent", {})
    accesses = config.get("accesses", [])
    custom_tools = config.get("tools", [])
    agent_name = agent.get("name", "Agent")
    
    tools: list[mcp_types.Tool] = []
    
    # ==========================================
    # Part 1: 基于 agent_bash 的内置数据 CRUD 工具
    # ==========================================
    for idx, access in enumerate(accesses):
        node_id = access.get("node_id", "")
        json_path = access.get("json_path", "")
        
        # 生成工具名前缀（使用索引避免冲突）
        prefix = f"node_{idx}"
        
        # 1. Query tool (get_data_schema + get_all_data + query_data)
        if access.get("tool_query"):
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_get_schema",
                    description=f"获取数据结构（node: {node_id}）",
                    inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
                )
            )
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_get_all_data",
                    description=f"获取所有数据（node: {node_id}）",
                    inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
                )
            )
            tools.append(
                mcp_types.Tool(
                    name=f"{prefix}_query_data",
                    description=f"使用 JMESPath 查询数据（node: {node_id}）",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "JMESPath 查询表达式"},
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
                    description=f"创建数据元素（node: {node_id}）",
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
                    description=f"更新数据元素（node: {node_id}）",
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
                    description=f"删除数据元素（node: {node_id}）",
                    inputSchema={
                        "type": "object",
                        "properties": {"keys": {"type": "array", "items": {"type": "string"}}},
                        "required": ["keys"],
                        "additionalProperties": False,
                    },
                )
            )
    
    # ==========================================
    # Part 2: 基于 agent_tool 的自定义工具
    # ==========================================
    for tool_config in custom_tools:
        tool_name = tool_config.get("name", "")
        tool_type = tool_config.get("type", "")
        tool_description = tool_config.get("description") or f"{tool_name} tool"
        input_schema = tool_config.get("input_schema")
        
        if not tool_name:
            continue
        
        # 使用 tool_ 前缀区分自定义工具和内置工具
        mcp_tool_name = f"tool_{tool_name}"
        
        # 处理不同类型的工具
        if tool_type == "search":
            # Search 工具使用标准的查询输入
            tools.append(
                mcp_types.Tool(
                    name=mcp_tool_name,
                    description=tool_description,
                    inputSchema=input_schema or {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "搜索查询"},
                            "top_k": {"type": "integer", "description": "返回结果数量", "default": 5},
                        },
                        "required": ["query"],
                        "additionalProperties": False,
                    },
                )
            )
        else:
            # 其他自定义工具使用其定义的 input_schema
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
    
    return tools


def _find_access_and_tool_type(config: dict[str, Any], tool_name: str) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """
    根据工具名找到对应的配置和工具类型。
    
    工具命名规则:
    - 内置工具: node_{idx}_{type}
    - 自定义工具: tool_{name}
    
    返回: (config, tool_type, tool_category)
    - tool_category: "builtin" 或 "custom"
    """
    accesses = config.get("accesses", [])
    custom_tools = config.get("tools", [])
    
    # Case 1: 自定义工具 (tool_ 前缀)
    if tool_name.startswith("tool_"):
        custom_name = tool_name[5:]  # 去掉 "tool_" 前缀
        for tool_config in custom_tools:
            if tool_config.get("name") == custom_name:
                return tool_config, tool_config.get("type"), "custom"
        return None, None, None
    
    # Case 2: 内置工具 (node_ 前缀)
    # 解析工具名: node_0_get_schema -> idx=0, type=get_schema
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
    """构建 Starlette 应用实例（MCP handler 装配）"""

    # 1. 创建StreamableHTTPSessionManager
    ## mcp服务器
    mcp_server = MCP_Server("puppyone-contextbase-mcp")
    ## 会话注册表: 用于通知活跃的客户端工具变更消息
    sessions = SessionRegistry()
    ## 事件存储层实现: 用于SSE的事件回放
    event_store = InMemoryEventStore()
    session_manager = StreamableHTTPSessionManager(
        app=mcp_server,
        event_store=event_store,
        json_response=json_response,
        stateless=False,
    )

    # 2. 创建内部RPC客户端
    rpc_client = create_client()

    # 3. 创建工具实现
    table_tool = TableToolImplementation(rpc_client)

    ####################
    ### 协议接口的Hook
    ####################

    @mcp_server.list_tools()
    async def list_tools() -> list[mcp_types.Tool]:
        """列出可用工具（只支持 Agent 模式）"""
        try:
            ctx = mcp_server.request_context
            request = ctx.request
            if request is None:
                return []

            # 1. 提取 api_key
            api_key = extract_api_key(request)
            # 2. 绑定 api_key 和 session，方便后续通知
            await sessions.bind(api_key, ctx.session)

            # 3. 拉取 Agent 配置
            config = await load_mcp_config(api_key, rpc_client)
            if not config:
                return []

            # Agent 模式：根据 agent accesses 生成工具
            if config.get("mode") == "agent":
                return _build_agent_tools_list(config)

            # 其他模式已不支持
            return []
        except Exception as e:
            print(f"Error listing tools: {e}")
            return []

    @mcp_server.call_tool()
    async def call_tool(
        name: str, arguments: dict[str, Any]
    ) -> list[mcp_types.TextContent]:
        """执行工具调用（只支持 Agent 模式）"""
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
                    mcp_types.TextContent(type="text", text="错误: Agent 配置不存在或加载失败")
                ]

            # Agent 模式：根据 agent accesses 配置执行
            if config.get("mode") != "agent":
                return [mcp_types.TextContent(type="text", text="错误: 只支持 Agent 模式")]

            tool_config, tool_type, tool_category = _find_access_and_tool_type(config, name)
            if not tool_config or not tool_type:
                return [mcp_types.TextContent(type="text", text=f"错误: 未知的工具名称: {name}")]
            
            result: Any = None
            
            # ==========================================
            # 自定义工具执行
            # ==========================================
            if tool_category == "custom":
                tool_id = tool_config.get("tool_id", "")
                node_id = tool_config.get("node_id", "")
                json_path = tool_config.get("json_path", "")
                
                if tool_type == "search":
                    # Search 工具：调用内部搜索 API
                    query = arguments.get("query", "")
                    top_k = arguments.get("top_k", 5)
                    result = await rpc_client.search_tool_query(tool_id, query, top_k)
                else:
                    # 其他自定义工具：暂不支持
                    return [mcp_types.TextContent(type="text", text=f"错误: 暂不支持的自定义工具类型: {tool_type}")]
            
            # ==========================================
            # 内置工具执行 (基于 agent_bash)
            # ==========================================
            else:
                access = tool_config
                node_id = access.get("node_id", "")
                json_path = access.get("json_path", "")
                
                if not node_id:
                    return [mcp_types.TextContent(type="text", text="错误: node_id 缺失")]
                
                if tool_type == "get_schema":
                    if not access.get("tool_query"):
                        return [mcp_types.TextContent(type="text", text="错误: 没有查询权限")]
                    result = await table_tool.get_data_schema(table_id=node_id, json_path=json_path)
                elif tool_type == "get_all_data":
                    if not access.get("tool_query"):
                        return [mcp_types.TextContent(type="text", text="错误: 没有查询权限")]
                    result = await table_tool.get_all_data(table_id=node_id, json_path=json_path)
                elif tool_type == "query_data":
                    if not access.get("tool_query"):
                        return [mcp_types.TextContent(type="text", text="错误: 没有查询权限")]
                    query = arguments.get("query")
                    result = await table_tool.query_data(table_id=node_id, json_path=json_path, query=query)
                elif tool_type == "create":
                    if not access.get("tool_create"):
                        return [mcp_types.TextContent(type="text", text="错误: 没有创建权限")]
                    elements = arguments.get("elements", [])
                    result = await table_tool.create_element(table_id=node_id, json_path=json_path, elements=elements)
                elif tool_type == "update":
                    if not access.get("tool_update"):
                        return [mcp_types.TextContent(type="text", text="错误: 没有更新权限")]
                    updates = arguments.get("updates", [])
                    result = await table_tool.update_element(table_id=node_id, json_path=json_path, updates=updates)
                elif tool_type == "delete":
                    if not access.get("tool_delete"):
                        return [mcp_types.TextContent(type="text", text="错误: 没有删除权限")]
                    keys = arguments.get("keys", [])
                    result = await table_tool.delete_element(table_id=node_id, json_path=json_path, keys=keys)
                else:
                    return [mcp_types.TextContent(type="text", text=f"错误: 未支持的工具类型: {tool_type}")]
            
            return [
                mcp_types.TextContent(
                    type="text", text=json.dumps(result, ensure_ascii=False, indent=2)
                )
            ]
        except Exception as e:
            import traceback

            error_text = f"错误: {str(e)}\n\n{traceback.format_exc()}"
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
        主服务通知mcp server(本服务): MCP实例数据状态发生更改, 需要将cache设置为失效状态。
        """
        try:
            body = await request.json()
            api_key = body.get("api_key")
            table_id = body.get("table_id")

            if api_key:
                await CacheManager.invalidate_config(api_key)
                notified = await sessions.notify_tools_list_changed(api_key)
                return JSONResponse(
                    {"message": f"已使api_key={api_key}的缓存失效", "notified_sessions": notified}
                )

            if table_id:
                await CacheManager.invalidate_all_table_data(table_id)
                return JSONResponse({"message": f"已使table_id={table_id}的缓存失效"})

            return JSONResponse({"error": "缺少api_key或table_id参数"}, status_code=400)
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
    """加载并验证配置（失败直接抛异常，便于 uvicorn 启动时显式报错）"""
    from .settings import settings

    try:
        settings.validate()
    except ValueError as e:
        print(f"❌ 配置错误: {e}")
        raise

    # 显示配置（隐藏敏感信息）
    print("📋 MCP Server 配置:")
    for key, value in settings.display().items():
        print(f"  {key}: {value}")
    print()

    return settings


def create_app() -> Starlette:
    """创建 Starlette 应用实例（与主服务 `src/main.py` 同风格：导出 `app`）"""
    settings = load_settings()
    app = build_starlette_app()
    print(
        f"""
╔══════════════════════════════════════════════════════════╗
║  ContextBase MCP Server - 共享服务模式                  ║
╠══════════════════════════════════════════════════════════╣
║  监听地址: {settings.HOST}:{settings.PORT}                              ║
║  MCP端点: http://{settings.HOST}:{settings.PORT}/mcp                   ║
║  健康检查: http://{settings.HOST}:{settings.PORT}/healthz              ║
║  缓存后端: {settings.CACHE_BACKEND} (TTL: {settings.CACHE_TTL}s)                    ║
╚══════════════════════════════════════════════════════════╝
"""
    )
    return app


# uvicorn 启动命令（推荐用 uv run 对齐主服务）:
# uv run uvicorn mcp_service.server:app --host 0.0.0.0 --port 3090 --reload --log-level info
app = create_app()

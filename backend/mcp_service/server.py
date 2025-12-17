"""
新的MCP Server实现
基于MCP Python SDK，支持动态工具配置和多租户隔离
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
from .core.tools_definition import ToolDefinitionProvider, build_tools_list, tool_types
from .event_store import InMemoryEventStore
from .rpc.client import create_client
from .tool.table_tool import TableToolImplementation


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
        try:
            ctx = mcp_server.request_context
            request = ctx.request
            if request is None:
                return []

            # 1. 提取api_key
            api_key = extract_api_key(request)
            # 2. 绑定api_key和session，方便后续通知
            await sessions.bind(api_key, ctx.session)

            # 3. 拉取用户的工具配置
            config = await load_mcp_config(api_key, rpc_client)
            if not config:
                return []

            if config["mcp_instance"]["status"] != 1:
                return []

            tool_provider = ToolDefinitionProvider(config.get("tools_definition"))
            return build_tools_list(config, tool_provider)
        except Exception as e:
            print(f"Error listing tools: {e}")
            return []

    @mcp_server.call_tool()
    async def call_tool(
        name: str, arguments: dict[str, Any]
    ) -> list[mcp_types.TextContent]:
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
                    mcp_types.TextContent(type="text", text="错误: MCP实例不存在或配置加载失败")
                ]

            if config["mcp_instance"]["status"] != 1:
                return [mcp_types.TextContent(type="text", text="错误: MCP实例已关闭")]

            tool_provider = ToolDefinitionProvider(config.get("tools_definition"))
            mcp_instance = config["mcp_instance"]
            table_id = mcp_instance["table_id"]
            json_path = mcp_instance["json_path"]
            register_tools = mcp_instance.get(
                "register_tools", ["query", "create", "update", "delete"]
            )
            preview_keys = mcp_instance.get("preview_keys")

            name_to_type: dict[str, tool_types] = {}
            for t in [
                "get_data_schema",
                "get_all_data",
                "query_data",
                "create",
                "update",
                "delete",
                "preview",
                "select",
            ]:
                tool_name = tool_provider.get_tool_name(t)  # type: ignore[arg-type]
                name_to_type[tool_name] = t  # type: ignore[assignment]

            tool_type = name_to_type.get(name)
            if not tool_type:
                return [
                    mcp_types.TextContent(type="text", text=f"错误: 未知的工具名称: {name}")
                ]

            # 检查工具是否启用
            if tool_type in ["preview", "select"]:
                if not preview_keys or len(preview_keys) == 0:
                    return [
                        mcp_types.TextContent(
                            type="text",
                            text=f"错误: 工具 {name} 未启用（需要配置preview_keys）",
                        )
                    ]
            else:
                if tool_type in ["get_data_schema", "get_all_data", "query_data"]:
                    if "query" not in register_tools and tool_type not in register_tools:
                        return [
                            mcp_types.TextContent(type="text", text=f"错误: 工具 {name} 未注册")
                        ]
                elif tool_type not in register_tools:
                    return [mcp_types.TextContent(type="text", text=f"错误: 工具 {name} 未注册")]

            # 调用实现
            result: Any = None
            if tool_type == "get_data_schema":
                result = await table_tool.get_data_schema(
                    table_id=table_id, json_path=json_path
                )
            elif tool_type == "get_all_data":
                result = await table_tool.get_all_data(table_id=table_id, json_path=json_path)
            elif tool_type == "query_data":
                query = arguments.get("query")
                result = await table_tool.query_data(
                    table_id=table_id, json_path=json_path, query=query
                )
            elif tool_type == "create":
                elements = arguments.get("elements", [])
                result = await table_tool.create_element(
                    table_id=table_id, json_path=json_path, elements=elements
                )
            elif tool_type == "update":
                updates = arguments.get("updates", [])
                result = await table_tool.update_element(
                    table_id=table_id, json_path=json_path, updates=updates
                )
            elif tool_type == "delete":
                keys = arguments.get("keys", [])
                result = await table_tool.delete_element(
                    table_id=table_id, json_path=json_path, keys=keys
                )
            elif tool_type == "preview":
                result = await table_tool.preview_data(
                    table_id=table_id, json_path=json_path, preview_keys=preview_keys
                )
            elif tool_type == "select":
                field = arguments.get("field")
                keys = arguments.get("keys", [])
                result = await table_tool.select_tables(
                    table_id=table_id, json_path=json_path, field=field, keys=keys
                )

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

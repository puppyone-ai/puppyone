"""
ContextBase MCP Server
"""

import argparse
import uvicorn
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastmcp import FastMCP, Context
from app.utils.logger import log_info, log_error
from app.core.dependencies import get_mcp_instance_service, get_user_context_service
# Middleware
from app.mcp_server.middleware.http_auth_middleware import HttpJwtTokenAuthMiddleware
from starlette.middleware import Middleware as StarletteMiddleware
# Schema
from app.models.user_context import UserContext
from app.models.mcp import McpInstance
from app.mcp_server.schema.context import CreateElementRequest
# Tool Implementation
from app.mcp_server.tools.context_tool import ContextTool, tool_types
from app.mcp_server.tools.vector_tool import VectorRetriveTool
from app.mcp_server.tools.tool_provider import create_tool_definition_provider, ToolDefinitionProvider

# 全局 context 信息（在启动时初始化）
_context_info: Dict[str, Any] = {
    # MCP Server标识信息
    "user_id": None,
    "project_id": None,
    "context_id": None,
    "json_pointer": None,
    # 对应的知识库和项目内容
    "context": None,
    "context_name": None,
    "context_description": None,
    "context_metadata": None,
    "project_name": None,
    "project_description": None,
    "project_metadata": None,
    # LLM Retrieve相关配置
    "preview_keys": None,
}

# 全局工具实例
_tools_instances = {}

# 全局工具定义提供者
_tool_definition_provider: Optional[ToolDefinitionProvider] = None

def _get_tools():
    """ 获取或创建工具单例, 对应工具的具体实现 """
    global _tools_instances
    if not _tools_instances:
        _tools_instances = {
            "context_tool": ContextTool(),
            # "llm_tool": LLMTool(),
            # "vector_retrive_tool": VectorRetriveTool(),
        }
    return _tools_instances

def _init_context_info_and_tool_definition_provider(api_key: str) -> None:
    """
    根据 api_key 初始化 context 信息
    
    Args:
        api_key: API key
    """
    global _context_info
    try:
        # 获取API_KEY对应的MCP实例信息
        # 注意：这里需要使用同步方式，或者使用 asyncio.run
        mcp_service = get_mcp_instance_service()
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        instance: Optional[McpInstance] = loop.run_until_complete(mcp_service.get_mcp_instance_by_api_key(api_key))
        loop.close()
        
        if not instance:
            log_error(f"MCP instance not found for api_key: {api_key[:20]}...")
            raise ValueError(f"MCP instance not found for api_key: {api_key[:20]}...")
        
        user_id = str(instance.user_id)
        project_id = str(instance.project_id)
        context_id = str(instance.context_id)
        
        # 补充获取 context 对象
        user_context_service = get_user_context_service()
        context: Optional[UserContext] = user_context_service.get_by_id(context_id)
        
        if not context:
            log_error(f"Context not found for context_id: {context_id}")
            raise ValueError(f"Context not found for context_id: {context_id}")
        
        # ⚠️: 这里是Mock的项目数据
        project_name = "测试项目名"
        project_description = "测试项目描述"
        project_metadata = {
            "project_id": project_id,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        
        # 更新全局 context 信息
        json_pointer = instance.json_pointer if hasattr(instance, 'json_pointer') else ""
        preview_keys = instance.preview_keys if hasattr(instance, 'preview_keys') else None
        _context_info = {
            "user_id": user_id,
            "project_id": project_id,
            "context_id": context_id,
            "json_pointer": json_pointer,
            "context": context,
            "project_name": project_name,
            "project_description": project_description,
            "project_metadata": project_metadata,
            "context_name": context.context_name,
            "context_description": context.context_description,
            "context_metadata": context.metadata,
            "preview_keys": preview_keys,
        }
        
        log_info(f"Context info initialized: user_id={user_id}, project_id={project_id}, context_id={context_id}")
        
        # 初始化工具定义提供者, 支持用户自定义工具描述
        global _tool_definition_provider
        tools_definition = instance.tools_definition
        _tool_definition_provider = create_tool_definition_provider(tools_definition)
        
    except Exception as e:
        log_error(f"Error initializing context info: {e}")
        raise

# ==================== 工具注册器 ====================

class ToolRegistry:
    """
    工具注册器类
    负责创建和注册所有 MCP 工具
    """
    
    def __init__(
        self,
        tool_definition_provider: ToolDefinitionProvider,
        context_info: Dict[str, Any],
        tools_instances: Dict[str, Any]
    ):
        """
        初始化工具注册器
        
        Args:
            tool_definition_provider: 工具定义提供者
            context_info: 上下文信息字典
            tools_instances: 工具实例字典
        """
        self.tool_definition_provider = tool_definition_provider
        self.context_info = context_info
        self.tools_instances = tools_instances
    
    def _get_tool_name(self, tool_type: tool_types) -> str:
        """获取工具名称"""
        return self.tool_definition_provider.get_tool_name(tool_type)
    
    def _get_tool_description(self, tool_type: tool_types) -> str:
        """获取工具描述"""
        return self.tool_definition_provider.get_tool_description(tool_type, self.context_info)
    
    def create_query_context_tool(self, mcp_instance: FastMCP):
        """创建 query_context 工具"""
        tool_name = self._get_tool_name("query")
        description = self._get_tool_description("query")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def query_context(
            schema: Optional[str] = None,
            query: Optional[str] = None,
            ctx: Context = None
        ) -> dict:
            return context_tool.query_context(self.context_info, schema=schema, query=query)
        
        query_context.__doc__ = description
        return query_context
    
    def create_create_element_tool(self, mcp_instance: FastMCP):
        """创建 create_element 工具"""
        tool_name = self._get_tool_name("create")
        description = self._get_tool_description("create")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def create_element(elements: List[CreateElementRequest], ctx: Context) -> dict:
            # 将 CreateElementRequest 对象转换为字典
            elements_dict = [
                {"key": elem.key, "content": elem.content} 
                for elem in elements
            ]
            return context_tool.create_element(elements_dict, self.context_info)
        
        create_element.__doc__ = description
        return create_element
    
    def create_update_element_tool(self, mcp_instance: FastMCP):
        """创建 update_element 工具"""
        tool_name = self._get_tool_name("update")
        description = self._get_tool_description("update")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def update_element(updates: List[CreateElementRequest], ctx: Context) -> dict:
            # 将 CreateElementRequest 对象转换为字典
            updates_dict = [
                {"key": elem.key, "content": elem.content} 
                for elem in updates
            ]
            return context_tool.update_element(updates_dict, self.context_info)
        
        update_element.__doc__ = description
        return update_element
    
    def create_delete_element_tool(self, mcp_instance: FastMCP):
        """创建 delete_element 工具"""
        tool_name = self._get_tool_name("delete")
        description = self._get_tool_description("delete")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def delete_element(keys: List[str], ctx: Context) -> dict:
            return context_tool.delete_element(keys, self.context_info)
        
        delete_element.__doc__ = description
        return delete_element
    
    def create_preview_data_tool(self, mcp_instance: FastMCP):
        """创建 preview_data 工具"""
        tool_name = self._get_tool_name("preview")
        description = self._get_tool_description("preview")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def preview_data(ctx: Context = None) -> dict:
            return context_tool.preview_data(self.context_info)
        
        preview_data.__doc__ = description
        return preview_data
    
    def create_select_contexts_tool(self, mcp_instance: FastMCP):
        """创建 select_contexts 工具"""
        tool_name = self._get_tool_name("select")
        description = self._get_tool_description("select")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def select_contexts(field: str, keys: List[str], ctx: Context = None) -> dict:
            return context_tool.select_contexts(field, keys, self.context_info)
        
        select_contexts.__doc__ = description
        return select_contexts
    
    # def create_vector_retrieve_tool(self, mcp_instance: FastMCP):
    #     """创建 vector_retrieve 工具"""
    #     @mcp_instance.tool()
    #     async def vector_retrieve(query: str, ctx: Context, top_k: int = 5) -> dict:
    #         """
    #         向量检索
            
    #         Args:
    #             query: 查询文本（模型可见的参数）
    #             top_k: 返回结果数量（模型可见的参数）
    #         """
    #         user_id = self.context_info.get("user_id")
    #         project_id = self.context_info.get("project_id")
    #         context_id = self.context_info.get("context_id")
            
    #         # TODO: 实际的向量检索逻辑
    #         # 使用 user_id, project_id, context_id 来确定检索范围
            
    #         return {
    #             "message": "向量检索完成",
    #             "query": query,
    #             "top_k": top_k,
    #             "user_id": user_id,
    #             "project_id": project_id,
    #             "context_id": context_id,
    #             "results": [],  # TODO: 实际的检索结果
    #         }
        
    #     return vector_retrieve
    
    def register_all_tools(self, mcp_instance: FastMCP, register_tools: Optional[List[str]] = None):
        """
        注册工具到 MCP 实例
        
        Args:
            mcp_instance: FastMCP 实例
            register_tools: 需要注册的工具列表（可选），如果为 None 或空列表，则注册所有工具
        """
        # 默认注册所有基础工具（注意：get已改为query）
        if register_tools is None or len(register_tools) == 0:
            register_tools = ["query", "create", "update", "delete"]
        
        # 兼容旧的 "get" 工具类型，自动映射为 "query"
        if "get" in register_tools:
            register_tools = [tool if tool != "get" else "query" for tool in register_tools]
        
        # 注册上下文管理工具（根据 register_tools 选择性注册）
        if "query" in register_tools:
            self.create_query_context_tool(mcp_instance)
        if "create" in register_tools:
            self.create_create_element_tool(mcp_instance)
        if "update" in register_tools:
            self.create_update_element_tool(mcp_instance)
        if "delete" in register_tools:
            self.create_delete_element_tool(mcp_instance)
        
        # LLM Retrieve 工具：只有当 preview_keys 非空时才注册
        preview_keys = self.context_info.get("preview_keys")
        if preview_keys and len(preview_keys) > 0:
            self.create_preview_data_tool(mcp_instance)
            self.create_select_contexts_tool(mcp_instance)
            log_info(f"LLM Retrieve tools registered with preview_keys: {preview_keys}")
        
        # 注册向量检索工具
        # self.create_vector_retrieve_tool(mcp_instance)
        
        log_info(f"Tools registered successfully: {register_tools}")

# ==================== 启动入口 ====================
def run_mcp_server(
    transport: str = "http",
    host: str = "0.0.0.0",
    port: int = 9090,
    api_key: Optional[str] = None,
    register_tools: Optional[List[str]] = None,
):
    """
    独立启动MCP服务器

    Args:
        transport: 传输协议，支持"http"和"stdio"
        host: 主机地址
        port: 端口号
        api_key: API key，用于获取 context 信息
        register_tools: 需要注册的工具列表（可选），如果为 None，则注册所有工具
    """

    # 1. 初始化 context 信息和工具定义描述提供者
    if not api_key:
        log_error("api_key is required")
        raise ValueError("api_key is required")
    
    log_info(f"Initializing context info with api_key: {api_key[:20]}...")
    _init_context_info_and_tool_definition_provider(api_key)
    log_info(f"Context initialized: {_context_info.get("context").context_name}")

    # 2. 初始化工具实现实例
    tools_instances = _get_tools()

    # 3. 创建工具注册器
    tool_registry = ToolRegistry(
        tool_definition_provider=_tool_definition_provider,
        context_info=_context_info,
        tools_instances=tools_instances
    )

    # 4. 创建 MCP 实例（在 context 初始化之后）
    mcp = FastMCP(
        name="ContextBase MCP Server",
        version="1.0.0",
    )
    
    # 5. 注册工具（具备动态工具名称与动态工具描述）
    tool_registry.register_all_tools(mcp, register_tools=register_tools)
    
    if transport == 'stdio':
        log_error("暂时不支持stdio方式启动")
        exit(1)
    elif transport == 'http':
        log_info(f"""Tool descriptions generated with dynamic context information
ContextBase MCP Server - FastMCP 2.13
传输模式: {transport.upper()}
HTTP端点: http://{host}:{port}/mcp
""")
        mcp_app = mcp.http_app(
            path="/mcp",
            middleware=[
                StarletteMiddleware(
                    HttpJwtTokenAuthMiddleware,
                    mcp_service=get_mcp_instance_service()
                )
            ]
        )
        uvicorn.run(mcp_app, host=host, port=port, log_level="info")
    else:
        raise ValueError(f"Unsupported transport: {transport}")
    

if __name__ == "__main__":
    # 支持通过命令行参数传递host和port
    parser = argparse.ArgumentParser(description="启动ContextBase MCP Server")
    parser.add_argument('--host', type=str, default="0.0.0.0", help='监听主机，默认0.0.0.0')
    parser.add_argument('--port', type=int, default=9090, help='监听端口，默认9090')
    parser.add_argument('--transport', type=str, default="http", choices=["http", "stdio"], help="传输协议（http 或 stdio），默认http")
    parser.add_argument('--api_key', type=str, required=True, help='API key，用于获取 context 信息')
    parser.add_argument('--register_tools', type=str, default=None, help='需要注册的工具列表，逗号分隔，例如：get,create,update,delete。如果不提供，则注册所有工具。')
    args = parser.parse_args()

    # 解析 register_tools 参数
    register_tools = None
    if args.register_tools:
        register_tools = [tool.strip() for tool in args.register_tools.split(",") if tool.strip()]

    run_mcp_server(
        transport=args.transport,
        host=args.host,
        port=args.port,
        api_key=args.api_key,
        register_tools=register_tools,
    )

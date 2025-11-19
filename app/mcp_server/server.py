"""
ContextBase MCP Server - FastMCP 2.13版本实现
"""

import sys
import argparse
import asyncio

from fastmcp import FastMCP, Context
from app.utils.logger import log_info, log_error
from app.models.user_context import UserContext
from app.models.mcp import McpInstance
from app.mcp_server.middleware.http_auth_middleware import HttpJwtTokenAuthMiddleware
from app.core.dependencies import get_mcp_instance_service, get_user_context_service
from starlette.middleware import Middleware as StarletteMiddleware
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from datetime import datetime
import uvicorn
# 工具
from app.mcp_server.tools.context_tool import ContextTool, tool_types
from app.mcp_server.tools.llm_tool import LLMTool
from app.mcp_server.tools.vector_tool import VectorRetriveTool
from app.mcp_server.tools.tool_provider import create_tool_definition_provider, ToolDefinitionProvider

class CreateElementRequest(BaseModel):
    key: str
    content: Any

# 全局 context 信息（在启动时初始化）
_context_info: Dict[str, Any] = {
    "user_id": None,
    "project_id": None,
    "context_id": None,

    "context_name": None,
    "context_description": None,
    "context_metadata": None,
    "project_name": None,
    "project_description": None,
    "project_metadata": None,
}

# 全局工具实例
_tools_instances = {}

# 全局工具定义提供者
_tool_definition_provider: Optional[ToolDefinitionProvider] = None

def _get_tools():
    """ 获取或创建工具单例 """
    global _tools_instances
    if not _tools_instances:
        _tools_instances = {
            "context_tool": ContextTool(),
            "llm_tool": LLMTool(),
            "vector_retrive_tool": VectorRetriveTool(),
        }
    return _tools_instances

def _init_context_info(api_key: str) -> None:
    """
    根据 api_key 初始化 context 信息
    
    Args:
        api_key: API key
    """
    global _context_info
    try:
        # 1. 通过 api_key 获取 MCP 实例
        mcp_service = get_mcp_instance_service()
        # 注意：这里需要使用同步方式，或者使用 asyncio.run
        # 但由于这是在启动时调用的，我们需要使用 asyncio.run
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        instance: Optional[McpInstance] = loop.run_until_complete(mcp_service.get_mcp_instance_by_api_key(api_key))
        loop.close()
        
        if not instance:
            log_error(f"MCP instance not found for api_key: {api_key[:20]}...")
            raise ValueError(f"MCP instance not found for api_key: {api_key[:20]}...")
        
        # 2. 提取业务参数
        user_id = str(instance.user_id)
        project_id = str(instance.project_id)
        context_id = str(instance.context_id)
        
        # 3. 根据 context_id 获取 context 对象
        user_context_service = get_user_context_service()
        context: Optional[UserContext] = user_context_service.get_by_id(context_id)
        
        if not context:
            log_error(f"Context not found for context_id: {context_id}")
            raise ValueError(f"Context not found for context_id: {context_id}")
        
        # 4. 获取项目信息（暂时使用 project_id 作为 project_name）
        # TODO: 如果有 project service，可以从 project_id 获取项目详细信息
        project_name = "测试项目"
        project_description = "测试项目描述"
        project_metadata = {
            "project_id": project_id,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        
        # 5. 更新全局 context 信息
        _context_info = {
            "user_id": user_id,
            "project_id": project_id,
            "context_id": context_id,
            "context": context,
            "project_name": project_name,
            "project_description": project_description,
            "project_metadata": project_metadata,
            "context_name": context.context_name,
            "context_description": context.context_description,
            "context_metadata": context.metadata,
        }
        
        log_info(f"Context info initialized: user_id={user_id}, project_id={project_id}, context_id={context_id}")
        
        # 6. 初始化工具定义提供者（从 instance 获取 tools_definition）
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
    
    def create_get_context_tool(self, mcp_instance: FastMCP):
        """创建 get_context 工具"""
        tool_name = self._get_tool_name("get")
        description = self._get_tool_description("get")
        context_tool = self.tools_instances["context_tool"]
        
        @mcp_instance.tool(name=tool_name, description=description)
        async def get_context(ctx: Context) -> dict:
            return context_tool.get_context(self.context_info)
        
        get_context.__doc__ = description
        return get_context
    
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
    
    def create_vector_retrieve_tool(self, mcp_instance: FastMCP):
        """创建 vector_retrieve 工具"""
        @mcp_instance.tool()
        async def vector_retrieve(query: str, ctx: Context, top_k: int = 5) -> dict:
            """
            向量检索
            
            Args:
                query: 查询文本（模型可见的参数）
                top_k: 返回结果数量（模型可见的参数）
            """
            user_id = self.context_info.get("user_id")
            project_id = self.context_info.get("project_id")
            context_id = self.context_info.get("context_id")
            
            # TODO: 实际的向量检索逻辑
            # 使用 user_id, project_id, context_id 来确定检索范围
            
            return {
                "message": "向量检索完成",
                "query": query,
                "top_k": top_k,
                "user_id": user_id,
                "project_id": project_id,
                "context_id": context_id,
                "results": [],  # TODO: 实际的检索结果
            }
        
        return vector_retrieve
    
    def register_all_tools(self, mcp_instance: FastMCP):
        """
        注册所有工具到 MCP 实例
        
        Args:
            mcp_instance: FastMCP 实例
        """
        # 注册上下文管理工具
        self.create_get_context_tool(mcp_instance)
        self.create_create_element_tool(mcp_instance)
        self.create_update_element_tool(mcp_instance)
        self.create_delete_element_tool(mcp_instance)
        
        # 注册向量检索工具
        self.create_vector_retrieve_tool(mcp_instance)
        
        log_info("All tools registered successfully")

# ==================== 启动入口 ====================
def run_mcp_server(
    transport: str = "http",
    host: str = "0.0.0.0",
    port: int = 9090,
    api_key: Optional[str] = None,
):
    """
    独立启动MCP服务器

    Args:
        transport: 传输协议，支持"http"和"stdio"
        host: 主机地址
        port: 端口号
        api_key: API key，用于获取 context 信息
    """
    # 1. 初始化 context 信息（必须在创建 MCP 实例之前）
    if not api_key:
        log_error("api_key is required")
        raise ValueError("api_key is required")
    
    log_info(f"Initializing context info with api_key: {api_key[:20]}...")
    _init_context_info(api_key)
    
    context = _context_info.get("context")
    if not context:
        log_error("Failed to initialize context")
        raise ValueError("Failed to initialize context")
    
    log_info(f"Context initialized: {context.context_name}")

    # 2. 初始化工具实例
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
    
    # 5. 注册所有工具（此时 context 信息已准备好，可以生成动态描述）
    tool_registry.register_all_tools(mcp)
    
    log_info("Tool descriptions generated with dynamic context information")

    log_info(f"ContextBase MCP Server - FastMCP 2.13")
    log_info(f"传输模式: {transport.upper()}")
    if transport == 'stdio':
        log_error("暂时不支持stdio方式启动")
        exit(1)
    elif transport == 'http':
        log_info(f"  HTTP端点: http://{host}:{port}/mcp")
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
    args = parser.parse_args()

    run_mcp_server(
        transport=args.transport,
        host=args.host,
        port=args.port,
        api_key=args.api_key,
    )

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
        user_id = int(instance.user_id)
        project_id = instance.project_id
        context_id = int(instance.context_id)
        
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
        
    except Exception as e:
        log_error(f"Error initializing context info: {e}")
        raise

# ==================== 工具工厂函数 ====================

def _get_dynamic_tool_description(tool_type: tool_types) -> str:
    """
    生成动态工具描述
    
    Args:
        tool_type: 工具类型（create/update/delete/get）
    
    Returns:
        工具描述字符串
    """
    global _context_info
    context_tool = _get_tools()["context_tool"]
    
    # 获取 context 信息
    context = _context_info.get("context")
    if not context:
        # 如果 context 未初始化，返回默认描述
        return f"知识库管理工具 - {tool_type}"
    
    # 生成动态描述
    return context_tool.generate_tool_description(
        project_name=_context_info.get("project_name", "未知项目"),
        context_name=context.context_name,
        tool_type=tool_type,
        project_description=_context_info.get("project_description"),
        project_metadata=_context_info.get("project_metadata"),
        context_description=context.context_description,
        context_metadata=context.metadata
    )

def _create_get_context_tool(mcp_instance: FastMCP):
    """创建 get_context 工具"""
    # 先获取动态描述
    dynamic_description = _get_dynamic_tool_description("get")
    
    # 尝试在装饰器中传递 description，如果不支持则使用 docstring
    @mcp_instance.tool(name="get_context", description=dynamic_description)
    async def get_context(ctx: Context) -> dict:
        try:
            global _context_info
            context = _context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": _context_info.get("context_id")
                }
            
            # 返回完整的context_data（JSON对象）
            return {
                "message": "获取知识库内容成功",
                "data": context.context_data if context.context_data else {}
            }
        except Exception as e:
            log_error(f"Error getting context: {e}")
            return {
                "error": f"获取知识库内容失败: {str(e)}"
            }
    
    # 同时设置 docstring 作为备用（如果装饰器不支持 description 参数）
    get_context.__doc__ = dynamic_description
    return get_context

def _create_create_element_tool(mcp_instance: FastMCP):
    """创建 create_element 工具"""
    # 先获取动态描述
    dynamic_description = _get_dynamic_tool_description("create")
    
    @mcp_instance.tool(name="create_element", description=dynamic_description)
    async def create_element(elements: List[CreateElementRequest], ctx: Context) -> dict:
        try:
            global _context_info
            context_id = _context_info.get("context_id")
            context = _context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_id
                }
            
            # 获取当前context_data
            context_data = context.context_data.copy() if context.context_data else {}
            
            # 验证并创建元素
            created_keys = []
            failed_keys = []
            
            for element in elements:
                if not isinstance(element, dict):
                    failed_keys.append({"element": element, "reason": "元素必须是字典类型"})
                    continue
                
                key = element.key
                content = element.content
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if key in context_data:
                    failed_keys.append({"key": key, "reason": "key已存在"})
                    continue
                
                # 创建新的键值对
                context_data[key] = content
                created_keys.append(key)
            
            if not created_keys:
                return {
                    "error": "没有成功创建任何元素",
                    "failed": failed_keys
                }
            
            # 更新context_data
            user_context_service = get_user_context_service()
            updated_context = user_context_service.update(
                context_id=context_id,
                context_name=context.context_name,
                context_description=context.context_description,
                context_data=context_data,
                metadata=context.metadata
            )
            
            if not updated_context:
                return {
                    "error": "更新知识库失败"
                }
            
            return {
                "message": "元素创建成功",
                "created_keys": created_keys,
                "failed": failed_keys if failed_keys else None,
                "total_created": len(created_keys),
                "total_failed": len(failed_keys)
            }
        except Exception as e:
            log_error(f"Error creating elements: {e}")
            return {
                "error": f"创建元素失败: {str(e)}"
            }
    
    # 同时设置 docstring 作为备用
    create_element.__doc__ = dynamic_description
    return create_element

def _create_update_element_tool(mcp_instance: FastMCP):
    """创建 update_element 工具"""
    # 先获取动态描述
    dynamic_description = _get_dynamic_tool_description("update")
    
    @mcp_instance.tool(name="update_element", description=dynamic_description)
    async def update_element(updates: List[CreateElementRequest], ctx: Context) -> dict:
        try:
            global _context_info
            context_id = _context_info.get("context_id")
            context = _context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_id
                }
            
            # 获取当前context_data
            context_data = context.context_data.copy() if context.context_data else {}
            
            # 验证并更新元素
            updated_keys = []
            failed_keys = []
            
            for update_item in updates:
                if not isinstance(update_item, dict):
                    failed_keys.append({"update": update_item, "reason": "更新项必须是字典类型"})
                    continue
                
                key = update_item.key
                value = update_item.content
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if key not in context_data:
                    failed_keys.append({"key": key, "reason": "key不存在于知识库中"})
                    continue
                
                # 更新键值对（完全替换）
                context_data[key] = value
                updated_keys.append(key)
            
            if not updated_keys:
                return {
                    "error": "没有成功更新任何元素",
                    "failed": failed_keys
                }
            
            # 更新context_data
            user_context_service = get_user_context_service()
            updated_context = user_context_service.update(
                context_id=context_id,
                context_name=context.context_name,
                context_description=context.context_description,
                context_data=context_data,
                metadata=context.metadata
            )
            
            if not updated_context:
                return {
                    "error": "更新知识库失败"
                }
            
            return {
                "message": "元素更新成功",
                "updated_keys": updated_keys,
                "failed": failed_keys if failed_keys else None,
                "total_updated": len(updated_keys),
                "total_failed": len(failed_keys)
            }
        except Exception as e:
            log_error(f"Error updating elements: {e}")
            return {
                "error": f"更新元素失败: {str(e)}"
            }
    
    # 同时设置 docstring 作为备用
    update_element.__doc__ = dynamic_description
    return update_element

def _create_delete_element_tool(mcp_instance: FastMCP):
    """创建 delete_element 工具"""
    # 先获取动态描述
    dynamic_description = _get_dynamic_tool_description("delete")
    
    @mcp_instance.tool(name="delete_element", description=dynamic_description)
    async def delete_element(keys: List[str], ctx: Context) -> dict:
        try:
            global _context_info
            context_id = _context_info.get("context_id")
            context = _context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_id
                }
            
            # 获取当前context_data
            context_data = context.context_data.copy() if context.context_data else {}
            
            # 验证并删除元素
            deleted_keys = []
            not_found_keys = []
            
            for key in keys:
                if not isinstance(key, str):
                    not_found_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if key not in context_data:
                    not_found_keys.append({"key": key, "reason": "key不存在于知识库中"})
                    continue
                
                # 删除键值对
                del context_data[key]
                deleted_keys.append(key)
            
            if not deleted_keys:
                return {
                    "error": "没有成功删除任何元素",
                    "not_found": not_found_keys
                }
            
            # 更新context_data
            user_context_service = get_user_context_service()
            updated_context = user_context_service.update(
                context_id=context_id,
                context_name=context.context_name,
                context_description=context.context_description,
                context_data=context_data,
                metadata=context.metadata
            )
            
            if not updated_context:
                return {
                    "error": "更新知识库失败"
                }
            
            return {
                "message": "元素删除成功",
                "deleted_keys": deleted_keys,
                "not_found": not_found_keys if not_found_keys else None,
                "total_deleted": len(deleted_keys),
                "total_not_found": len(not_found_keys)
            }
        except Exception as e:
            log_error(f"Error deleting elements: {e}")
            return {
                "error": f"删除元素失败: {str(e)}"
            }
    
    # 同时设置 docstring 作为备用
    delete_element.__doc__ = dynamic_description
    return delete_element

def _create_vector_retrieve_tool(mcp_instance: FastMCP):
    """创建 vector_retrieve 工具"""
    @mcp_instance.tool()
    async def vector_retrieve(query: str, ctx: Context, top_k: int = 5) -> dict:
        """
        向量检索
        
        Args:
            query: 查询文本（模型可见的参数）
            top_k: 返回结果数量（模型可见的参数）
        """
        global _context_info
        user_id = _context_info.get("user_id")
        project_id = _context_info.get("project_id")
        context_id = _context_info.get("context_id")
        
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

def _register_all_tools(mcp_instance: FastMCP):
    """
    注册所有工具到 MCP 实例
    
    Args:
        mcp_instance: FastMCP 实例
    """
    # 注册上下文管理工具
    _create_get_context_tool(mcp_instance)
    _create_create_element_tool(mcp_instance)
    _create_update_element_tool(mcp_instance)
    _create_delete_element_tool(mcp_instance)
    
    # 注册向量检索工具
    _create_vector_retrieve_tool(mcp_instance)
    
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
    _get_tools()

    # 3. 创建 MCP 实例（在 context 初始化之后）
    mcp = FastMCP(
        name="ContextBase MCP Server",
        version="1.0.0",
    )
    
    # 4. 注册所有工具（此时 context 信息已准备好，可以生成动态描述）
    _register_all_tools(mcp)
    
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

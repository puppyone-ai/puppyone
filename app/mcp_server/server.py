"""
ContextBase MCP Server - FastMCP 2.13版本实现
"""

import sys
import argparse

from fastmcp import FastMCP, Context
from app.utils.logger import log_info, log_error
# from app.mcp_server.middleware.auth_middleware import JwtTokenAuthMiddleware
# from app.mcp_server.middleware.http_auth_middleware import HttpJwtTokenAuthMiddleware
from app.core.dependencies import get_mcp_instance_service, get_user_context_service
# from starlette.middleware import Middleware as StarletteMiddleware
from typing import List, Dict, Any

# 工具
from app.mcp_server.tools.context_tool import ContextTool, tool_types
from app.mcp_server.tools.llm_tool import LLMTool
from app.mcp_server.tools.vector_tool import VectorRetriveTool

# 创建MCP服务器
mcp = FastMCP(
    name="ContextBase MCP Server",
    version="1.0.0",
)

# 注册 MCP 层面的中间件
# 注意：中间件的执行顺序很重要
# 1. 认证中间件：验证身份并注入业务参数（user_id, project_id, context_id）
# 2. 动态工具描述中间件：根据 context 信息动态更新工具描述
# mcp.add_middleware(JwtTokenAuthMiddleware())

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

# ==================== Context数据管理工具 ====================

def _get_context_info(ctx: Context) -> Dict[str, Any]:
    """
    获取context信息
    
    Returns:
        context_info: context信息字典
    """
    # 从 Context state 中获取业务参数
    user_id = ctx.get_state("user_id")
    project_id = ctx.get_state("project_id")
    context_id = ctx.get_state("context_id")
    
    # 获取context信息
    user_context_service = get_user_context_service()
    context = user_context_service.get_by_id(context_id) if context_id else None
    
    return {
        "user_id": user_id,
        "project_id": project_id,
        "context_id": context_id,
        "context": context
    }

# 初始化工具实例以便生成描述
_get_tools()

@mcp.tool(
    name="get_context",
)
async def get_context(ctx: Context) -> dict:
    """
    获取整个知识库的完整内容（整个JSON对象）。
    
    此工具会自动从 Context state 中获取业务参数（user_id, project_id, context_id 等）
    这些参数是通过 JWT token 认证中间件自动注入的，对模型不可见。
    
    返回值：
    - 返回完整的JSON对象，包含知识库中所有的键值对（key-value pairs）
    - 如果知识库为空，将返回空的JSON对象 {}
    """
    try:
        context_info = _get_context_info(ctx)
        context = context_info.get("context")
        
        if not context:
            return {
                "error": "知识库不存在",
                "context_id": context_info.get("context_id")
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

@mcp.tool(
    name="create_element",
)
async def create_element(elements: List[Dict[str, Any]], ctx: Context) -> dict:
    """
    在知识库中批量创建新的键值对（key-value pairs）。
    
    参数说明：
    - elements (List[Dict]): 要创建的元素数组，每个元素是一个字典，包含：
      - key (str): 字符串类型，新数据项的键名。必须是唯一的，如果已存在则创建失败
      - content (dict): 字典类型，新数据项的值内容，可以是任意JSON对象结构
    
    注意事项：
    - 必须先使用 get_context 工具获取当前知识库内容，了解现有数据结构
    - key必须是字符串类型，且在当前知识库中唯一
    - 如果key已存在，创建操作将失败
    - 支持批量创建，可以一次创建多个键值对
    """
    try:
        context_info = _get_context_info(ctx)
        context_id = context_info.get("context_id")
        context = context_info.get("context")
        
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
            
            key = element.get("key")
            content = element.get("content")
            
            if not isinstance(key, str):
                failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                continue
            
            if key in context_data:
                failed_keys.append({"key": key, "reason": "key已存在"})
                continue
            
            if not isinstance(content, dict):
                failed_keys.append({"key": key, "reason": "content必须是字典类型"})
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

@mcp.tool(
    name="update_element",
)
async def update_element(updates: List[Dict[str, Any]], ctx: Context) -> dict:
    """
    批量更新知识库中已存在的键值对。
    
    参数说明：
    - updates (List[Dict]): 要更新的元素数组，每个元素是一个字典，包含：
      - key (str): 字符串类型，要更新的数据项的键名。必须已存在于知识库中
      - value (Any): 任意JSON类型，新的值内容，将完全替换原有的value
    
    注意事项：
    - 必须先使用 get_context 工具获取当前知识库内容，确认要更新的key是否存在
    - key必须已存在于知识库中，如果不存在则更新失败
    - value将完全替换原有的值，不是部分更新
    - 支持批量更新，可以一次更新多个键值对
    """
    try:
        context_info = _get_context_info(ctx)
        context_id = context_info.get("context_id")
        context = context_info.get("context")
        
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
            
            key = update_item.get("key")
            value = update_item.get("value")
            
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

@mcp.tool(
    name="delete_element",
)
async def delete_element(keys: List[str], ctx: Context) -> dict:
    """
    从知识库中批量删除指定的键值对。
    
    参数说明：
    - keys (List[str]): 字符串数组，包含要删除的所有key（键名）
    
    注意事项：
    - 必须先使用 get_context 工具获取当前知识库内容，确认要删除的key是否存在
    - keys数组中的每个key必须是字符串类型
    - 如果某个key不存在，该key的删除操作将被忽略，其他key的删除操作仍会执行
    - 支持批量删除，可以一次删除多个键值对
    - 删除操作是不可逆的，请谨慎使用
    """
    try:
        context_info = _get_context_info(ctx)
        context_id = context_info.get("context_id")
        context = context_info.get("context")
        
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

# ==================== Context数据检索工具 ====================

@mcp.tool()
async def vector_retrieve(query: str, ctx: Context, top_k: int = 5) -> dict:
    """
    向量检索
    
    Args:
        query: 查询文本（模型可见的参数）
        top_k: 返回结果数量（模型可见的参数）
    """
    # 获取业务参数
    user_id = ctx.get_state("user_id")
    project_id = ctx.get_state("project_id")
    context_id = ctx.get_state("context_id")
    
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

@mcp.tool()
async def llm_retrieve(query: str, ctx: Context) -> dict:
    """
    LLM 检索
    
    Args:
        query: 查询文本（模型可见的参数）
    """
    # 获取业务参数
    user_id = ctx.get_state("user_id")
    project_id = ctx.get_state("project_id")
    
    # TODO: 实际的 LLM 检索逻辑
    
    return {
        "message": "LLM 检索完成",
        "query": query,
        "user_id": user_id,
        "project_id": project_id,
        "result": "",  # TODO: 实际的检索结果
    }

# ==================== HTTP App 创建 ====================

# def get_mcp_http_app(path: str = "/"):
#     """
#     创建 MCP 服务器的 HTTP ASGI 应用，用于挂载到 FastAPI
    
#     Args:
#         path: MCP 服务器的内部路径，默认为 "/"（相对于挂载点）
#               当挂载到 "/mcp" 时，实际访问路径为 "/mcp/"
        
#     Returns:
#         ASGI 应用实例，可以挂载到 FastAPI
#     """
#     # 初始化工具实例
#     _get_tools()
    
#     # 创建 HTTP ASGI 应用，添加 Starlette 中间件
#     # HTTP 层面的认证中间件会在 Starlette 层面运行，可以访问完整的 HTTP 请求和响应
#     # 注意：path 参数是 MCP 应用内部的路径，不是挂载路径
#     # 当挂载到 "/mcp" 时，使用 "/" 作为内部路径，这样实际访问路径为 "/mcp/"
#     # StarletteMiddleware 支持通过关键字参数传递额外的依赖给中间件类
#     mcp_app = mcp.http_app(
#         path=path,
#         middleware=[
#             StarletteMiddleware(
#                 HttpJwtTokenAuthMiddleware,
#                 mcp_token_service=get_mcp_token_service()
#             )
#         ]
#     )
    
#     log_info(f"MCP HTTP app created with internal path: {path}")
    
#     return mcp_app


# ==================== 启动入口 ====================
def run_mcp_server(
    transport: str = "http",
    host: str = "0.0.0.0",
    port: int = 9090,
):
    """
    独立启动MCP服务器（用于独立运行模式）

    Args:
        transport: 传输协议，支持"http"和"stdio"
        host: 主机地址
        port: 端口号
    """

    # 初始化工具实例
    _get_tools()

    # 打印启动信息
    log_info(f"ContextBase MCP Server - FastMCP 2.13")
    log_info(f"传输模式: {transport.upper()}")
    if transport == 'stdio':
        log_info("  协议: MCP over stdio (标准输入输出)")
        log_info("  说明: 通过标准输入输出与 MCP 客户端通信")
    elif transport == 'http':
        log_info(f"  监听地址: http://{host}:{port}")
        log_info(f"  HTTP端点: http://{host}:{port}/mcp")
        log_info("  协议: MCP over HTTP (生产环境)")
    
    # 启动服务器
    if transport == 'stdio':
        mcp.run(transport=transport)
    elif transport == 'http':
        mcp.run(transport=transport, host=host, port=port, path="/mcp")
    else:
        raise ValueError(f"Unsupported transport: {transport}")
    

if __name__ == "__main__":
    # 支持通过命令行参数传递host和port
    parser = argparse.ArgumentParser(description="启动ContextBase MCP Server")
    parser.add_argument('--host', type=str, default="0.0.0.0", help='监听主机，默认0.0.0.0')
    parser.add_argument('--port', type=int, default=9090, help='监听端口，默认9090')
    parser.add_argument('--transport', type=str, default="http", choices=["http", "stdio"], help="传输协议（http 或 stdio），默认http")
    args = parser.parse_args()

    run_mcp_server(
        transport=args.transport,
        host=args.host,
        port=args.port,
    )

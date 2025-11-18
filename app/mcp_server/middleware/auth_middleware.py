# """
# JWT Token 认证中间件（简化版）
# 用于从 HTTP 请求的 state 中获取已验证的业务参数，并存储到 Context state 中

# 注意：
# - HTTP 层面的验证由 HttpJwtTokenAuthMiddleware 处理
# - 此中间件只负责传递业务参数，不再进行重复验证
# """

# from fastmcp.server.middleware import Middleware, MiddlewareContext
# from fastmcp.server.dependencies import get_http_request
# from fastmcp.exceptions import McpError
# from mcp.types import ErrorData
# from typing import Dict, Any
# from app.mcp_server.middleware.http_auth_middleware import get_session_params
# from app.utils.logger import log_error, log_info, log_warning


# class JwtTokenAuthMiddleware(Middleware):
#     """
#     JWT Token 认证中间件（MCP 中间件 - 简化版）
    
#     功能：
#     1. 从 session 存储或 HTTP request.state 中获取业务参数（由 HTTP 中间件验证并设置）
#     2. 将业务参数存储到 Context state 中，供工具函数使用
    
#     注意：
#     - HTTP 层面的验证由 HttpJwtTokenAuthMiddleware 处理，验证失败会直接返回 401
#     - 此中间件只负责传递业务参数，不再进行重复验证
#     - 使用 session 级别的存储，因为 Context state 只在单个请求内有效
#     """
    
#     def __init__(self):
#         """
#         初始化认证中间件（不再需要 token_service，因为不再进行验证）
#         """
#         pass
    
#     async def _set_business_params(self, context: MiddlewareContext) -> bool:
#         """
#         从 HTTP request.state 或 session 存储中获取业务参数，并设置到 Context state
        
#         优先级：
#         1. 优先从 HTTP request.state 获取（同一 HTTP 连接内的所有请求都应该能访问）
#         2. 如果 request.state 不可用，从 session 存储获取（备用方案）
        
#         Returns:
#             是否成功设置业务参数
#         """
#         if context.fastmcp_context is None:
#             return False
        
#         business_params = None
        
#         # 1. 优先从 HTTP request.state 中获取（同一 HTTP 连接内的所有请求都应该能访问）
#         try:
#             http_request = get_http_request()
#             if hasattr(http_request.state, "business_params"):
#                 business_params = http_request.state.business_params
#                 log_info(f"Found business params in HTTP request state (method: {context.method})")
#         except RuntimeError:
#             # 如果没有活动的 HTTP 请求（可能是 stdio 模式），这是正常的
#             pass
#         except Exception as e:
#             log_error(f"Error getting HTTP request state: {e}")
        
#         # 2. 如果 request.state 不可用，尝试从 session 存储获取（备用方案）
#         # 这主要用于处理某些特殊情况，比如 request.state 在某些阶段不可用
#         if not business_params:
#             try:
#                 session_id = context.fastmcp_context.session_id
#                 if session_id:
#                     business_params = get_session_params(session_id)
#                     if business_params:
#                         log_info(f"Found business params in session store: session_id={session_id} (method: {context.method})")
#             except Exception:
#                 # session_id 可能在某些情况下不可用，这是正常的
#                 pass
        
#         # 3. 设置到 Context state
#         if business_params:
#             try:
#                 for key, value in business_params.items():
#                     context.fastmcp_context.set_state(key, value)
#                 log_info(f"Set business params to Context state: user_id={business_params.get('user_id')}, method={context.method}")
#                 return True
#             except Exception as e:
#                 log_error(f"Could not set state: {e}")
#                 return False
        
#         # 如果没有找到业务参数，说明 HTTP 中间件验证失败或没有提供 token
#         # 但 HTTP 中间件应该已经拒绝了请求，所以这里不应该到达
#         log_warning(f"No business params found (method: {context.method})")
#         return False
    
#     # async def on_initialize(self, context: MiddlewareContext, call_next):
#     #     """
#     #     在客户端初始化时传递业务参数
        
#     #     注意：HTTP 中间件已经验证了 token，这里只需要传递业务参数
#     #     """
#     #     if context.fastmcp_context is None:
#     #         return await call_next(context)
        
#     #     # 尝试获取业务参数并设置到 Context state
#     #     await self._set_business_params(context)
        
#     #     return await call_next(context)
    
#     async def on_request(self, context: MiddlewareContext, call_next):
#         """
#         拦截所有 MCP 请求，传递业务参数到 Context state
        
#         注意：
#         - HTTP 中间件已经验证了 token，验证失败会直接返回 401
#         - 此方法只负责传递业务参数，不再进行验证
#         """
#         # 只在 HTTP 传输模式下处理
#         # stdio 模式下没有 HTTP 请求，可以跳过
#         if context.fastmcp_context is None:
#             return await call_next(context)
        
#         # 设置业务参数到 Context state
#         success = await self._set_business_params(context)
        
#         # 如果无法获取业务参数，说明可能有问题（但 HTTP 中间件应该已经处理了）
#         # 为了安全起见，仍然抛出错误
#         if not success:
#             # 检查是否是 stdio 模式（没有 HTTP 请求）
#             try:
#                 get_http_request()
#                 log_info("HTTP request found")
#             except RuntimeError as e:
#                 # stdio 模式，允许通过（可能需要其他认证方式）
#                 log_info(f"Stdio mode detected, skipping authentication: {e}")
#                 return await call_next(context)
            
#             # HTTP 模式但没有业务参数，这不应该发生（HTTP 中间件应该已经拒绝）
#             # 但为了安全，仍然抛出错误
#             log_error(f"Business params not found in HTTP mode (method: {context.method})")
#             raise McpError(
#                 ErrorData(
#                     code=-32001,
#                     message="Authentication required. Please provide a valid JWT token."
#                 )
#             )
        
#         # 继续处理请求
#         return await call_next(context)
    
#     async def on_call_tool(self, context: MiddlewareContext, call_next):
#         """
#         在工具调用时检查业务参数是否已设置
        
#         注意：HTTP 中间件已经验证了 token，这里只做检查
#         """
#         if context.fastmcp_context:
#             user_id = context.fastmcp_context.get_state("user_id")
#             if user_id is None:
#                 # 如果没有业务参数，说明可能有问题（但 HTTP 中间件应该已经处理了）
#                 log_error("Business params not found in tool call")
#                 raise McpError(
#                     ErrorData(
#                         code=-32003,
#                         message="Authentication required. Please provide a valid JWT token."
#                     )
#                 )
        
#         return await call_next(context)

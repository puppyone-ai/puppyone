"""
HTTP 层面的 JWT Token 认证中间件（Starlette 中间件）
用于在 HTTP 请求层面拦截请求，提取 token 查询参数，并保存到 session 存储中

这个中间件在 MCP 中间件之前运行，可以访问完整的 HTTP 请求上下文
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from typing import Callable, Dict, Any, Optional
from app.service.mcp_token_service import McpTokenService
from app.utils.logger import log_info, log_error


# 全局 session 存储（在模块级别，这样可以被多个实例共享）
_session_store: Dict[str, Dict[str, Any]] = {}


class HttpJwtTokenAuthMiddleware(BaseHTTPMiddleware):
    """
    HTTP 层面的 JWT Token 认证中间件（Starlette 中间件）
    
    功能：
    1. 拦截所有到 MCP 路径的 HTTP 请求
    2. 从查询参数中提取 token
    3. 验证 token 并解析出业务参数（user_id, project_id, ctx_id）
    4. 将业务参数保存到 request.state 中，供后续使用
    
    注意：这个中间件在 MCP 中间件之前运行，可以访问完整的 HTTP 请求上下文
    """
    
    def __init__(self, app, mcp_token_service: Optional[McpTokenService] = None):
        super().__init__(app)
        self.mcp_token_service = mcp_token_service
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        拦截/mcp路径上的 HTTP 请求，提取并验证 JWT token
        验证失败直接返回 401 错误，拒绝访问
        """
        # 只处理 MCP 路径的请求
        if request.url.path.startswith("/mcp"):
            # 从查询参数中提取 token（支持 token 和 api_key 两种参数名，向后兼容）
            token = request.query_params.get("token") or request.query_params.get("api_key")
            
            if not token:
                log_error("No token found in query parameters")
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": "JWT token is required",
                        "message": "Please provide token as a query parameter (token or api_key)"
                    }
                )
            
            log_info(f"Found token in query parameters: {token[:20]}...")
            
            # 验证 token 并获取业务参数
            business_params = await self._validate_and_get_params(token)
            
            if not business_params:
                log_error(f"Invalid token: {token[:20]}...")
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": "Invalid or expired JWT token",
                        "message": "The provided token is invalid, expired, or revoked"
                    }
                )
            
            # 将业务参数保存到 request.state 中，供后续使用
            request.state.business_params = business_params
            request.state.token_validated = True
        
        # 继续处理请求
        response = await call_next(request)
        
        # 在响应阶段，尝试从响应头中获取 session_id
        # StreamableHTTP 会在响应头中返回 mcp-session-id
        session_id = response.headers.get("mcp-session-id")
        if session_id and hasattr(request.state, "business_params"):
            # 将业务参数保存到全局 session 存储中，供后续请求使用
            _session_store[session_id] = request.state.business_params.copy()
            log_info(f"Saved business params to session store: session_id={session_id}")
        
        return response
    
    async def _validate_and_get_params(self, token: str) -> Optional[Dict[str, Any]]:
        """
        验证 JWT token 并返回业务参数
        
        Args:
            token: JWT token 字符串
            
        Returns:
            如果 token 合法，返回包含业务参数的字典，否则返回 None
            返回的字典包含：
            - user_id: 用户 ID
            - project_id: 项目 ID
            - ctx_id: 上下文 ID（context_id）
        """
        if not self.mcp_token_service:
            # 如果没有注入 service，尝试从依赖获取
            from app.core.dependencies import get_mcp_token_service
            self.mcp_token_service = get_mcp_token_service()
        
        try:
            # 检查 token 是否有效
            is_valid, status_message = self.mcp_token_service.is_token_valid(token)
            
            if not is_valid:
                log_error(f"Token validation failed: {status_message}")
                return None
            
            # 解码 token 获取业务参数
            payload = self.mcp_token_service.decode_mcp_token(token)
            
            # 构建业务参数字典
            business_params = {
                "user_id": payload.user_id,
                "project_id": payload.project_id,
                "context_id": payload.ctx_id,  # 注意：schema 中是 ctx_id，但工具中使用 context_id
                "ctx_id": payload.ctx_id,  # 同时保留 ctx_id 以保持兼容性
            }
            
            log_info(f"Token validated successfully for user_id: {payload.user_id}, project_id: {payload.project_id}, ctx_id: {payload.ctx_id}")
            
            return business_params
            
        except Exception as e:
            log_error(f"Error validating token: {e}")
            return None


def get_session_params(session_id: str) -> Dict[str, Any] | None:
    """
    从全局 session 存储中获取业务参数
    
    Args:
        session_id: Session ID
        
    Returns:
        业务参数字典，如果不存在则返回 None
    """
    return _session_store.get(session_id)


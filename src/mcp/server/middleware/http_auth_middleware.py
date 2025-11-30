"""
HTTP 层面的 JWT Token 认证中间件（Starlette 中间件）
用于在 HTTP 请求层面拦截请求，提取 token 查询参数，并保存到 session 存储中

这个中间件在 MCP 中间件之前运行，可以访问完整的 HTTP 请求上下文
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from typing import Callable, Dict, Any, Optional
from src.mcp_service import McpService
from src.utils.logger import log_info, log_error


# 基于内存实现的简单token - 业务参数缓存
_token_cache: Dict[str, Dict[str, Any]] = {}


def get_token_cache(token: str) -> Dict[str, Any] | None:
    """
    从全局 token 缓存中获取业务参数

    Args:
        token: Token

    Returns:
        业务参数字典，如果不存在则返回 None
    """
    return _token_cache.get(token)


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

    def __init__(self, app, mcp_service: Optional[McpService] = None):
        super().__init__(app)
        self.mcp_service = mcp_service

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        拦截/mcp路径上的 HTTP 请求，提取并验证 JWT token
        验证失败直接返回 401 错误，拒绝访问
        """
        if request.url.path.startswith("/mcp"):  # 只处理 MCP 路径的请求
            # 从查询参数中提取 token（支持 token 和 api_key 两种参数名，向后兼容）
            token = request.query_params.get("token") or request.query_params.get(
                "api_key"
            )

            if not token:
                log_error("No token found in query parameters")
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": "JWT token is required",
                        "message": "Please provide token as a query parameter (token or api_key)",
                    },
                )

            log_info(f"Found token in query parameters: {token[:20]}...")

            # 验证 token 并获取业务参数
            business_params = await self._validate_and_get_params(token, request)

            if not business_params:
                log_error(f"Invalid token: {token[:20]}...")
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": "Invalid token",
                        "message": "The provided token is invalid.",
                    },
                )

            _token_cache[token] = business_params.copy()
            log_info(f"Saved business params to token cache: token={token}")

        # 继续处理请求
        response = await call_next(request)

        return response

    async def _validate_and_get_params(
        self, token: str, request: Request
    ) -> Optional[Dict[str, Any]]:
        """
        验证 JWT token 并返回业务参数

        流程：
        1. 解码 token，判断 token 是否合法，如果不合法就拒绝访问
        2. 根据解码 token 的数据，去 repository 里面查询这个 api_key 对应的实例，
           检查 port 是否与当前请求的 port 相等，如果不相等就拒绝访问
        3. 如果验证都没问题，将解码后的 business_params 返回

        Args:
            token: JWT token 字符串（同时也是 api_key）
            request: HTTP 请求对象，用于获取当前请求的端口

        Returns:
            如果 token 合法且 port 匹配，返回包含业务参数的字典，否则返回 None
            返回的字典包含：
            - user_id: 用户 ID
            - project_id: 项目 ID
            - context_id: 上下文 ID
            - ctx_id: 上下文 ID（兼容性字段）
        """
        if not self.mcp_service:
            # 如果没有注入 service，尝试从依赖获取
            from src.mcp.dependencies import get_mcp_instance_service

            self.mcp_service = get_mcp_instance_service()

        try:
            # 1. 解码 token，判断 token 是否合法
            try:
                payload = self.mcp_service.decode_mcp_token(token)
            except ValueError as e:
                log_error(f"Token decode failed: {e}")
                return None

            # 2. 根据 api_key (token) 查询 repository 中的实例
            instance = await self.mcp_service.get_mcp_instance_by_api_key(token)
            if not instance:
                log_error(f"MCP instance not found for api_key: {token[:20]}...")
                return None

            # 获取当前请求的端口
            request_port = request.url.port
            if request_port is None:
                # 如果端口为 None，可能是默认端口（HTTP 80 或 HTTPS 443）
                # 根据 scheme 判断
                if request.url.scheme == "https":
                    request_port = 443
                else:
                    request_port = 80

            # 检查实例的 port 是否与当前请求的 port 相等
            if instance.port != request_port:
                log_error(
                    f"Port mismatch: instance port={instance.port}, request port={request_port}, api_key={token[:20]}..."
                )
                return None

            # 3. 如果验证都没问题，构建并返回 business_params
            business_params = {
                "user_id": payload.user_id,
                "project_id": payload.project_id,
                "context_id": payload.context_id,
                "ctx_id": payload.context_id,  # 同时保留 ctx_id 以保持兼容性
            }

            log_info(
                f"Token validated successfully for user_id: {payload.user_id}, project_id: {payload.project_id}, context_id: {payload.context_id}, port: {request_port}"
            )

            return business_params

        except Exception as e:
            log_error(f"Error validating token: {e}")
            return None

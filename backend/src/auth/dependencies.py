"""
认证相关的依赖注入
"""

from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from src.auth.service import AuthService
from src.auth.models import CurrentUser
from src.supabase.dependencies import get_supabase_client
from src.exceptions import AuthException
from src.config import settings
from src.utils.logger import log_warning

# 定义 HTTPBearer 安全方案
security = HTTPBearer(auto_error=False)


# 使用全局变量存储单例，而不是 lru_cache
# 这样可以避免 reload 时的缓存问题
_auth_service = None


def get_auth_service() -> AuthService:
    """
    获取认证服务实例

    Returns:
        AuthService: 认证服务实例
    """
    global _auth_service
    if _auth_service is None:
        supabase_client = get_supabase_client()
        _auth_service = AuthService(supabase_client)
    return _auth_service


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> CurrentUser:
    """
    从请求头中提取并验证 JWT token，返回当前用户信息

    这是一个 FastAPI 依赖函数，用于需要认证的路由中。

    如果配置了 SKIP_AUTH=True，将跳过鉴权并返回一个模拟的测试用户。

    Args:
        credentials: HTTP Bearer 认证凭证
        auth_service: 认证服务实例

    Returns:
        CurrentUser: 当前认证的用户信息

    Raises:
        HTTPException: 认证失败时抛出 401 错误（仅在 SKIP_AUTH=False 时）
    """
    # 如果启用了跳过鉴权配置，返回模拟的测试用户
    if settings.SKIP_AUTH:
        log_warning("SKIP_AUTH is enabled - returning mock test user")
        return CurrentUser(
            user_id="c389d596-e7c1-4fd7-900b-f760a0f1c89f",
            email="cagurzhan@gmail.com",
            phone=None,
            role="authenticated",
            is_anonymous=False,
            app_metadata={},
            user_metadata={},
        )

    # 检查是否提供了认证凭证
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="缺少 Authorization 请求头",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        # 验证 token 并获取用户信息
        auth_service = get_auth_service()
        current_user = auth_service.get_current_user(token)
        return current_user
    except AuthException as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"认证失败: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[CurrentUser]:
    """
    可选的用户认证依赖，如果没有提供 token 则返回 None

    这个依赖适用于既可以公开访问，又可以提供用户专属功能的接口。

    如果配置了 SKIP_AUTH=True，将始终返回模拟的测试用户。

    Args:
        credentials: HTTP Bearer 认证凭证
        auth_service: 认证服务实例

    Returns:
        Optional[CurrentUser]: 当前用户信息，如果未认证则返回 None（SKIP_AUTH=False 时）
    """
    # 如果启用了跳过鉴权配置，返回模拟的测试用户
    if settings.SKIP_AUTH:
        log_warning("SKIP_AUTH is enabled - returning mock test user")
        return CurrentUser(
            user_id="c389d596-e7c1-4fd7-900b-f760a0f1c89f",
            email="cagurzhan@gmail.com",
            phone=None,
            role="authenticated",
            is_anonymous=False,
            app_metadata={},
            user_metadata={},
        )

    # 如果没有提供认证凭证，返回 None
    if not credentials:
        return None

    token = credentials.credentials

    try:
        auth_service = get_auth_service()
        current_user = auth_service.get_current_user(token)
        return current_user
    except Exception:
        # 对于可选认证，验证失败时返回 None 而不是抛出异常
        return None

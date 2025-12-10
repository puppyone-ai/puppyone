"""
认证相关的依赖注入
"""

from typing import Optional
from fastapi import Depends, HTTPException, Header
from src.auth.service import AuthService
from src.auth.models import CurrentUser
from src.supabase.client import SupabaseClient
from src.exceptions import AuthException
from src.config import settings
from src.utils.logger import log_warning


def get_auth_service() -> AuthService:
    """
    获取认证服务实例

    Returns:
        AuthService: 认证服务实例
    """
    supabase_client = SupabaseClient().get_client()
    return AuthService(supabase_client)


def get_current_user(
    authorization: Optional[str] = Header(None, description="Bearer token"),
    auth_service: AuthService = Depends(get_auth_service),
) -> CurrentUser:
    """
    从请求头中提取并验证 JWT token，返回当前用户信息

    这是一个 FastAPI 依赖函数，用于需要认证的路由中。

    如果配置了 SKIP_AUTH=True，将跳过鉴权并返回一个模拟的测试用户。

    Args:
        authorization: Authorization 请求头，格式为 "Bearer <token>"
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
            user_id="test-user-id",
            email="test@example.com",
            phone=None,
            role="authenticated",
            is_anonymous=False,
            app_metadata={},
            user_metadata={},
        )

    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="缺少 Authorization 请求头",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 提取 Bearer token
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Authorization 请求头格式错误，应为 'Bearer <token>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1]

    try:
        # 验证 token 并获取用户信息
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
    authorization: Optional[str] = Header(None, description="Bearer token"),
    auth_service: AuthService = Depends(get_auth_service),
) -> Optional[CurrentUser]:
    """
    可选的用户认证依赖，如果没有提供 token 则返回 None

    这个依赖适用于既可以公开访问，又可以提供用户专属功能的接口。

    如果配置了 SKIP_AUTH=True，将始终返回模拟的测试用户。

    Args:
        authorization: Authorization 请求头，格式为 "Bearer <token>"
        auth_service: 认证服务实例

    Returns:
        Optional[CurrentUser]: 当前用户信息，如果未认证则返回 None（SKIP_AUTH=False 时）
    """
    # 如果启用了跳过鉴权配置，返回模拟的测试用户
    if settings.SKIP_AUTH:
        log_warning("SKIP_AUTH is enabled - returning mock test user")
        return CurrentUser(
            user_id="test-user-id",
            email="test@example.com",
            phone=None,
            role="authenticated",
            is_anonymous=False,
            app_metadata={},
            user_metadata={},
        )

    if not authorization:
        return None

    # 提取 Bearer token
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    token = parts[1]

    try:
        current_user = auth_service.get_current_user(token)
        return current_user
    except Exception:
        # 对于可选认证，验证失败时返回 None 而不是抛出异常
        return None

"""
认证服务
负责 JWT token 的验证和用户信息提取
"""

import time
from typing import Optional
from supabase import Client
from src.auth.models import TokenClaims, CurrentUser
from src.exceptions import AuthException, ErrorCode
from src.utils.logger import log_error, log_debug


class AuthService:
    """认证服务类"""

    def __init__(self, supabase_client: Client):
        """
        初始化认证服务

        Args:
            supabase_client: Supabase 客户端实例
        """
        self.supabase = supabase_client

    def verify_token(self, token: str) -> TokenClaims:
        """
        验证 JWT token 并返回 claims

        Args:
            token: JWT token 字符串

        Returns:
            TokenClaims: token 中的 claims 信息

        Raises:
            AuthException: token 无效或验证失败
        """
        try:
            # 调用 Supabase auth API 验证 token
            response = self.supabase.auth.get_claims(jwt=token)

            if not response:
                log_error("Failed to get claims from token")
                raise AuthException(
                    message="Token 验证失败",
                    code=ErrorCode.INVALID_TOKEN,
                )

            claims_dict = response.get("claims")
            if not claims_dict:
                log_error("No claims found in token response")
                raise AuthException(
                    message="Token 无效：缺少 claims",
                    code=ErrorCode.INVALID_TOKEN,
                )

            # 解析 claims
            try:
                claims = TokenClaims(**claims_dict)
            except Exception as e:
                log_error(f"Failed to parse claims: {e}")
                raise AuthException(
                    message=f"Token 格式错误: {str(e)}",
                    code=ErrorCode.INVALID_TOKEN,
                )

            # 检查 token 是否过期
            if self._is_token_expired(claims):
                log_debug(f"Token expired for user {claims.user_id}")
                raise AuthException(
                    message="Token 已过期",
                    code=ErrorCode.TOKEN_EXPIRED,
                )

            # 检查受众
            if claims.aud not in ["authenticated", "anon"]:
                log_error(f"Invalid audience: {claims.aud}")
                raise AuthException(
                    message="Token 受众无效",
                    code=ErrorCode.INVALID_TOKEN,
                )

            log_debug(f"Token verified successfully for user {claims.user_id}")
            return claims

        except AuthException:
            # 重新抛出认证异常
            raise
        except Exception as e:
            log_error(f"Unexpected error during token verification: {e}")
            raise AuthException(
                message=f"Token 验证失败: {str(e)}",
                code=ErrorCode.INVALID_TOKEN,
            )

    def get_current_user(self, token: str) -> CurrentUser:
        """
        从 token 获取当前用户信息

        Args:
            token: JWT token 字符串

        Returns:
            CurrentUser: 当前用户信息

        Raises:
            AuthException: token 无效或验证失败
        """
        claims = self.verify_token(token)
        return CurrentUser.from_claims(claims)

    @staticmethod
    def _is_token_expired(claims: TokenClaims) -> bool:
        """
        检查 token 是否过期

        Args:
            claims: token claims

        Returns:
            bool: True 表示已过期
        """
        if not claims.exp:
            return True
        # 添加 5 秒的时间缓冲，避免网络延迟导致的问题
        return time.time() > (claims.exp - 5)

    def verify_user_permission(
        self, user: CurrentUser, required_role: Optional[str] = None
    ) -> bool:
        """
        验证用户权限

        Args:
            user: 当前用户
            required_role: 需要的角色（可选）

        Returns:
            bool: True 表示有权限

        Raises:
            AuthException: 没有权限
        """
        # 检查是否为匿名用户
        if user.is_anonymous:
            raise AuthException(
                message="匿名用户无权访问",
                code=ErrorCode.FORBIDDEN,
            )

        # 检查角色（如果需要）
        if required_role and user.role != required_role:
            raise AuthException(
                message=f"需要角色: {required_role}",
                code=ErrorCode.FORBIDDEN,
            )

        return True
"""
认证服务
负责 JWT token 的验证和用户信息提取

支持两种验证方式：
1. Supabase JWKS 验证（首选，通过 supabase.auth.get_claims）
2. 本地 JWT_SECRET 验证（降级方案，当 JWKS 为空时自动切换）
"""

import time
from typing import Optional
import jwt as pyjwt
from supabase import Client
from src.auth.models import TokenClaims, CurrentUser
from src.config import settings
from src.exceptions import AuthException, ErrorCode
from src.utils.logger import log_error, log_debug, log_info


class AuthService:
    """认证服务类"""

    def __init__(self, supabase_client: Client):
        """
        初始化认证服务

        Args:
            supabase_client: Supabase 客户端实例
        """
        self.supabase = supabase_client

    def _verify_token_local(self, token: str) -> dict:
        """
        使用本地 JWT_SECRET 验证 token（降级方案）

        当 Supabase JWKS 端点返回空时使用此方法。
        适用于 Supabase Branch 实例 JWKS 尚未初始化的场景。

        Args:
            token: JWT token 字符串

        Returns:
            dict: 解码后的 claims

        Raises:
            AuthException: 验证失败
        """
        jwt_secret = settings.JWT_SECRET
        if not jwt_secret or jwt_secret == "ContextBase-256-bit-secret":
            log_error("JWT_SECRET not configured for local token verification")
            raise AuthException(
                message="JWT_SECRET not configured for token verification",
                code=ErrorCode.INVALID_TOKEN,
            )

        try:
            claims = pyjwt.decode(
                token,
                jwt_secret,
                algorithms=[settings.JWT_ALGORITHM],
                audience=["authenticated", "anon"],
                options={"verify_exp": True},
            )
            log_debug("Token verified using local JWT_SECRET fallback")
            return claims
        except pyjwt.ExpiredSignatureError:
            raise AuthException(
                message="Token expired",
                code=ErrorCode.TOKEN_EXPIRED,
            )
        except pyjwt.InvalidTokenError as e:
            log_error(f"Local JWT verification failed: {e}")
            raise AuthException(
                message=f"Token verification failed: {str(e)}",
                code=ErrorCode.INVALID_TOKEN,
            )

    def verify_token(self, token: str) -> TokenClaims:
        """
        验证 JWT token 并返回 claims

        优先使用 Supabase JWKS 验证，当 JWKS 为空时自动降级到本地 JWT_SECRET 验证。

        Args:
            token: JWT token 字符串

        Returns:
            TokenClaims: token 中的 claims 信息

        Raises:
            AuthException: token 无效或验证失败
        """
        claims_dict = None

        try:
            # 方式1: 调用 Supabase auth API 验证 token（JWKS）
            response = self.supabase.auth.get_claims(jwt=token)

            if response:
                claims_dict = response.get("claims")

        except Exception as e:
            error_msg = str(e)
            if "JWKS is empty" in error_msg or "JWKS" in error_msg:
                log_info(f"Supabase JWKS unavailable ({error_msg}), falling back to local JWT_SECRET verification")
            else:
                log_error(f"Unexpected error during JWKS token verification: {e}")

        # 方式2: JWKS 失败或为空时，降级到本地 JWT_SECRET 验证
        if not claims_dict:
            log_debug("JWKS verification returned no claims, trying local JWT_SECRET")
            claims_dict = self._verify_token_local(token)

        # 解析 claims
        try:
            claims = TokenClaims(**claims_dict)
        except Exception as e:
            log_error(f"Failed to parse claims: {e}")
            raise AuthException(
                message=f"Invalid token format: {str(e)}",
                code=ErrorCode.INVALID_TOKEN,
            )

        # 检查 token 是否过期
        if self._is_token_expired(claims):
            log_debug(f"Token expired for user {claims.user_id}")
            raise AuthException(
                message="Token expired",
                code=ErrorCode.TOKEN_EXPIRED,
            )

        if claims.aud not in ["authenticated", "anon"]:
            log_error(f"Invalid audience: {claims.aud}")
            raise AuthException(
                message="Invalid token audience",
                code=ErrorCode.INVALID_TOKEN,
            )

        log_debug(f"Token verified successfully for user {claims.user_id}")
        return claims

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
                message="Anonymous users are not allowed",
                code=ErrorCode.FORBIDDEN,
            )

        # 检查角色（如果需要）
        if required_role and user.role != required_role:
            raise AuthException(
                message=f"Required role: {required_role}",
                code=ErrorCode.FORBIDDEN,
            )

        return True

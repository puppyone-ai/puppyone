"""
Authentication Service
Handles JWT token verification and user information extraction

Supports two verification methods:
1. Supabase JWKS verification (preferred, via supabase.auth.get_claims)
2. Local JWT_SECRET verification (fallback, auto-switches when JWKS is empty)
"""

import time
from typing import Optional
import jwt as pyjwt
from supabase import Client
from src.platform.auth.models import TokenClaims, CurrentUser
from src.config import settings
from src.exceptions import AuthException, ErrorCode
from src.utils.logger import log_error, log_debug, log_info


class AuthService:
    """Authentication service class"""

    def __init__(self, supabase_client: Client):
        """
        Initialize the authentication service

        Args:
            supabase_client: Supabase client instance
        """
        self.supabase = supabase_client

    def _verify_token_local(self, token: str) -> dict:
        """
        Verify token using local JWT_SECRET (fallback method)

        Used when the Supabase JWKS endpoint returns empty.
        Applicable for Supabase Branch instances where JWKS is not yet initialized.

        Args:
            token: JWT token string

        Returns:
            dict: Decoded claims

        Raises:
            AuthException: Verification failed
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
        Verify JWT token and return claims

        Prefers Supabase JWKS verification; automatically falls back to local JWT_SECRET when JWKS is empty.

        Args:
            token: JWT token string

        Returns:
            TokenClaims: Claims information from the token

        Raises:
            AuthException: Token is invalid or verification failed
        """
        claims_dict = None

        try:
            # Method 1: Verify token via Supabase auth API (JWKS)
            response = self.supabase.auth.get_claims(jwt=token)

            if response:
                claims_dict = response.get("claims")

        except Exception as e:
            error_msg = str(e)
            if "JWKS is empty" in error_msg or "JWKS" in error_msg:
                log_info(f"Supabase JWKS unavailable ({error_msg}), falling back to local JWT_SECRET verification")
            else:
                log_error(f"Unexpected error during JWKS token verification: {e}")

        # Method 2: Fall back to local JWT_SECRET verification when JWKS fails or is empty
        if not claims_dict:
            log_debug("JWKS verification returned no claims, trying local JWT_SECRET")
            claims_dict = self._verify_token_local(token)

        # Parse claims
        try:
            claims = TokenClaims(**claims_dict)
        except Exception as e:
            log_error(f"Failed to parse claims: {e}")
            raise AuthException(
                message=f"Invalid token format: {str(e)}",
                code=ErrorCode.INVALID_TOKEN,
            )

        # Check if token is expired
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
        Get current user information from token

        Args:
            token: JWT token string

        Returns:
            CurrentUser: Current user information

        Raises:
            AuthException: Token is invalid or verification failed
        """
        claims = self.verify_token(token)
        return CurrentUser.from_claims(claims)

    @staticmethod
    def _is_token_expired(claims: TokenClaims) -> bool:
        """
        Check if token is expired

        Args:
            claims: token claims

        Returns:
            bool: True means expired
        """
        if not claims.exp:
            return True
        # Add 5-second buffer to avoid issues caused by network latency
        return time.time() > (claims.exp - 5)

    def verify_user_permission(
        self, user: CurrentUser, required_role: Optional[str] = None
    ) -> bool:
        """
        Verify user permissions

        Args:
            user: Current user
            required_role: Required role (optional)

        Returns:
            bool: True means authorized

        Raises:
            AuthException: No permission
        """
        # Check if user is anonymous
        if user.is_anonymous:
            raise AuthException(
                message="Anonymous users are not allowed",
                code=ErrorCode.FORBIDDEN,
            )

        # Check role (if required)
        if required_role and user.role != required_role:
            raise AuthException(
                message=f"Required role: {required_role}",
                code=ErrorCode.FORBIDDEN,
            )

        return True

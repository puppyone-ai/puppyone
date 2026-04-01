"""
Authentication data models
"""

from typing import Any

from pydantic import BaseModel


class AuthMethod(BaseModel):
    """Authentication method"""

    method: str
    timestamp: int


class TokenClaims(BaseModel):
    """JWT Token Claims"""

    # Required fields
    sub: str  # User ID
    aud: str  # Audience
    exp: int  # Expiration time
    iat: int  # Issued at
    iss: str  # Issuer
    role: str  # Role

    # Optional fields
    email: str | None = None
    phone: str | None = None
    session_id: str | None = None
    is_anonymous: bool | None = None
    aal: str | None = None
    amr: list[AuthMethod] | None = None
    app_metadata: dict[str, Any] | None = None
    user_metadata: dict[str, Any] | None = None

    @property
    def user_id(self) -> str:
        """Get user ID (alias for the sub field)"""
        return self.sub


class CurrentUser(BaseModel):
    """Current authenticated user information"""

    user_id: str
    email: str | None = None
    phone: str | None = None
    role: str
    is_anonymous: bool = False
    app_metadata: dict[str, Any] = {}
    user_metadata: dict[str, Any] = {}

    @classmethod
    def from_claims(cls, claims: TokenClaims) -> "CurrentUser":
        """Create CurrentUser from TokenClaims"""
        return cls(
            user_id=claims.user_id,
            email=claims.email,
            phone=claims.phone,
            role=claims.role,
            is_anonymous=claims.is_anonymous or False,
            app_metadata=claims.app_metadata or {},
            user_metadata=claims.user_metadata or {},
        )

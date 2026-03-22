"""
Authentication data models
"""

from pydantic import BaseModel
from typing import Optional, Dict, Any, List


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
    email: Optional[str] = None
    phone: Optional[str] = None
    session_id: Optional[str] = None
    is_anonymous: Optional[bool] = None
    aal: Optional[str] = None
    amr: Optional[List[AuthMethod]] = None
    app_metadata: Optional[Dict[str, Any]] = None
    user_metadata: Optional[Dict[str, Any]] = None

    @property
    def user_id(self) -> str:
        """Get user ID (alias for the sub field)"""
        return self.sub


class CurrentUser(BaseModel):
    """Current authenticated user information"""

    user_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str
    is_anonymous: bool = False
    app_metadata: Dict[str, Any] = {}
    user_metadata: Dict[str, Any] = {}

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

"""
认证相关的数据模型
"""

from pydantic import BaseModel
from typing import Optional, Dict, Any, List


class AuthMethod(BaseModel):
    """认证方法"""

    method: str
    timestamp: int


class TokenClaims(BaseModel):
    """JWT Token Claims"""

    # 必需字段
    sub: str  # 用户ID
    aud: str  # 受众
    exp: int  # 过期时间
    iat: int  # 签发时间
    iss: str  # 签发者
    role: str  # 角色

    # 可选字段
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
        """获取用户ID（sub字段的别名）"""
        return self.sub


class CurrentUser(BaseModel):
    """当前认证用户信息"""

    user_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str
    is_anonymous: bool = False
    app_metadata: Dict[str, Any] = {}
    user_metadata: Dict[str, Any] = {}

    @classmethod
    def from_claims(cls, claims: TokenClaims) -> "CurrentUser":
        """从 TokenClaims 创建 CurrentUser"""
        return cls(
            user_id=claims.user_id,
            email=claims.email,
            phone=claims.phone,
            role=claims.role,
            is_anonymous=claims.is_anonymous or False,
            app_metadata=claims.app_metadata or {},
            user_metadata=claims.user_metadata or {},
        )

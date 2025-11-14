"""
负责mcp token的生成和维护
"""
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from app.core.config import settings
from app.schemas.mcp_token import McpTokenPayload
from app.repositories.base import McpTokenRepositoryBase
from app.models.mcp_token import TokenStatus

class McpTokenService:
    """
    mcp token的生成和维护
    """
    def __init__(self, token_repo: McpTokenRepositoryBase):
        self.token_repo = token_repo

    def generate_mcp_token(self, user_id: int, project_id: int, ctx_id: int) -> str:
        """
        生成mcp token并持久化到文件系统
        """
        payload = {
            "user_id": user_id,
            "project_id": project_id,
            "ctx_id": ctx_id,
            "iat": datetime.now(timezone.utc),
        }
        token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
        
        # 持久化 token 到文件系统
        self.token_repo.create(
            user_id=user_id,
            project_id=project_id,
            ctx_id=ctx_id,
            token=token,
            token_status="active"
        )
        
        return token
    
    def decode_mcp_token(self, token: str) -> McpTokenPayload:
        """
        解码mcp token
        """
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            return McpTokenPayload(**payload)
        except jwt.ExpiredSignatureError:
            raise ValueError("Token has expired")
        except jwt.InvalidTokenError:
            raise ValueError("Invalid token")
        except Exception as e:
            raise ValueError(f"Error decoding token: {e}")
    
    def is_token_valid(self, token: str) -> Tuple[bool, Optional[str]]:
        """
        检查 token 是否有效
        返回: (是否有效, 状态信息)
        """
        # 首先检查 token 是否存在于存储中
        stored_token = self.token_repo.get_by_token(token)
        if not stored_token:
            return False, "Token not found"
        
        # 检查 token 状态
        if stored_token.token_status == "revoked":
            return False, "Token has been revoked"
        
        if stored_token.token_status == "expired":
            return False, "Token has expired"
        
        # 检查 JWT 是否有效（未过期、签名正确等）
        try:
            self.decode_mcp_token(token)
            return True, "Token is valid"
        except ValueError as e:
            # 如果 JWT 无效，更新状态为 expired
            if "expired" in str(e).lower():
                self.token_repo.update_status(token, "expired")
            return False, str(e)
    
    def get_token_status(self, token: str) -> Optional[TokenStatus]:
        """
        获取 token 的状态
        返回: token 状态，如果 token 不存在则返回 None
        """
        stored_token = self.token_repo.get_by_token(token)
        if not stored_token:
            return None
        return stored_token.token_status
    
    def revoke_token(self, token: str) -> bool:
        """
        撤销 token（将状态设置为 revoked）
        返回: 是否成功撤销
        """
        result = self.token_repo.update_status(token, "revoked")
        return result is not None
    
    def expire_token(self, token: str) -> bool:
        """
        使 token 过期（将状态设置为 expired）
        返回: 是否成功设置
        """
        result = self.token_repo.update_status(token, "expired")
        return result is not None
    
    
    def delete_token(self, token: str) -> bool:
        """
        删除 token
        返回: 是否成功删除
        """
        return self.token_repo.delete(token)
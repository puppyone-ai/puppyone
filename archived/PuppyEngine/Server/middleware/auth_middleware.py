"""
Authentication middleware for Engine Server
"""

from fastapi import Header, HTTPException
from Server.auth_module import auth_module, User
from Utils.config import config
from Utils.logger import log_info, log_warning

class AuthenticationResult:
    """Container for authentication results"""
    def __init__(self, user: User, user_token: str = None):
        self.user = user
        self.user_token = user_token

async def authenticate_user(
    authorization: str = Header(None, alias="Authorization"),
    x_user_id: str = Header(None, alias="x-user-id")
) -> AuthenticationResult:
    """
    Unified authentication middleware for both direct calls and API Server proxied calls.
    
    Args:
        authorization: JWT token for direct authentication
        x_user_id: User ID from API Server (takes precedence)
        
    Returns:
        AuthenticationResult: Contains authenticated user and token info
        
    Raises:
        HTTPException: If authentication fails
    """
    user_token = None
    user = None
    
    # 根据部署类型决定认证策略
    deployment_type = config.get("DEPLOYMENT_TYPE", "local").lower()
    
    if x_user_id:
        # 来自API Server的请求，用户已经过验证
        log_info(f"使用API Server提供的用户ID: {x_user_id}")
        user = User(user_id=x_user_id)
        
    elif deployment_type == "remote":
        # 远程部署模式，必须验证JWT token
        user_token = auth_module.extract_user_token(authorization)
        if not user_token:
            raise HTTPException(status_code=401, detail="远程模式下用户认证token是必需的")
        
        user = await auth_module.verify_user_token(user_token)
        log_info(f"远程模式用户认证成功: {user.user_id}")
        
    elif deployment_type == "local":
        # 本地开发模式，可以使用默认用户
        if authorization:
            # 如果提供了token，尝试验证（可选）
            try:
                user_token = auth_module.extract_user_token(authorization)
                if user_token:
                    user = await auth_module.verify_user_token(user_token)
                    log_info(f"本地模式用户认证成功: {user.user_id}")
                else:
                    log_info("本地模式，使用默认用户")
                    user = User(user_id="local-user")
            except Exception as e:
                log_warning(f"本地模式token验证失败，使用默认用户: {str(e)}")
                user = User(user_id="local-user")
        else:
            log_info("本地模式，使用默认用户")
            user = User(user_id="local-user")
            
    else:
        # 未知部署类型，拒绝访问
        raise HTTPException(status_code=500, detail=f"未知的部署类型: {deployment_type}")
    
    return AuthenticationResult(user=user, user_token=user_token) 
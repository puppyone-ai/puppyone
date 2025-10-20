"""
PuppyStorage 认证授权模块

提供用户JWT token验证和资源访问权限控制功能
支持本地模式(开发)和远程认证模式(生产)
"""

import os
import sys
import httpx
from typing import Protocol, Optional, Dict, Any
from fastapi import HTTPException, Header, Depends
from pydantic import BaseModel

# 添加项目路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.logger import log_info, log_error, log_warning, log_debug
from utils.config import config


class User(BaseModel):
    """用户信息模型 - 简化版本，只包含必要字段"""
    user_id: str


class AuthenticationError(Exception):
    """认证相关错误"""
    def __init__(self, message: str, status_code: int = 401):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class AuthProvider(Protocol):
    """认证提供者协议"""
    async def verify_user_token(self, user_token: str) -> User:
        """验证用户token并返回用户信息"""
        ...
    
    def requires_auth(self) -> bool:
        """是否需要认证"""
        ...


class LocalAuthProvider:
    """本地认证提供者 - 开发模式，支持可配置的认证行为"""
    
    def __init__(self):
        self.default_user_id = "local-user"
        # 新增配置：是否在本地模式下也进行基本的token格式验证
        self.strict_local_auth = config.get("STRICT_LOCAL_AUTH", "false").lower() == "true"
        
        if self.strict_local_auth:
            log_info("LocalAuthProvider initialized - 开发模式，启用严格认证验证")
        else:
            log_info("LocalAuthProvider initialized - 开发模式，跳过认证验证")
    
    async def verify_user_token(self, user_token: str) -> User:
        """本地模式的用户认证"""
        if self.strict_local_auth:
            # 严格模式：至少验证token格式
            if not user_token or not user_token.strip():
                raise AuthenticationError("Token不能为空")
            
            # 支持Bearer格式和直接token格式
            if user_token.startswith("Bearer "):
                token = user_token.split("Bearer ")[1].strip()
            else:
                token = user_token.strip()
            
            # 基本格式验证：不能是明显无效的token
            if len(token) < 10 or token in ["invalid_token", "test", "fake"]:
                raise AuthenticationError("无效的token格式")
            
            log_debug(f"本地严格模式认证通过，返回默认用户: {self.default_user_id}")
        else:
            # 宽松模式：完全跳过验证
            log_debug(f"本地宽松模式认证，返回默认用户: {self.default_user_id}")
        
        return User(user_id=self.default_user_id)
    
    def requires_auth(self) -> bool:
        """本地模式是否需要认证取决于配置"""
        return self.strict_local_auth


class RemoteAuthProvider:
    """远程认证提供者 - 调用 PuppyUserSystem 验证JWT token"""
    
    def __init__(self):
        # 配置参数
        self.user_system_url = config.get("USER_SYSTEM_URL", "http://localhost:8000")
        self.service_key = config.get("SERVICE_KEY")
        self.timeout = int(config.get("AUTH_TIMEOUT", "5"))
        
        # 创建异步HTTP客户端
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout),
            follow_redirects=True
        )
        
        log_info(f"RemoteAuthProvider initialized - user_system: {self.user_system_url}")
        
        if not self.service_key:
            log_warning("远程认证模式下未配置 SERVICE_KEY，可能导致认证失败")
    
    async def verify_user_token(self, user_token: str) -> User:
        """调用 PuppyUserSystem 验证JWT token"""
        if not user_token:
            raise AuthenticationError("用户token不能为空")
        
        # 支持Bearer格式和直接token格式
        if user_token.startswith("Bearer "):
            token = user_token.split("Bearer ")[1].strip()
        else:
            token = user_token.strip()
        
        try:
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # 添加服务密钥
            if self.service_key:
                headers["X-Service-Key"] = self.service_key
            
            log_debug(f"向用户系统验证token: {self.user_system_url}/verify_token")
            
            response = await self.client.post(
                f"{self.user_system_url}/verify_token",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("valid"):
                    user_data = data.get("user")
                    user_id = user_data["user_id"]
                    log_info(f"用户认证成功: {user_id}")
                    return User(user_id=user_id)
                else:
                    raise AuthenticationError("无效的用户token")
            elif response.status_code == 401:
                raise AuthenticationError("用户token验证失败")
            elif response.status_code == 403:
                raise AuthenticationError("服务认证失败，请检查SERVICE_KEY配置", status_code=403)
            else:
                log_error(f"用户系统返回错误状态: {response.status_code}: {response.text}")
                raise AuthenticationError("用户服务错误", status_code=503)
                
        except httpx.TimeoutException:
            log_error("调用用户系统超时")
            raise AuthenticationError("用户服务超时", status_code=503)
        except httpx.RequestError as e:
            log_error(f"调用用户系统时发生网络错误: {str(e)}")
            raise AuthenticationError("用户服务不可用", status_code=503)
        except AuthenticationError:
            # 重新抛出认证错误
            raise
        except Exception as e:
            log_error(f"认证过程中发生未预期错误: {str(e)}")
            raise AuthenticationError("认证失败")
    
    def requires_auth(self) -> bool:
        """远程模式需要认证"""
        return True
    
    async def close(self):
        """关闭HTTP客户端连接"""
        await self.client.aclose()


def get_auth_provider() -> AuthProvider:
    """认证提供者工厂函数 - 根据部署模式返回对应的认证提供者"""
    deployment_type = config.get("DEPLOYMENT_TYPE", "local").lower()
    
    if deployment_type == "local":
        log_info("使用 LocalAuthProvider (开发模式)")
        return LocalAuthProvider()
    elif deployment_type == "remote":
        log_info("使用 RemoteAuthProvider (生产模式)")
        return RemoteAuthProvider()
    else:
        log_warning(f"未知的部署模式: {deployment_type}，默认使用远程认证")
        return RemoteAuthProvider()


def check_resource_ownership(user_id: str, resource_key: str) -> bool:
    """
    检查用户是否有权限访问指定资源
    
    当前实现：用户只能访问属于自己的资源
    资源key格式：user_id/content_id/content_name
    
    Args:
        user_id: JWT token中的用户ID
        resource_key: 资源路径标识符
        
    Returns:
        bool: 是否有权限访问
    """
    if not resource_key:
        return False
    
    # 提取资源所属的用户ID
    parts = resource_key.split('/')
    if len(parts) < 3:
        log_warning(f"资源key格式不正确: {resource_key}")
        return False
    
    resource_owner = parts[0]
    
    # 简单的所有权检查：用户只能访问自己的资源
    has_access = user_id == resource_owner
    
    if not has_access:
        log_warning(f"用户 {user_id} 尝试访问不属于自己的资源: {resource_key}")
    
    return has_access


async def verify_user_and_resource_access(
    resource_key: str,
    authorization: str = Header(None, alias="Authorization"),
    auth_provider: AuthProvider = Depends(get_auth_provider)
) -> User:
    """
    统一的用户认证和资源访问权限验证依赖
    
    该依赖会：
    1. 从Authorization header中提取JWT token
    2. 调用认证提供者验证token
    3. 检查用户是否有权访问指定资源
    
    Args:
        resource_key: 要访问的资源路径
        authorization: Authorization header
        auth_provider: 认证提供者
        
    Returns:
        User: 验证成功的用户信息
        
    Raises:
        HTTPException: 认证失败或权限不足
    """
    # 检查是否需要认证
    if not auth_provider.requires_auth():
        # 本地模式，直接返回默认用户
        return await auth_provider.verify_user_token("")
    
    # 提取token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Expected format: 'Bearer <token>'"
        )
    
    try:
        # 验证token
        user = await auth_provider.verify_user_token(authorization)
        
        # 检查资源访问权限
        if not check_resource_ownership(user.user_id, resource_key):
            raise HTTPException(
                status_code=403,
                detail="Access denied: You don't have permission to access this resource"
            )
        
        return user
        
    except HTTPException:
        # 保留由业务逻辑明确抛出的HTTP错误状态
        raise
    except AuthenticationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        log_error(f"认证过程中发生未预期错误: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal authentication error")


# 便捷函数：从request body中提取key并进行认证
def create_auth_dependency(key_field: str = "key"):
    """
    创建认证依赖的工厂函数
    
    Args:
        key_field: request body中资源key的字段名
        
    Returns:
        认证依赖函数
    """
    async def auth_dependency(
        request_data: Dict[str, Any],
        authorization: str = Header(None, alias="Authorization"),
        auth_provider: AuthProvider = Depends(get_auth_provider)
    ) -> User:
        resource_key = request_data.get(key_field)
        if not resource_key:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required field: {key_field}"
            )
        
        return await verify_user_and_resource_access(
            resource_key=resource_key,
            authorization=authorization,
            auth_provider=auth_provider
        )
    
    return auth_dependency 
"""
Engine Server 用户认证模块

提供用户token验证和用户信息获取功能
支持本地模式和远程认证模式
"""

import os
import requests
import logging
from typing import Optional, Dict, Any
from pydantic import BaseModel
from Utils.logger import log_info, log_error, log_warning, log_debug

class User(BaseModel):
    """简化的用户模型 - 只需要user_id"""
    user_id: str

class AuthenticationError(Exception):
    """认证相关错误"""
    def __init__(self, message: str, status_code: int = 401):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class EngineAuthModule:
    """Engine Server 认证模块"""
    
    def __init__(self):
        # 配置参数
        self.user_system_url = os.getenv("USER_SYSTEM_URL", "http://localhost:8000")
        self.service_key = os.getenv("SERVICE_KEY")
        self.timeout = int(os.getenv("AUTH_TIMEOUT", "5"))
        self.local_mode = os.getenv("DEPLOYMENT_TYPE", "local").lower() == "local"
        
        # 本地模式默认用户
        self.default_user_id = "local-user"
        
        log_info(f"Engine认证模块初始化: mode={'local' if self.local_mode else 'remote'}, user_system={self.user_system_url}")
        
        if not self.local_mode and not self.service_key:
            log_warning("远程认证模式下未配置SERVICE_KEY，可能导致认证失败")

    async def verify_user_token(self, user_token: str) -> User:
        """
        验证用户token并返回用户信息
        
        Args:
            user_token: 用户JWT token
            
        Returns:
            User: 用户信息
            
        Raises:
            AuthenticationError: 认证失败
        """
        if self.local_mode:
            return await self._verify_local_mode(user_token)
        else:
            return await self._verify_remote_mode(user_token)

    async def _verify_local_mode(self, user_token: str) -> User:
        """
        本地模式认证 - 总是返回默认用户
        """
        log_debug(f"本地模式认证，返回默认用户: {self.default_user_id}")
        return User(user_id=self.default_user_id)

    async def _verify_remote_mode(self, user_token: str) -> User:
        """
        远程模式认证 - 调用用户系统验证token
        """
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
            
            # 如果有服务密钥，添加到headers
            if self.service_key:
                headers["X-Service-Key"] = self.service_key
            
            log_debug(f"向用户系统验证token: {self.user_system_url}/verify_token")
            
            response = requests.post(
                f"{self.user_system_url}/verify_token",
                headers=headers,
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("valid"):
                    user_data = data.get("user")
                    log_info(f"用户认证成功: {user_data.get('user_id')}")
                    # 只提取user_id字段
                    return User(user_id=user_data["user_id"])
                else:
                    raise AuthenticationError("无效的用户token")
            elif response.status_code == 401:
                raise AuthenticationError("用户token验证失败")
            elif response.status_code == 403:
                raise AuthenticationError("服务认证失败，请检查SERVICE_KEY配置")
            else:
                log_error(f"用户系统返回错误状态: {response.status_code}: {response.text}")
                raise AuthenticationError("用户服务错误", status_code=503)
                
        except requests.exceptions.Timeout:
            log_error("调用用户系统超时")
            raise AuthenticationError("用户服务超时", status_code=503)
        except requests.exceptions.RequestException as e:
            log_error(f"调用用户系统时发生网络错误: {str(e)}")
            raise AuthenticationError("用户服务不可用", status_code=503)
        except AuthenticationError:
            # 重新抛出认证错误
            raise
        except Exception as e:
            log_error(f"认证过程中发生未预期错误: {str(e)}")
            raise AuthenticationError("认证失败")

    def extract_user_token(self, authorization_header: Optional[str]) -> Optional[str]:
        """
        从Authorization header中提取用户token
        
        Args:
            authorization_header: Authorization header值
            
        Returns:
            str: 提取的token，如果无效则返回None
        """
        if not authorization_header:
            return None
        
        # 支持Bearer格式
        if authorization_header.startswith("Bearer "):
            return authorization_header.split("Bearer ")[1].strip()
        
        # 直接token格式
        return authorization_header.strip() if authorization_header.strip() else None

    def is_local_mode(self) -> bool:
        """是否为本地模式"""
        return self.local_mode

    def requires_auth(self) -> bool:
        """是否需要认证"""
        return not self.local_mode

# 全局认证模块实例
auth_module = EngineAuthModule() 
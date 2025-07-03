"""
Engine Server Usage Tracking 模块

提供用户usage检查和消费功能
支持本地模式（跳过检查）和远程模式（调用用户系统）
"""

import json
import requests
import asyncio
from typing import Optional, Dict, Any, Tuple
from Utils.logger import log_info, log_error, log_warning, log_debug
from Utils.config import config

class UsageError(Exception):
    """Usage相关错误"""
    def __init__(self, message: str, status_code: int = 429, available: int = 0):
        self.message = message
        self.status_code = status_code
        self.available = available
        super().__init__(message)

class EngineUsageModule:
    """Engine Server Usage模块"""
    
    def __init__(self):
        # 配置参数
        self.user_system_url = config.get("USER_SYSTEM_URL", "http://localhost:8000")
        self.service_key = config.get("SERVICE_KEY")
        self.timeout = int(config.get("USAGE_TIMEOUT", "5"))
        self.local_mode = config.get("DEPLOYMENT_TYPE", "local").lower() == "local"
        
        # 重试配置
        self.max_retries = int(config.get("USAGE_MAX_RETRIES", "3"))
        self.retry_delay = float(config.get("USAGE_RETRY_DELAY", "0.1"))
        
        log_info(f"Engine Usage模块初始化: mode={'local' if self.local_mode else 'remote'}, user_system={self.user_system_url}")
        
        if not self.local_mode and not self.service_key:
            log_warning("远程usage模式下未配置SERVICE_KEY，可能导致usage检查失败")

    async def check_usage_async(self, user_token: str, usage_type: str = "runs", amount: int = 1) -> Dict[str, Any]:
        """
        异步检查用户usage是否足够
        
        Args:
            user_token: 用户JWT token
            usage_type: usage类型
            amount: 需要检查的数量
            
        Returns:
            Dict: 检查结果，包含 allowed, available, requesting 等字段
        """
        if self.local_mode:
            return await self._check_local_mode(user_token, usage_type, amount)
        else:
            return await self._check_remote_mode(user_token, usage_type, amount)
    
    async def check_usage_by_user_id_async(self, user_id: str, usage_type: str = "runs", amount: int = 1) -> Dict[str, Any]:
        """
        基于用户ID异步检查用户usage是否足够
        
        Args:
            user_id: 用户ID
            usage_type: usage类型  
            amount: 需要检查的数量
            
        Returns:
            Dict: 检查结果，包含 allowed, available, requesting 等字段
        """
        if self.local_mode:
            return await self._check_local_mode_by_user_id(user_id, usage_type, amount)
        else:
            return await self._check_remote_mode_by_user_id(user_id, usage_type, amount)

    async def consume_usage_async(self, user_token: str, usage_type: str = "runs", amount: int = 1, 
                                 event_metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        异步消费用户usage
        
        Args:
            user_token: 用户JWT token
            usage_type: usage类型
            amount: 消费数量
            event_metadata: 事件元数据
            
        Returns:
            Dict: 消费结果
            
        Raises:
            UsageError: usage不足或消费失败
        """
        if self.local_mode:
            return await self._consume_local_mode(user_token, usage_type, amount, event_metadata)
        else:
            return await self._consume_remote_mode(user_token, usage_type, amount, event_metadata)
    
    async def consume_usage_by_user_id_async(self, user_id: str, usage_type: str = "runs", amount: int = 1,
                                           event_metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        基于用户ID异步消费用户usage
        
        Args:
            user_id: 用户ID
            usage_type: usage类型
            amount: 消费数量
            event_metadata: 事件元数据
            
        Returns:
            Dict: 消费结果
            
        Raises:
            UsageError: usage不足或消费失败
        """
        if self.local_mode:
            return await self._consume_local_mode_by_user_id(user_id, usage_type, amount, event_metadata)
        else:
            return await self._consume_remote_mode_by_user_id(user_id, usage_type, amount, event_metadata)

    async def check_and_consume_usage(self, user_token: str, usage_type: str = "runs", amount: int = 1,
                                     event_metadata: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """
        检查并消费usage（组合操作）
        
        Args:
            user_token: 用户JWT token
            usage_type: usage类型
            amount: 数量
            event_metadata: 事件元数据
            
        Returns:
            Tuple[Dict, Dict]: (检查结果, 消费结果)
            
        Raises:
            UsageError: usage不足或操作失败
        """
        # 先检查usage
        check_result = await self.check_usage_async(user_token, usage_type, amount)
        
        if not check_result.get("allowed", False):
            available = check_result.get("available", 0)
            raise UsageError(
                f"Usage不足: 需要{amount}个{usage_type}，但只有{available}个可用",
                status_code=429,
                available=available
            )
        
        # 如果检查通过，则消费usage
        consume_result = await self.consume_usage_async(user_token, usage_type, amount, event_metadata)
        
        return check_result, consume_result

    async def _check_local_mode(self, user_token: str, usage_type: str, amount: int) -> Dict[str, Any]:
        """
        本地模式usage检查 - 总是返回允许
        """
        log_debug(f"本地模式usage检查: {usage_type} x{amount} - 总是允许")
        return {
            "allowed": True,
            "available": 999999,
            "requesting": amount,
            "message": "本地模式，usage检查跳过",
            "user_id": "local-user"
        }
    
    async def _check_local_mode_by_user_id(self, user_id: str, usage_type: str, amount: int) -> Dict[str, Any]:
        """
        基于用户ID的本地模式usage检查 - 总是返回允许
        """
        log_debug(f"本地模式usage检查(用户ID {user_id}): {usage_type} x{amount} - 总是允许")
        return {
            "allowed": True,
            "available": 999999,
            "requesting": amount,
            "message": "本地模式，usage检查跳过",
            "user_id": user_id
        }

    async def _consume_local_mode(self, user_token: str, usage_type: str, amount: int, 
                                 event_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        本地模式usage消费 - 总是返回成功
        """
        log_debug(f"本地模式usage消费: {usage_type} x{amount} - 总是成功")
        return {
            "success": True,
            "consumed": amount,
            "remaining": 999999,
            "message": "本地模式，usage消费跳过",
            "user_id": "local-user"
        }
    
    async def _consume_local_mode_by_user_id(self, user_id: str, usage_type: str, amount: int,
                                           event_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        基于用户ID的本地模式usage消费 - 总是返回成功
        """
        log_debug(f"本地模式usage消费(用户ID {user_id}): {usage_type} x{amount} - 总是成功")
        return {
            "success": True,
            "consumed": amount,
            "remaining": 999999,
            "message": "本地模式，usage消费跳过",
            "user_id": user_id
        }

    async def _check_remote_mode(self, user_token: str, usage_type: str, amount: int) -> Dict[str, Any]:
        """
        远程模式usage检查 - 调用用户系统
        """
        url = f"{self.user_system_url}/usage/external/check"
        
        payload = {
            "user_token": user_token,
            "usage_type": usage_type,
            "amount": amount
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Service-Key": self.service_key
        }
        
        return await self._make_request_with_retry("POST", url, headers=headers, json=payload, operation="check")
    
    async def _check_remote_mode_by_user_id(self, user_id: str, usage_type: str, amount: int) -> Dict[str, Any]:
        """
        基于用户ID的远程模式usage检查 - 调用用户系统新接口
        """
        url = f"{self.user_system_url}/usage/external/check_by_user_id"
        
        payload = {
            "user_id": user_id,
            "usage_type": usage_type,
            "amount": amount
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Service-Key": self.service_key
        }
        
        return await self._make_request_with_retry("POST", url, headers=headers, json=payload, operation="check_by_user_id")

    async def _consume_remote_mode(self, user_token: str, usage_type: str, amount: int, 
                                  event_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        远程模式usage消费 - 调用用户系统
        """
        url = f"{self.user_system_url}/usage/external/consume"
        
        payload = {
            "user_token": user_token,
            "usage_type": usage_type,
            "amount": amount,
            "event_metadata": event_metadata or {}
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Service-Key": self.service_key
        }
        
        return await self._make_request_with_retry("POST", url, headers=headers, json=payload, operation="consume")
    
    async def _consume_remote_mode_by_user_id(self, user_id: str, usage_type: str, amount: int,
                                            event_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        基于用户ID的远程模式usage消费 - 调用用户系统新接口
        """
        url = f"{self.user_system_url}/usage/external/consume_by_user_id"
        
        payload = {
            "user_id": user_id,
            "usage_type": usage_type,
            "amount": amount,
            "event_metadata": event_metadata or {}
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Service-Key": self.service_key
        }
        
        return await self._make_request_with_retry("POST", url, headers=headers, json=payload, operation="consume_by_user_id")

    async def _make_request_with_retry(self, method: str, url: str, headers: Dict[str, str], 
                                      json: Dict[str, Any], operation: str) -> Dict[str, Any]:
        """
        带重试的HTTP请求
        """
        last_exception = None
        
        for attempt in range(self.max_retries):
            try:
                log_debug(f"Usage {operation} 请求尝试 {attempt + 1}/{self.max_retries}: {url}")
                
                # 使用requests同步请求，在asyncio中运行
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: requests.request(
                        method=method,
                        url=url,
                        headers=headers,
                        json=json,
                        timeout=self.timeout
                    )
                )
                
                if response.status_code == 200:
                    result = response.json()
                    log_info(f"Usage {operation} 成功: {result}")
                    return result
                elif response.status_code == 401:
                    raise UsageError("用户认证失败", status_code=401)
                elif response.status_code == 403:
                    raise UsageError("服务认证失败", status_code=403)
                elif response.status_code == 429:
                    # Usage不足的情况
                    try:
                        error_data = response.json()
                        available = error_data.get("available", 0)
                        message = error_data.get("message", "Usage不足")
                        raise UsageError(message, status_code=429, available=available)
                    except json.JSONDecodeError:
                        raise UsageError("Usage不足", status_code=429)
                else:
                    log_warning(f"Usage {operation} 返回错误状态: {response.status_code}: {response.text}")
                    if attempt == self.max_retries - 1:  # 最后一次尝试
                        raise UsageError(f"Usage服务错误: {response.status_code}", status_code=503)
                
            except requests.exceptions.Timeout as e:
                last_exception = e
                log_warning(f"Usage {operation} 超时，尝试 {attempt + 1}/{self.max_retries}")
                if attempt == self.max_retries - 1:
                    raise UsageError("Usage服务超时", status_code=503)
                    
            except requests.exceptions.RequestException as e:
                last_exception = e
                log_warning(f"Usage {operation} 网络错误，尝试 {attempt + 1}/{self.max_retries}: {str(e)}")
                if attempt == self.max_retries - 1:
                    raise UsageError("Usage服务不可用", status_code=503)
                    
            except UsageError:
                # UsageError不需要重试，直接抛出
                raise
                
            except Exception as e:
                last_exception = e
                log_error(f"Usage {operation} 未预期错误，尝试 {attempt + 1}/{self.max_retries}: {str(e)}")
                if attempt == self.max_retries - 1:
                    raise UsageError("Usage操作失败", status_code=500)
            
            # 等待后重试
            if attempt < self.max_retries - 1:
                await asyncio.sleep(self.retry_delay * (2 ** attempt))  # 指数退避
        
        # 如果所有重试都失败了
        raise UsageError(f"Usage {operation} 操作失败，已重试{self.max_retries}次", status_code=503)

    def is_local_mode(self) -> bool:
        """是否为本地模式"""
        return self.local_mode

    def requires_usage_check(self) -> bool:
        """是否需要usage检查"""
        return not self.local_mode

# 全局usage模块实例
usage_module = EngineUsageModule() 
"""
MCP Service 配置管理
集中管理所有配置项，从环境变量读取
"""
from __future__ import annotations

import os
from typing import Optional


class Settings:
    """MCP Service配置类"""
    
    # ============ 服务配置 ============
    
    @property
    def HOST(self) -> str:
        """服务监听地址"""
        return os.getenv("HOST", "0.0.0.0")
    
    @property
    def PORT(self) -> int:
        """服务监听端口"""
        return int(os.getenv("PORT", "3090"))
    
    # ============ RPC配置 ============
    
    @property
    def MAIN_SERVICE_URL(self) -> str:
        """主服务的URL（内网地址）"""
        return os.getenv("MAIN_SERVICE_URL", "http://localhost:8000")
    
    @property
    def INTERNAL_API_SECRET(self) -> str:
        """Internal API的SECRET（用于服务间鉴权）"""
        secret = os.getenv("INTERNAL_API_SECRET")
        if not secret:
            raise ValueError("INTERNAL_API_SECRET environment variable is required")
        return secret
    
    @property
    def RPC_TIMEOUT(self) -> float:
        """RPC调用超时时间（秒）"""
        return float(os.getenv("RPC_TIMEOUT", "30.0"))
    
    # ============ 缓存配置 ============
    
    @property
    def CACHE_TTL(self) -> int:
        """缓存过期时间（秒），默认15分钟"""
        return int(os.getenv("CACHE_TTL", "900"))
    
    @property
    def CACHE_BACKEND(self) -> str:
        """缓存后端类型，支持：mem（内存）、redis"""
        return os.getenv("CACHE_BACKEND", "mem")
    
    @property
    def REDIS_URL(self) -> Optional[str]:
        """Redis连接URL（仅当CACHE_BACKEND=redis时需要）"""
        return os.getenv("REDIS_URL")
    
    # ============ 日志配置 ============
    
    @property
    def LOG_LEVEL(self) -> str:
        """日志级别"""
        return os.getenv("LOG_LEVEL", "INFO")
    
    @property
    def DEBUG(self) -> bool:
        """是否开启调试模式"""
        return os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
    
    # ============ 性能配置 ============
    
    @property
    def MAX_RETRIES(self) -> int:
        """RPC调用最大重试次数"""
        return int(os.getenv("MAX_RETRIES", "3"))
    
    @property
    def RETRY_DELAY(self) -> float:
        """RPC调用重试延迟（秒）"""
        return float(os.getenv("RETRY_DELAY", "0.5"))
    
    # ============ 辅助方法 ============
    
    def validate(self) -> None:
        """验证配置是否有效"""
        # 检查必需的配置项
        _ = self.INTERNAL_API_SECRET  # 会在缺失时抛出异常
        
        # 如果使用Redis缓存，检查Redis URL
        if self.CACHE_BACKEND == "redis" and not self.REDIS_URL:
            raise ValueError("REDIS_URL is required when CACHE_BACKEND=redis")
    
    def display(self) -> dict:
        """显示配置（隐藏敏感信息）"""
        return {
            "HOST": self.HOST,
            "PORT": self.PORT,
            "MAIN_SERVICE_URL": self.MAIN_SERVICE_URL,
            "INTERNAL_API_SECRET": "***" + self.INTERNAL_API_SECRET[-4:] if len(self.INTERNAL_API_SECRET) > 4 else "***",
            "RPC_TIMEOUT": self.RPC_TIMEOUT,
            "CACHE_TTL": self.CACHE_TTL,
            "CACHE_BACKEND": self.CACHE_BACKEND,
            "REDIS_URL": "***" if self.REDIS_URL else None,
            "LOG_LEVEL": self.LOG_LEVEL,
            "DEBUG": self.DEBUG,
            "MAX_RETRIES": self.MAX_RETRIES,
            "RETRY_DELAY": self.RETRY_DELAY,
        }


# 创建全局配置实例
settings = Settings()

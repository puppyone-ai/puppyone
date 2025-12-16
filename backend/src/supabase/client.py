"""
Supabase 客户端

提供单例模式的 Supabase 客户端，避免重复连接。
"""

import os
from typing import Optional
from supabase import create_client, Client
from supabase.client import ClientOptions


class SupabaseClient:
    """Supabase 客户端单例类"""

    _instance: Optional["SupabaseClient"] = None
    _client: Optional[Client] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        """初始化 Supabase 客户端（仅在首次调用时创建连接）"""
        if self._client is None:
            url: str = os.environ.get("SUPABASE_URL", "")
            key: str = os.environ.get("SUPABASE_KEY", "")

            if not url or not key:
                raise ValueError(
                    "SUPABASE_URL 和 SUPABASE_KEY 环境变量必须设置"
                )

            self._client = create_client(
                url,
                key,
                options=ClientOptions(
                    postgrest_client_timeout=10,
                    storage_client_timeout=30,
                    schema="public",
                ),
            )

    @property
    def client(self) -> Client:
        """获取 Supabase 客户端实例"""
        if self._client is None:
            self.__init__()
        assert self._client is not None
        return self._client

    def get_client(self) -> Client:
        """获取 Supabase 客户端实例（方法形式）"""
        return self.client

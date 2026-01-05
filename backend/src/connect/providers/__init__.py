"""
数据源 Provider 基类
用于扩展支持不同的数据源
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List


class DataProvider(ABC):
    """数据提供者基类"""

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """
        判断是否可以处理该URL

        Args:
            url: 待处理的URL

        Returns:
            是否可以处理
        """
        pass

    @abstractmethod
    async def fetch_data(self, url: str) -> Dict[str, Any]:
        """
        从URL获取数据

        Args:
            url: 数据源URL

        Returns:
            包含数据和元信息的字典
        """
        pass

    @abstractmethod
    def parse_data(self, raw_data: Any) -> List[Dict[str, Any]]:
        """
        解析原始数据为结构化数据

        Args:
            raw_data: 原始数据

        Returns:
            结构化的数据列表
        """
        pass

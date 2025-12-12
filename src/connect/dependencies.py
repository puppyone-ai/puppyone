"""
Connect 模块的依赖注入
"""

from functools import lru_cache
from src.connect.service import ConnectService
from src.connect.parser import UrlParser


@lru_cache
def get_connect_service() -> ConnectService:
    """
    获取 Connect 服务实例
    
    Returns:
        ConnectService 实例
    """
    parser = UrlParser()
    return ConnectService(parser)


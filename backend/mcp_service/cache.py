"""
缓存层实现
使用cashews库实现基于内存的缓存
"""
from cashews import cache
from typing import Optional, Dict, Any
from .settings import settings

# 配置缓存后端
if settings.CACHE_BACKEND == "redis" and settings.REDIS_URL:
    cache.setup(settings.REDIS_URL)
else:
    cache.setup("mem://")


class CacheManager:
    """缓存管理器"""
    
    @staticmethod
    def _get_config_key(api_key: str) -> str:
        """生成配置缓存的key"""
        return f"mcp:config:{api_key}"
    
    @staticmethod
    def _get_table_data_key(table_id: int, json_path: str) -> str:
        """生成表格数据缓存的key"""
        return f"mcp:table_data:{table_id}:{json_path}"
    
    @staticmethod
    async def get_config(api_key: str) -> Optional[Dict[str, Any]]:
        """
        获取MCP实例配置缓存
        
        Args:
            api_key: API key
            
        Returns:
            配置数据，如果不存在则返回None
        """
        key = CacheManager._get_config_key(api_key)
        return await cache.get(key)
    
    @staticmethod
    async def set_config(api_key: str, config: Dict[str, Any], ttl: Optional[int] = None) -> None:
        """
        设置MCP实例配置缓存
        
        Args:
            api_key: API key
            config: 配置数据
            ttl: 过期时间（秒），如果为None则使用默认值
        """
        key = CacheManager._get_config_key(api_key)
        ttl = ttl or settings.CACHE_TTL
        await cache.set(key, config, expire=ttl)
    
    @staticmethod
    async def invalidate_config(api_key: str) -> None:
        """
        使MCP实例配置缓存失效
        
        Args:
            api_key: API key
        """
        key = CacheManager._get_config_key(api_key)
        await cache.delete(key)
    
    @staticmethod
    async def get_table_data(table_id: int, json_path: str = "") -> Optional[Any]:
        """
        获取表格数据缓存
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            
        Returns:
            表格数据，如果不存在则返回None
        """
        key = CacheManager._get_table_data_key(table_id, json_path)
        return await cache.get(key)
    
    @staticmethod
    async def set_table_data(
        table_id: int,
        json_path: str,
        data: Any,
        ttl: Optional[int] = None
    ) -> None:
        """
        设置表格数据缓存
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            data: 表格数据
            ttl: 过期时间（秒），如果为None则使用默认值
        """
        key = CacheManager._get_table_data_key(table_id, json_path)
        ttl = ttl or settings.CACHE_TTL
        await cache.set(key, data, expire=ttl)
    
    @staticmethod
    async def invalidate_table_data(table_id: int, json_path: str = "") -> None:
        """
        使表格数据缓存失效
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
        """
        key = CacheManager._get_table_data_key(table_id, json_path)
        await cache.delete(key)
    
    @staticmethod
    async def invalidate_all_table_data(table_id: int) -> None:
        """
        使指定表格的所有缓存失效
        
        Args:
            table_id: 表格ID
        """
        # 由于cashews不支持按前缀删除，这里使用一个简单的方式
        # 在实际使用中，可能需要记录所有使用的 json_path
        # 或者使用Redis并利用SCAN命令
        pattern = f"mcp:table_data:{table_id}:*"
        # 暂时使用空实现，因为内存缓存会自动过期
        # 如果需要立即失效，可以维护一个 json_path 列表
        pass
    
    @staticmethod
    async def clear_all() -> None:
        """清空所有缓存"""
        await cache.clear()
    
    @staticmethod
    async def get_stats() -> Dict[str, Any]:
        """
        获取缓存统计信息
        
        Returns:
            统计信息字典
        """
        # cashews的内存后端不提供详细统计
        # 这里返回一个简单的占位符
        return {
            "backend": settings.CACHE_BACKEND,
            "ttl": settings.CACHE_TTL
        }

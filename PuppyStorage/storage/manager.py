import os
import sys
from typing import Optional

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from utils.config import config
from utils.logger import log_info, log_error
from .base import StorageAdapter
from .local import LocalStorageAdapter
from .S3 import S3StorageAdapter


class StorageManager:
    """
    存储管理器 - 根据配置自动选择合适的存储实现
    支持在本地存储(Local)和远程存储(S3)之间切换
    """
    
    _instance: Optional['StorageManager'] = None
    _adapter: Optional[StorageAdapter] = None
    
    def __new__(cls):
        """单例模式，确保全局只有一个存储管理器实例"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._adapter is None:
            self._initialize_adapter()
    
    def _initialize_adapter(self):
        """根据配置初始化存储适配器"""
        try:
            # 从配置文件或环境变量获取存储类型
            storage_type = self._get_storage_type()
            
            if storage_type == "local":
                log_info("初始化本地文件系统存储")
                self._adapter = LocalStorageAdapter()
            else:  # "remote" or "s3"
                log_info("初始化S3远程存储")
                self._adapter = S3StorageAdapter()
                
        except Exception as e:
            log_error(f"初始化存储适配器失败: {str(e)}")
            # 如果S3初始化失败，回退到本地存储
            if storage_type != "local":
                log_info("S3存储初始化失败，回退到本地存储")
                try:
                    self._adapter = LocalStorageAdapter()
                except Exception as fallback_error:
                    log_error(f"本地存储初始化也失败: {str(fallback_error)}")
                    raise
            else:
                raise
    
    def _get_storage_type(self) -> str:
        """
        获取存储类型配置
        基于 DEPLOYMENT_TYPE 配置：
        - local: 本地开发环境，使用本地文件存储
        - remote: 远程环境，使用远程S3存储
        """
        # 获取部署类型
        deployment_type = os.getenv("DEPLOYMENT_TYPE", "").lower()
        if not deployment_type:
            deployment_type = config.get("DEPLOYMENT_TYPE", "").lower()
        
        if deployment_type == "local":
            return "local"
        elif deployment_type == "remote":
            return "remote"
        elif deployment_type:
            log_info(f"未识别的部署类型 '{deployment_type}'，仅支持 'local' 或 'remote'，默认使用 remote")
            return "remote"
        
        # 默认配置：远程存储
        log_info("未找到 DEPLOYMENT_TYPE 配置，默认使用远程存储")
        return "remote"
    
    def get_adapter(self) -> StorageAdapter:
        """获取当前的存储适配器"""
        if self._adapter is None:
            self._initialize_adapter()
        return self._adapter
    
    def switch_storage_type(self, storage_type: str):
        """
        动态切换存储类型
        注意：这会创建新的适配器实例，之前的连接会被清理
        """
        old_type = "local" if isinstance(self._adapter, LocalStorageAdapter) else "remote"
        
        if storage_type.lower() == "local":
            if not isinstance(self._adapter, LocalStorageAdapter):
                log_info(f"存储类型从 {old_type} 切换到 local")
                self._adapter = LocalStorageAdapter()
        else:  # remote/s3
            if not isinstance(self._adapter, S3StorageAdapter):
                log_info(f"存储类型从 {old_type} 切换到 remote")
                self._adapter = S3StorageAdapter()
    
    def get_storage_info(self) -> dict:
        """获取当前存储配置信息"""
        if self._adapter is None:
            return {"type": "未初始化", "status": "未初始化"}
        
        if isinstance(self._adapter, LocalStorageAdapter):
            return {
                "type": "local",
                "status": "已就绪",
                "path": self._adapter.base_path,
                "server_url": getattr(self._adapter, 'LOCAL_SERVER_URL', 'N/A')
            }
        elif isinstance(self._adapter, S3StorageAdapter):
            return {
                "type": "remote",
                "status": "已就绪",
                "bucket": self._adapter.bucket,
                "endpoint": config.get("CLOUDFLARE_R2_ENDPOINT", "N/A")
            }
        else:
            return {"type": "未知", "status": "未知"}


# 全局存储管理器实例 - 延迟初始化
_storage_manager_instance = None

def get_storage() -> StorageAdapter:
    """
    获取存储适配器的便捷函数
    这是主要的外部接口，类似于 PuppyAgent-API 中的 get_storage
    """
    global _storage_manager_instance
    if _storage_manager_instance is None:
        _storage_manager_instance = StorageManager()
    return _storage_manager_instance.get_adapter()


def switch_storage(storage_type: str):
    """切换存储类型的便捷函数"""
    global _storage_manager_instance
    if _storage_manager_instance is None:
        _storage_manager_instance = StorageManager()
    _storage_manager_instance.switch_storage_type(storage_type)


def get_storage_info() -> dict:
    """获取存储信息的便捷函数"""
    global _storage_manager_instance
    if _storage_manager_instance is None:
        _storage_manager_instance = StorageManager()
    return _storage_manager_instance.get_storage_info()


def reset_storage_manager():
    """重置存储管理器 - 主要用于测试和调试"""
    global _storage_manager_instance
    _storage_manager_instance = None
    # 同时重置StorageManager的单例实例
    StorageManager._instance = None
    StorageManager._adapter = None 
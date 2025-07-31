from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any, Tuple

class StorageAdapter(ABC):
    @abstractmethod
    def generate_upload_url(self, key: str, content_type: str, expires_in: int = 300) -> str:
        """生成上传文件的URL"""
        pass

    @abstractmethod
    def generate_download_url(self, key: str, expires_in: int = 86400) -> str:
        """生成下载文件的URL"""
        pass

    @abstractmethod
    def generate_delete_url(self, key: str, expires_in: int = 300) -> str:
        """生成删除文件的预签名URL"""
        pass

    @abstractmethod
    def delete_file(self, key: str) -> bool:
        """删除文件"""
        pass
    
    @abstractmethod
    def check_file_exists(self, key: str) -> bool:
        """检查文件是否存在"""
        pass
    
    @abstractmethod
    def save_file(self, key: str, file_data: bytes, content_type: str, match_etag: Optional[str] = None) -> bool:
        """
        保存文件
        
        Args:
            key: 文件的存储路径
            file_data: 文件内容
            content_type: 文件的MIME类型
            match_etag: 可选的ETag值，用于乐观锁控制。如果提供且不匹配当前文件的ETag，则抛出ConditionFailedError
            
        Returns:
            bool: 保存成功返回True
            
        Raises:
            ConditionFailedError: 当match_etag不匹配时
        """
        pass
    
    @abstractmethod
    def get_file(self, key: str) -> tuple:
        """获取文件内容和类型"""
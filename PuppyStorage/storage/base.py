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
        pass
    
    @abstractmethod
    def list_objects(self, prefix: str, delimiter: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        列出指定前缀下的对象
        
        Args:
            prefix: 对象键的前缀
            delimiter: 分隔符，用于层级列表
            
        Returns:
            包含对象信息的字典列表，每个字典包含:
            - Key: 对象键
            - LastModified: 最后修改时间
            - Size: 文件大小
            - ETag: 实体标签
        """
        pass
    
    @abstractmethod
    def get_file_with_metadata(self, key: str) -> Tuple[bytes, str, Optional[str]]:
        """
        获取文件内容及其元数据
        
        Args:
            key: 文件的存储路径
            
        Returns:
            tuple: (文件内容, 内容类型, ETag)
        """
        pass
    
    @abstractmethod
    async def stream_from_disk(self, key: str, range_header: Optional[str] = None):
        """
        从本地磁盘流式读取文件 (仅用于本地存储)
        
        Args:
            key: 文件的存储路径
            range_header: HTTP Range请求头
            
        Returns:
            async iterator: 文件内容的异步迭代器，以及状态码、范围头、文件大小
        """
        pass
from abc import ABC, abstractmethod

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
    def save_file(self, key: str, file_data: bytes, content_type: str) -> bool:
        """保存文件"""
        pass
    
    @abstractmethod
    def get_file(self, key: str) -> tuple:
        """获取文件内容和类型"""
        pass 
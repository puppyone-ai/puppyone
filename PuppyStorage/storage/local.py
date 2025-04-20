import os
import shutil
import uuid
import time
import sys

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from utils.config import config
from utils.logger import log_info, log_error
from storage.base import StorageAdapter

# 使用新的路径管理系统获取存储路径
LOCAL_STORAGE_PATH = config.get_path("STORAGE_ROOT")
LOCAL_SERVER_URL = config.get("LOCAL_SERVER_URL", "http://localhost:8002")

class LocalStorageAdapter(StorageAdapter):
    def __init__(self):
        # 设置本地持久化目录
        self.base_path = os.path.join(LOCAL_STORAGE_PATH, "storage_files")
        
        # 确保目录存在
        os.makedirs(self.base_path, exist_ok=True)
        log_info(f"本地存储路径: {self.base_path}")
        
    def _get_file_path(self, key: str) -> str:
        return os.path.join(self.base_path, key)
    
    def _ensure_directory_exists(self, file_path: str):
        directory = os.path.dirname(file_path)
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

    def generate_upload_url(self, key: str, content_type: str, expires_in: int = 300) -> str:
        # 直接返回上传URL，使用key作为路径参数
        return f"{LOCAL_SERVER_URL}/storage/upload/{key}?content_type={content_type}"

    def generate_download_url(self, key: str, expires_in: int = 86400) -> str:
        # 返回一个用于下载文件的URL
        return f"{LOCAL_SERVER_URL}/storage/download/{key}"

    def delete_file(self, key: str) -> bool:
        try:
            file_path = self._get_file_path(key)
            if not os.path.exists(file_path):
                log_error(f"文件不存在: {file_path}")
                return False
                
            if os.path.isfile(file_path):
                os.remove(file_path)
            else:
                shutil.rmtree(file_path)
            return True
        except Exception as e:
            log_error(f"删除本地文件失败: {str(e)}")
            return False

    def check_file_exists(self, key: str) -> bool:
        return os.path.exists(self._get_file_path(key))
    
    def save_file(self, key: str, file_data: bytes, content_type: str) -> bool:
        try:
            file_path = self._get_file_path(key)
            self._ensure_directory_exists(file_path)
            
            with open(file_path, 'wb') as f:
                f.write(file_data)
            
            log_info(f"文件已保存到本地: {file_path}")
            return True
        except Exception as e:
            log_error(f"保存本地文件失败: {str(e)}")
            return False
    
    def get_file(self, key: str) -> tuple:
        try:
            file_path = self._get_file_path(key)
            if not os.path.exists(file_path):
                return None, None
            
            with open(file_path, 'rb') as f:
                file_data = f.read()
            
            # 尝试从文件扩展名推断内容类型
            content_type = "application/octet-stream"
            ext = os.path.splitext(file_path)[1].lower()
            if ext in ['.txt', '.md', '.json', '.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.mp3', '.wav', '.mp4', '.webm', '.pdf', '.zip']:
                content_type = {
                    '.txt': 'text/plain',
                    '.md': 'text/markdown',
                    '.json': 'application/json',
                    '.html': 'text/html',
                    '.css': 'text/css',
                    '.js': 'text/javascript',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.mp3': 'audio/mpeg',
                    '.wav': 'audio/wav',
                    '.mp4': 'video/mp4',
                    '.webm': 'video/webm',
                    '.pdf': 'application/pdf',
                    '.zip': 'application/zip'
                }.get(ext, 'application/octet-stream')
            
            return file_data, content_type
        except Exception as e:
            log_error(f"获取本地文件失败: {str(e)}")
            return None, None

if __name__ == "__main__":
    # 创建适配器实例并运行测试
    adapter = LocalStorageAdapter()
    print(f"本地存储适配器已初始化，存储路径: {adapter.base_path}")
    
    # 简单的测试示例
    test_key = "test/test_file.txt"
    test_data = b"Hello, World!"
    content_type = "text/plain"
    
    # 保存文件
    result = adapter.save_file(test_key, test_data, content_type)
    print(f"保存文件结果: {'成功' if result else '失败'}")
    
    # 检查文件是否存在
    exists = adapter.check_file_exists(test_key)
    print(f"文件存在: {exists}")
    
    # 获取文件
    retrieved_data, retrieved_type = adapter.get_file(test_key)
    print(f"获取文件成功: {retrieved_data == test_data}")
    print(f"内容类型匹配: {retrieved_type == content_type}")
    
    # 删除文件
    delete_result = adapter.delete_file(test_key)
    print(f"删除文件结果: {'成功' if delete_result else '失败'}") 
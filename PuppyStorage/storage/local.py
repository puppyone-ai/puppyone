import os
import shutil
import uuid
import time
from utils.config import config
from utils.logger import log_info, log_error
from storage.base import StorageAdapter

LOCAL_STORAGE_PATH = config.get("LOCAL_STORAGE_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "local_storage"))
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
        # 生成一个唯一的临时上传路径
        temp_id = str(uuid.uuid4())
        temp_path = os.path.join(self.base_path, "temp", temp_id)
        self._ensure_directory_exists(temp_path)
        
        # 返回一个特殊的URL，用于上传文件
        return f"{LOCAL_SERVER_URL}/storage/upload/{temp_id}?key={key}&content_type={content_type}"

    def generate_download_url(self, key: str, expires_in: int = 86400) -> str:
        # 返回一个用于下载文件的URL
        return f"{LOCAL_SERVER_URL}/storage/download/{key}"

    def delete_file(self, key: str) -> bool:
        try:
            file_path = self._get_file_path(key)
            if os.path.exists(file_path):
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
    import unittest
    import tempfile
    import os
    import shutil
    
    class TestLocalStorageAdapter(unittest.TestCase):
        def setUp(self):
            # 创建临时目录作为测试存储路径
            self.temp_dir = tempfile.mkdtemp()
            self.original_storage_path = LOCAL_STORAGE_PATH
            # 修改配置中的存储路径为临时目录
            import utils.config
            utils.config.config["LOCAL_STORAGE_PATH"] = self.temp_dir
            self.adapter = LocalStorageAdapter()
            
        def tearDown(self):
            # 恢复原始存储路径
            import utils.config
            utils.config.config["LOCAL_STORAGE_PATH"] = self.original_storage_path
            # 清理临时目录
            shutil.rmtree(self.temp_dir)
            
        def test_save_and_get_file(self):
            # 测试保存和获取文件
            test_data = b"Hello, World!"
            test_key = "test/test_file.txt"
            content_type = "text/plain"
            
            # 保存文件
            result = self.adapter.save_file(test_key, test_data, content_type)
            self.assertTrue(result)
            
            # 检查文件是否存在
            self.assertTrue(self.adapter.check_file_exists(test_key))
            
            # 获取文件
            retrieved_data, retrieved_type = self.adapter.get_file(test_key)
            self.assertEqual(test_data, retrieved_data)
            self.assertEqual(content_type, retrieved_type)
            
        def test_delete_file(self):
            # 测试删除文件
            test_data = b"Test data for deletion"
            test_key = "test/delete_test.txt"
            
            # 保存文件
            self.adapter.save_file(test_key, test_data, "text/plain")
            
            # 删除文件
            result = self.adapter.delete_file(test_key)
            self.assertTrue(result)
            
            # 检查文件是否已被删除
            self.assertFalse(self.adapter.check_file_exists(test_key))
            
        def test_generate_urls(self):
            # 测试生成上传和下载URL
            test_key = "test/url_test.txt"
            content_type = "text/plain"
            
            # 生成上传URL
            upload_url = self.adapter.generate_upload_url(test_key, content_type)
            self.assertIn(LOCAL_SERVER_URL, upload_url)
            self.assertIn(test_key, upload_url)
            self.assertIn(content_type, upload_url)
            
            # 生成下载URL
            download_url = self.adapter.generate_download_url(test_key)
            self.assertIn(LOCAL_SERVER_URL, download_url)
            self.assertIn(test_key, download_url)
            
        def test_get_nonexistent_file(self):
            # 测试获取不存在的文件
            nonexistent_key = "test/nonexistent.txt"
            data, content_type = self.adapter.get_file(nonexistent_key)
            self.assertIsNone(data)
            self.assertIsNone(content_type)
    
    # 运行测试
    unittest.main() 
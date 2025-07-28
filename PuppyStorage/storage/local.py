import os
import shutil
import uuid
import time
import sys
import json
from typing import Optional, Dict, Any, List

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
        # Set local persistent directory
        self.base_path = os.path.join(LOCAL_STORAGE_PATH, "storage_files")
        
        # Set multipart upload directory
        self.multipart_path = os.path.join(LOCAL_STORAGE_PATH, "multipart_uploads")
        
        # Ensure directories exist
        os.makedirs(self.base_path, exist_ok=True)
        os.makedirs(self.multipart_path, exist_ok=True)
        
        log_info(f"Local storage path: {self.base_path}")
        log_info(f"Local multipart path: {self.multipart_path}")
        
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

    def generate_delete_url(self, key: str, expires_in: int = 300) -> str:
        """生成删除文件的URL - 本地存储直接返回删除endpoint"""
        return f"{LOCAL_SERVER_URL}/storage/delete/{key}"

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
            
            log_info(f"File saved to local storage: {file_path}")
            return True
        except Exception as e:
            log_error(f"Failed to save local file: {str(e)}")
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

    # === Multipart Upload Coordinator Implementation ===
    
    def _get_multipart_dir(self, upload_id: str) -> str:
        """获取multipart上传的目录路径"""
        return os.path.join(self.multipart_path, upload_id)
    
    def _get_multipart_metadata_file(self, upload_id: str) -> str:
        """获取multipart上传的元数据文件路径"""
        return os.path.join(self._get_multipart_dir(upload_id), "metadata.json")
    
    def _get_part_file(self, upload_id: str, part_number: int) -> str:
        """获取分块文件的路径"""
        return os.path.join(self._get_multipart_dir(upload_id), f"part_{part_number:05d}")
    
    def init_multipart_upload(self, key: str, content_type: Optional[str] = None) -> Dict[str, Any]:
        """初始化本地分块上传"""
        try:
            upload_id = str(uuid.uuid4())
            multipart_dir = self._get_multipart_dir(upload_id)
            
            # 创建multipart目录
            os.makedirs(multipart_dir, exist_ok=True)
            
            # 创建元数据文件
            metadata = {
                "upload_id": upload_id,
                "key": key,
                "content_type": content_type,
                "initiated": int(time.time()),
                "parts": {}
            }
            
            metadata_file = self._get_multipart_metadata_file(upload_id)
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2)
            
            # 计算过期时间（24小时后）
            expires_at = int(time.time()) + (24 * 60 * 60)
            
            result = {
                "upload_id": upload_id,
                "key": key,
                "expires_at": expires_at,
                "max_parts": 10000,  # 与S3保持一致
                "min_part_size": 5 * 1024 * 1024  # 5MB（除最后一块外）
            }
            
            log_info(f"本地分块上传初始化成功: key={key}, upload_id={upload_id}")
            return result
            
        except Exception as e:
            log_error(f"本地分块上传初始化失败: {str(e)}")
            raise
    
    def get_multipart_upload_url(self, key: str, upload_id: str, part_number: int, expires_in: int = 300) -> Dict[str, Any]:
        """获取本地分块上传的URL"""
        try:
            # 验证upload_id是否存在
            metadata_file = self._get_multipart_metadata_file(upload_id)
            if not os.path.exists(metadata_file):
                raise Exception(f"Upload ID {upload_id} not found or expired")
            
            # 生成本地上传URL
            upload_url = f"{LOCAL_SERVER_URL}/multipart/upload/{upload_id}/{part_number}"
            
            expires_at = int(time.time()) + expires_in
            
            result = {
                "upload_url": upload_url,
                "part_number": part_number,
                "expires_at": expires_at
            }
            
            log_info(f"本地分块上传URL生成成功: upload_id={upload_id}, part_number={part_number}")
            return result
            
        except Exception as e:
            log_error(f"本地分块上传URL生成失败: {str(e)}")
            raise
    
    def complete_multipart_upload(self, key: str, upload_id: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """完成本地分块上传"""
        try:
            metadata_file = self._get_multipart_metadata_file(upload_id)
            multipart_dir = self._get_multipart_dir(upload_id)
            
            if not os.path.exists(metadata_file):
                raise Exception(f"Upload ID {upload_id} not found or expired")
            
            # 读取元数据
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # 验证key是否匹配
            if metadata['key'] != key:
                raise Exception(f"Key mismatch: expected {metadata['key']}, got {key}")
            
            # 按PartNumber排序
            sorted_parts = sorted(parts, key=lambda x: x['PartNumber'])
            
            # 获取最终文件路径
            final_file_path = self._get_file_path(key)
            self._ensure_directory_exists(final_file_path)
            
            # 合并所有分块
            total_size = 0
            with open(final_file_path, 'wb') as final_file:
                for part in sorted_parts:
                    part_number = part['PartNumber']
                    part_file = self._get_part_file(upload_id, part_number)
                    
                    if not os.path.exists(part_file):
                        raise Exception(f"Part {part_number} not found")
                    
                    with open(part_file, 'rb') as pf:
                        chunk_size = 8192
                        while True:
                            chunk = pf.read(chunk_size)
                            if not chunk:
                                break
                            final_file.write(chunk)
                            total_size += len(chunk)
            
            # 计算简单的ETag（使用文件大小和修改时间的组合）
            file_stat = os.stat(final_file_path)
            etag = f"{file_stat.st_size}-{int(file_stat.st_mtime)}"
            
            # 清理multipart目录
            try:
                shutil.rmtree(multipart_dir)
            except Exception as e:
                log_error(f"清理multipart目录失败: {str(e)}")
            
            result = {
                "success": True,
                "key": key,
                "size": total_size,
                "etag": etag
            }
            
            log_info(f"本地分块上传完成: key={key}, size={total_size}")
            return result
            
        except Exception as e:
            log_error(f"本地分块上传完成失败: {str(e)}")
            raise
    
    def abort_multipart_upload(self, key: str, upload_id: str) -> Dict[str, Any]:
        """中止本地分块上传"""
        try:
            multipart_dir = self._get_multipart_dir(upload_id)
            
            # 删除multipart目录及其所有内容
            if os.path.exists(multipart_dir):
                shutil.rmtree(multipart_dir)
            
            result = {
                "success": True,
                "upload_id": upload_id
            }
            
            log_info(f"本地分块上传中止成功: upload_id={upload_id}")
            return result
            
        except Exception as e:
            log_error(f"本地分块上传中止失败: {str(e)}")
            raise
    
    def list_multipart_uploads(self, prefix: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出进行中的本地分块上传"""
        try:
            uploads = []
            
            if not os.path.exists(self.multipart_path):
                return uploads
            
            for upload_dir in os.listdir(self.multipart_path):
                upload_path = os.path.join(self.multipart_path, upload_dir)
                metadata_file = os.path.join(upload_path, "metadata.json")
                
                if os.path.isdir(upload_path) and os.path.exists(metadata_file):
                    try:
                        with open(metadata_file, 'r', encoding='utf-8') as f:
                            metadata = json.load(f)
                        
                        # 应用前缀过滤
                        if prefix and not metadata['key'].startswith(prefix):
                            continue
                        
                        uploads.append({
                            "key": metadata['key'],
                            "upload_id": metadata['upload_id'],
                            "initiated": metadata['initiated']
                        })
                    except Exception as e:
                        log_error(f"读取multipart元数据失败: {str(e)}")
                        continue
            
            log_info(f"本地分块上传列表查询成功: 找到{len(uploads)}个进行中的上传")
            return uploads
            
        except Exception as e:
            log_error(f"本地分块上传列表查询失败: {str(e)}")
            raise
    
    def save_multipart_chunk(self, upload_id: str, part_number: int, chunk_data: bytes) -> Dict[str, Any]:
        """保存multipart分块数据（本地存储专用方法）"""
        try:
            metadata_file = self._get_multipart_metadata_file(upload_id)
            if not os.path.exists(metadata_file):
                raise Exception(f"Upload ID {upload_id} not found or expired")
            
            # 保存分块文件
            part_file = self._get_part_file(upload_id, part_number)
            with open(part_file, 'wb') as f:
                f.write(chunk_data)
            
            # 更新元数据
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # 计算简单的ETag（使用数据长度和时间戳）
            etag = f"{len(chunk_data)}-{int(time.time())}"
            metadata['parts'][str(part_number)] = {
                "size": len(chunk_data),
                "etag": etag,
                "last_modified": int(time.time())
            }
            
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2)
            
            result = {
                "success": True,
                "part_number": part_number,
                "etag": etag,
                "size": len(chunk_data)
            }
            
            log_info(f"本地分块保存成功: upload_id={upload_id}, part_number={part_number}, size={len(chunk_data)}")
            return result
            
        except Exception as e:
            log_error(f"本地分块保存失败: {str(e)}")
            raise

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
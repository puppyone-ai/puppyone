import os
import shutil
import uuid
import time
import sys
import json
import hashlib
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

from utils.config import config
from utils.logger import log_info, log_error, log_debug
from storage.base import StorageAdapter
from storage.exceptions import ConditionFailedError, FileNotFoundError as StorageFileNotFoundError

# 使用新的路径管理系统获取存储路径
LOCAL_STORAGE_PATH = config.get_path("STORAGE_ROOT")
# 优先使用 LOCAL_SERVER_URL；未配置时回退到 STORAGE_SERVER_URL，再退回 localhost
LOCAL_SERVER_URL = (
    config.get("LOCAL_SERVER_URL")
    or config.get("STORAGE_SERVER_URL", "http://localhost:8002")
)

class LocalStorageAdapter(StorageAdapter):
    def __init__(self):
        # Set local persistent directory - simplified storage with only final files
        self.base_path = os.path.join(LOCAL_STORAGE_PATH, "storage_files")
        
        # Ensure directory exists
        os.makedirs(self.base_path, exist_ok=True)
        
        log_info(f"Storage path: {self.base_path}")
        
    def _get_file_path(self, key: str) -> str:
        return os.path.join(self.base_path, key)
    
    def _ensure_directory_exists(self, file_path: str):
        directory = os.path.dirname(file_path)
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

    def generate_upload_url(self, key: str, content_type: str, expires_in: int = 300) -> str:
        # 注意：这是旧的API，新的分块上传应该使用 /upload/init 和 /upload/get_upload_url
        # 保留此方法是为了向后兼容
        return f"{LOCAL_SERVER_URL}/files/upload/{key}?content_type={content_type}"

    def generate_download_url(self, key: str, expires_in: int = 86400) -> str:
        # 注意：这是旧的API，新的下载应该使用 /download/url
        # 保留此方法是为了向后兼容
        return f"{LOCAL_SERVER_URL}/download/stream/{key}"

    def generate_delete_url(self, key: str, expires_in: int = 300) -> str:
        """生成删除文件的URL - 本地存储直接返回删除endpoint"""
        return f"{LOCAL_SERVER_URL}/files/delete/{key}"

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
    
    def _calculate_etag(self, file_path: str) -> str:
        """计算文件的ETag（使用MD5哈希）"""
        md5_hash = hashlib.md5()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                md5_hash.update(chunk)
        return md5_hash.hexdigest()
    
    def save_file(self, key: str, file_data: bytes, content_type: str, match_etag: Optional[str] = None) -> bool:
        """
        保存文件到本地存储，支持条件写入
        
        Args:
            key: 文件的存储路径
            file_data: 文件内容
            content_type: 文件的MIME类型
            match_etag: 可选的ETag值，用于乐观锁控制
            
        Returns:
            bool: 保存成功返回True
            
        Raises:
            ConditionFailedError: 当match_etag不匹配时
        """
        try:
            file_path = self._get_file_path(key)
            self._ensure_directory_exists(file_path)
            
            # 如果提供了match_etag，检查现有文件的ETag
            if match_etag is not None and os.path.exists(file_path):
                current_etag = self._calculate_etag(file_path)
                if current_etag != match_etag:
                    raise ConditionFailedError(f"ETag mismatch for key: {key}")
            
            # 写入文件
            with open(file_path, 'wb') as f:
                f.write(file_data)
            
            # 保存元数据（包括content_type）
            metadata_path = file_path + '.metadata'
            metadata = {
                'content_type': content_type,
                'etag': self._calculate_etag(file_path),
                'last_modified': datetime.now().isoformat()
            }
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f)
            
            log_info(f"File saved to local storage: {file_path}")
            return True
        except ConditionFailedError:
            raise
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
            
            # 尝试从元数据文件获取content_type
            metadata_path = file_path + '.metadata'
            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)
                        content_type = metadata.get('content_type', 'application/octet-stream')
                except:
                    content_type = self._infer_content_type(file_path)
            else:
                content_type = self._infer_content_type(file_path)
            
            return file_data, content_type
        except Exception as e:
            log_error(f"获取本地文件失败: {str(e)}")
            return None, None
    
    def _infer_content_type(self, file_path: str) -> str:
        """从文件扩展名推断内容类型"""
        ext = os.path.splitext(file_path)[1].lower()
        content_type_map = {
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
        }
        return content_type_map.get(ext, 'application/octet-stream')

    # === Multipart Upload Implementation ===
    
    def init_multipart_upload(self, key: str, content_type: Optional[str] = None) -> Dict[str, Any]:
        """
        初始化本地分块上传
        
        对于本地存储，我们创建一个临时目录来存储分块，
        并生成一个唯一的upload_id
        """
        try:
            upload_id = str(uuid.uuid4())
            
            # 创建临时目录存储分块
            temp_dir = os.path.join(self.base_path, ".multipart_uploads", upload_id)
            os.makedirs(temp_dir, exist_ok=True)
            
            # 保存上传元数据
            metadata = {
                "key": key,
                "content_type": content_type or "application/octet-stream",
                "created_at": time.time(),
                "parts": {}
            }
            
            metadata_file = os.path.join(temp_dir, "metadata.json")
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f)
            
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
        """
        获取本地分块上传的URL
        
        对于本地存储，返回指向我们自己服务器的上传端点
        """
        try:
            # 验证upload_id是否存在
            temp_dir = os.path.join(self.base_path, ".multipart_uploads", upload_id)
            if not os.path.exists(temp_dir):
                raise Exception(f"Upload ID {upload_id} not found")
            
            # 生成本地上传URL
            upload_url = f"{LOCAL_SERVER_URL}/upload/chunk/{upload_id}/{part_number}"
            
            expires_at = int(time.time()) + expires_in
            
            result = {
                "upload_url": upload_url,
                "part_number": part_number,
                "expires_at": expires_at
            }
            
            log_debug(f"本地分块上传URL生成成功: upload_id={upload_id}, part_number={part_number}")
            return result
            
        except Exception as e:
            log_error(f"本地分块上传URL生成失败: {str(e)}")
            raise
    
    def save_multipart_chunk(self, upload_id: str, part_number: int, chunk_data: bytes) -> Dict[str, Any]:
        """
        保存分块数据到本地临时存储
        
        这个方法由 /upload/chunk/{upload_id}/{part_number} 端点调用
        """
        try:
            temp_dir = os.path.join(self.base_path, ".multipart_uploads", upload_id)
            if not os.path.exists(temp_dir):
                raise Exception(f"Upload ID {upload_id} not found")
            
            # 保存分块文件
            part_file = os.path.join(temp_dir, f"part_{part_number:05d}")
            with open(part_file, 'wb') as f:
                f.write(chunk_data)
            
            # 计算ETag（MD5哈希）
            etag = hashlib.md5(chunk_data).hexdigest()
            
            # 更新元数据
            metadata_file = os.path.join(temp_dir, "metadata.json")
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            metadata["parts"][str(part_number)] = {
                "etag": etag,
                "size": len(chunk_data),
                "file": part_file
            }
            
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f)
            
            result = {
                "part_number": part_number,
                "etag": etag,
                "size": len(chunk_data)
            }
            
            log_debug(f"本地分块保存成功: upload_id={upload_id}, part_number={part_number}, size={len(chunk_data)}")
            return result
            
        except Exception as e:
            log_error(f"本地分块保存失败: {str(e)}")
            raise
    
    def complete_multipart_upload(self, key: str, upload_id: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        完成本地分块上传
        
        将所有分块合并为最终文件
        """
        try:
            temp_dir = os.path.join(self.base_path, ".multipart_uploads", upload_id)
            if not os.path.exists(temp_dir):
                raise Exception(f"Upload ID {upload_id} not found")
            
            # 读取元数据
            metadata_file = os.path.join(temp_dir, "metadata.json")
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            # 验证所有分块都存在
            for part in parts:
                part_number = str(part['PartNumber'])
                if part_number not in metadata["parts"]:
                    raise Exception(f"Part {part_number} not found")
                if metadata["parts"][part_number]["etag"] != part['ETag']:
                    raise Exception(f"ETag mismatch for part {part_number}")
            
            # 确保目标目录存在
            final_file_path = self._get_file_path(key)
            self._ensure_directory_exists(final_file_path)
            
            # 合并分块
            total_size = 0
            with open(final_file_path, 'wb') as final_file:
                # 按part_number顺序合并
                for part in sorted(parts, key=lambda x: x['PartNumber']):
                    part_number = str(part['PartNumber'])
                    part_info = metadata["parts"][part_number]
                    part_file = part_info["file"]
                    
                    with open(part_file, 'rb') as pf:
                        chunk_data = pf.read()
                        final_file.write(chunk_data)
                        total_size += len(chunk_data)
            
            # 计算最终文件的ETag
            final_etag = self._calculate_etag(final_file_path)
            
            # 保存元数据
            content_type = metadata.get("content_type", "application/octet-stream")
            metadata_path = final_file_path + '.metadata'
            file_metadata = {
                'content_type': content_type,
                'etag': final_etag,
                'last_modified': datetime.now().isoformat()
            }
            with open(metadata_path, 'w') as f:
                json.dump(file_metadata, f)
            
            # 清理临时文件
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                log_error(f"清理临时目录失败: {str(e)}")
            
            result = {
                "success": True,
                "key": key,
                "size": total_size,
                "etag": final_etag
            }
            
            log_info(f"本地分块上传完成: key={key}, size={total_size}")
            return result
            
        except Exception as e:
            log_error(f"本地分块上传完成失败: {str(e)}")
            raise
    
    def abort_multipart_upload(self, key: str, upload_id: str) -> Dict[str, Any]:
        """
        中止本地分块上传
        
        删除所有临时文件
        """
        try:
            temp_dir = os.path.join(self.base_path, ".multipart_uploads", upload_id)
            
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
                log_info(f"本地分块上传中止成功: key={key}, upload_id={upload_id}")
            else:
                log_info(f"本地分块上传已不存在，视为中止成功: key={key}, upload_id={upload_id}")
            
            result = {
                "success": True,
                "upload_id": upload_id
            }
            
            return result
            
        except Exception as e:
            log_error(f"本地分块上传中止失败: {str(e)}")
            raise
    
    def list_multipart_uploads(self, prefix: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        列出进行中的本地分块上传
        """
        try:
            uploads = []
            multipart_dir = os.path.join(self.base_path, ".multipart_uploads")
            
            if not os.path.exists(multipart_dir):
                return uploads
            
            for upload_id in os.listdir(multipart_dir):
                upload_dir = os.path.join(multipart_dir, upload_id)
                if not os.path.isdir(upload_dir):
                    continue
                
                metadata_file = os.path.join(upload_dir, "metadata.json")
                if not os.path.exists(metadata_file):
                    continue
                
                try:
                    with open(metadata_file, 'r') as f:
                        metadata = json.load(f)
                    
                    key = metadata.get("key", "")
                    
                    # 如果指定了前缀，过滤不匹配的
                    if prefix and not key.startswith(prefix):
                        continue
                    
                    uploads.append({
                        "key": key,
                        "upload_id": upload_id,
                        "initiated": int(metadata.get("created_at", 0))
                    })
                    
                except Exception as e:
                    log_error(f"读取上传元数据失败: {upload_id}, {str(e)}")
                    continue
            
            log_debug(f"本地分块上传列表查询成功: 找到{len(uploads)}个进行中的上传")
            return uploads
            
        except Exception as e:
            log_error(f"本地分块上传列表查询失败: {str(e)}")
            raise

    # === Direct Chunk Storage Implementation (Simplified) ===
    
    def save_chunk_direct(self, key: str, chunk_data: bytes, content_type: str = "application/octet-stream") -> Dict[str, Any]:
        """
        直接保存chunk到最终存储位置
        这是简化后的存储方案，不涉及multipart合并
        """
        try:
            # 使用现有的save_file方法直接保存
            success = self.save_file(key, chunk_data, content_type)
            
            if success:
                # 计算ETag
                file_path = self._get_file_path(key)
                etag = self._calculate_etag(file_path)
                
                result = {
                    "success": True,
                    "key": key,
                    "etag": etag,
                    "size": len(chunk_data),
                    "content_type": content_type,
                    "uploaded_at": int(time.time())
                }
                
                log_info(f"直接chunk保存成功: key={key}, size={len(chunk_data)}")
                return result
            else:
                raise Exception("保存文件失败")
                
        except Exception as e:
            log_error(f"直接chunk保存失败: key={key}, error={str(e)}")
            raise
    
    # === 新增的下载协调器方法 ===
    
    def get_download_url(self, key: str, expires_in: int = 3600) -> dict:
        """
        生成下载URL（新的协调器模式）
        
        对于本地存储，返回指向 /download/stream/{key} 的URL
        """
        try:
            # 检查文件是否存在
            if not self.check_file_exists(key):
                raise FileNotFoundError(f"File not found: {key}")
            
            # 生成本地流式传输URL
            download_url = f"{LOCAL_SERVER_URL}/download/stream/{key}"
            
            return {
                "download_url": download_url,
                "key": key,
                "expires_at": int(time.time()) + expires_in
            }
        except Exception as e:
            log_error(f"生成本地下载URL失败: {str(e)}")
            raise
    
    def _resolve_safe_path(self, key: str) -> str:
        """
        安全地解析文件路径，防止路径遍历攻击
        """
        # 规范化路径，移除 '..' 等
        normalized_key = os.path.normpath(key)
        
        # 禁止使用绝对路径或向上遍历的路径
        if os.path.isabs(normalized_key) or normalized_key.startswith('..'):
            raise PermissionError("非法路径格式")

        # 构建完整路径
        full_path = os.path.join(self.base_path, normalized_key)

        # 再次规范化，并校验最终路径是否仍在我们的存储根目录之下
        real_base = os.path.realpath(self.base_path)
        real_full = os.path.realpath(full_path)
        
        if not real_full.startswith(real_base):
            raise PermissionError("禁止访问存储目录之外的路径")
            
        return full_path
    
    async def stream_from_disk(self, key: str, range_header: Optional[str] = None):
        """
        从磁盘流式传输文件
        
        支持HTTP Range请求，用于实现分段下载
        """
        try:
            # 使用安全路径解析
            file_path = self._resolve_safe_path(key)
            
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {key}")
            
            file_size = os.path.getsize(file_path)
            start, end = 0, file_size - 1
            status_code = 200
            content_range = None
            
            # 解析Range请求头
            if range_header:
                try:
                    range_str = range_header.replace("bytes=", "")
                    start_str, end_str = range_str.split("-", 1)
                    
                    if start_str:
                        start = int(start_str)
                    if end_str:
                        end = int(end_str)
                    else:
                        end = file_size - 1
                    
                    # 验证范围有效性
                    if start < 0 or start >= file_size:
                        raise ValueError("Invalid range start")
                    if end >= file_size:
                        end = file_size - 1
                    if start > end:
                        raise ValueError("Invalid range: start > end")
                    
                    status_code = 206  # Partial Content
                    content_range = f"bytes {start}-{end}/{file_size}"
                    
                except (ValueError, IndexError) as e:
                    # 如果Range头格式错误，返回整个文件
                    log_error(f"无效的Range请求头: {range_header}, 错误: {str(e)}")
                    start, end = 0, file_size - 1
                    status_code = 200
                    content_range = None
            
            # 创建文件迭代器
            async def file_iterator():
                try:
                    with open(file_path, "rb") as f:
                        f.seek(start)
                        bytes_to_read = (end - start) + 1
                        chunk_size = 65536  # 64KB chunks
                        
                        while bytes_to_read > 0:
                            chunk_size_to_read = min(chunk_size, bytes_to_read)
                            chunk = f.read(chunk_size_to_read)
                            if not chunk:
                                break
                            bytes_to_read -= len(chunk)
                            yield chunk
                except Exception as e:
                    log_error(f"文件流式传输过程中发生错误: {str(e)}")
                    raise
            
            # 返回实际读取的字节数
            actual_size = (end - start) + 1 if status_code == 206 else file_size
            
            return file_iterator(), status_code, content_range, actual_size
            
        except PermissionError as e:
            log_error(f"路径遍历攻击尝试被阻止: key={key}")
            raise
        except FileNotFoundError:
            log_error(f"本地文件不存在: {key}")
            raise
        except Exception as e:
            log_error(f"本地文件流式传输失败: {str(e)}")
            raise
    
    def get_file_with_metadata(self, key: str) -> Tuple[bytes, str, Optional[str]]:
        """
        获取文件内容、类型和ETag
        
        Returns:
            Tuple[bytes, str, Optional[str]]: (文件内容, 内容类型, ETag)
        """
        try:
            file_path = self._get_file_path(key)
            if not os.path.exists(file_path):
                raise StorageFileNotFoundError(f"File not found: {key}")
            
            # 读取文件内容
            with open(file_path, 'rb') as f:
                file_data = f.read()
            
            # 读取元数据
            metadata_path = file_path + '.metadata'
            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)
                        content_type = metadata.get('content_type', 'application/octet-stream')
                        etag = metadata.get('etag')
                except:
                    content_type = self._infer_content_type(file_path)
                    etag = self._calculate_etag(file_path)
            else:
                content_type = self._infer_content_type(file_path)
                etag = self._calculate_etag(file_path)
            
            return file_data, content_type, etag
            
        except StorageFileNotFoundError:
            raise
        except Exception as e:
            log_error(f"获取本地文件失败: {str(e)}")
            raise
    
    def list_objects(self, prefix: str, delimiter: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        列出指定前缀下的对象，模拟S3的list_objects_v2行为
        
        Args:
            prefix: 对象键的前缀
            delimiter: 分隔符，用于模拟目录结构
            
        Returns:
            List[Dict[str, Any]]: 对象列表
        """
        try:
            results = []
            prefix_path = os.path.join(self.base_path, prefix.lstrip('/'))
            
            # 如果前缀路径不存在，返回空列表
            if not os.path.exists(prefix_path):
                return results
            
            # 用于存储已经添加的公共前缀
            common_prefixes = set()
            
            # 遍历目录
            for root, dirs, files in os.walk(prefix_path):
                # 计算相对路径
                rel_root = os.path.relpath(root, self.base_path)
                if rel_root == '.':
                    rel_root = ''
                
                # 如果使用了delimiter，需要模拟S3的行为
                if delimiter:
                    # 计算当前目录相对于prefix的路径
                    rel_path = os.path.relpath(root, prefix_path)
                    if rel_path == '.':
                        rel_path = ''
                    
                    # 如果当前目录不是prefix本身，且包含delimiter，则只处理第一级
                    if rel_path and delimiter in rel_path:
                        # 获取第一级目录名
                        first_level = rel_path.split(delimiter)[0]
                        common_prefix = os.path.join(prefix, first_level, '').replace('\\', '/')
                        if common_prefix not in common_prefixes:
                            common_prefixes.add(common_prefix)
                            results.append({"prefix": common_prefix})
                        continue
                    
                    # 处理当前目录下的子目录（作为公共前缀）
                    for dir_name in dirs:
                        dir_key = os.path.join(rel_root, dir_name, '').replace('\\', '/')
                        if dir_key.startswith(prefix):
                            common_prefix = dir_key
                            if common_prefix not in common_prefixes:
                                common_prefixes.add(common_prefix)
                                results.append({"prefix": common_prefix})
                
                # 处理文件
                for filename in files:
                    # 跳过元数据文件
                    if filename.endswith('.metadata'):
                        continue
                    
                    file_key = os.path.join(rel_root, filename).replace('\\', '/')
                    
                    # 只包含匹配前缀的文件
                    if file_key.startswith(prefix):
                        # 如果使用了delimiter，检查文件是否在当前"目录"级别
                        if delimiter:
                            rel_path = file_key[len(prefix):]
                            if delimiter in rel_path:
                                continue
                        
                        file_path = os.path.join(root, filename)
                        file_stat = os.stat(file_path)
                        
                        results.append({
                            "key": file_key,
                            "size": file_stat.st_size,
                            "last_modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                        })
                
                # 如果使用了delimiter，不递归子目录
                if delimiter:
                    dirs.clear()
            
            return results
            
        except Exception as e:
            log_error(f"列出本地对象失败: {str(e)}")
            raise

    def ping(self) -> Dict[str, Any]:
        """
        轻量健康检查：确认基础目录存在且可写。
        """
        try:
            # 目录存在性
            os.makedirs(self.base_path, exist_ok=True)
            # 可写性测试（不落地大文件，仅touch并删除）
            test_dir = os.path.join(self.base_path, ".health")
            os.makedirs(test_dir, exist_ok=True)
            test_file = os.path.join(test_dir, "ping.tmp")
            with open(test_file, "w") as f:
                f.write("ok")
            os.remove(test_file)
            return {"ok": True, "type": "local", "base_path": self.base_path}
        except Exception as e:
            log_error(f"Local storage ping failed: {str(e)}")
            return {"ok": False, "type": "local", "error": str(e)}

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
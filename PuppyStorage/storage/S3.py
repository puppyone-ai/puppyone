from boto3 import client
from botocore.config import Config
import os
import sys
import logging
import uuid
import time
from urllib.parse import quote
from typing import Optional, Dict, Any, List

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

# 配置 boto3 日志，只记录警告和错误
boto3_logger = logging.getLogger('boto3')
boto3_logger.setLevel(logging.WARNING)
botocore_logger = logging.getLogger('botocore')
botocore_logger.setLevel(logging.WARNING)

from utils.config import config
from utils.logger import log_error, log_info, log_debug
from utils.file_utils import build_content_disposition_header, extract_filename_from_key
from storage.base import StorageAdapter

class S3StorageAdapter(StorageAdapter):
    def __init__(self):
        try:
            endpoint_url = config.get("CLOUDFLARE_R2_ENDPOINT")
            access_key_id = config.get("CLOUDFLARE_R2_ACCESS_KEY_ID")
            secret_access_key = config.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
            bucket = config.get("CLOUDFLARE_R2_BUCKET")
            
            # Optional: External endpoint for presigned URLs (for host network access in E2E tests)
            # If set, this endpoint will be used to generate presigned URLs
            # Internal endpoint is used for S3 operations (upload, download, etc.)
            external_endpoint = config.get("CLOUDFLARE_R2_EXTERNAL_ENDPOINT")
            
            # Print configuration information (excluding sensitive data)
            if external_endpoint:
                log_info(f"Initializing S3 client with dual endpoints - operations: {endpoint_url}, presigned URLs: {external_endpoint}, bucket: {bucket}")
            else:
                log_info(f"Initializing S3 client, endpoint: {endpoint_url}, bucket: {bucket}")
            
            # S3 client for operations (using internal endpoint)
            self.s3_client = client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                region_name="auto",
                config=Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3},
                    connect_timeout=5,
                    read_timeout=60
                )
            )
            
            # S3 client for presigned URLs (using external endpoint if provided)
            # This is necessary because presigned URL signatures are cryptographically
            # tied to the endpoint used during generation. Simply replacing the hostname
            # in a presigned URL will break the signature verification.
            if external_endpoint:
                self.s3_presigned_client = client(
                    's3',
                    endpoint_url=external_endpoint,
                    aws_access_key_id=access_key_id,
                    aws_secret_access_key=secret_access_key,
                    region_name="auto",
                    config=Config(
                        signature_version='s3v4',
                        retries={'max_attempts': 3},
                        connect_timeout=5,
                        read_timeout=60
                    )
                )
            else:
                # Use same client for both if no external endpoint specified
                self.s3_presigned_client = self.s3_client
            
            self.bucket = bucket
            log_info(f"Using S3 storage, bucket: {self.bucket}")
        except Exception as e:
            log_error(f"初始化S3客户端失败: {str(e)}")
            raise

    def ping(self) -> Dict[str, Any]:
        """
        轻量健康检查：最小权限探测存储可用性。
        优先使用 list_objects_v2(Bucket, MaxKeys=1) 以避免需要 ListAllMyBuckets 权限。
        """
        try:
            # 最小读取：尝试列出当前 bucket 的一个对象
            self.s3_client.list_objects_v2(Bucket=self.bucket, MaxKeys=1)
            return {"ok": True, "type": "s3", "bucket": self.bucket}
        except Exception as e:
            log_error(f"S3 storage ping failed: {str(e)}")
            return {"ok": False, "type": "s3", "bucket": self.bucket, "error": str(e)}

    def generate_upload_url(self, key: str, content_type: str, expires_in: int = 300) -> str:
        # Use presigned client (which uses external endpoint if configured)
        return self.s3_presigned_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': self.bucket,
                'Key': key,
                'ContentType': content_type
            },
            ExpiresIn=expires_in
        )

    def generate_download_url(self, key: str, expires_in: int = 86400) -> str:
        # 从key中提取文件名
        filename = extract_filename_from_key(key)
        
        # 构建符合RFC 6266标准的Content-Disposition头
        content_disposition = build_content_disposition_header(filename)
        
        # 生成包含正确Content-Disposition的预签名URL
        # Use presigned client (which uses external endpoint if configured)
        return self.s3_presigned_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': self.bucket,
                'Key': key,
                'ResponseContentDisposition': content_disposition
            },
            ExpiresIn=expires_in
        )

    def generate_delete_url(self, key: str, expires_in: int = 300) -> str:
        """生成删除文件的预签名URL"""
        # Use presigned client (which uses external endpoint if configured)
        return self.s3_presigned_client.generate_presigned_url(
            'delete_object',
            Params={
                'Bucket': self.bucket,
                'Key': key
            },
            ExpiresIn=expires_in
        )

    def delete_file(self, key: str) -> bool:
        try:
            self.s3_client.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as e:
            log_error(f"删除S3文件失败: {str(e)}")
            return False

    def copy_resource(self, source_key: str, target_key: str) -> bool:
        """使用S3 server-side copy复制资源"""
        try:
            copy_source = {
                'Bucket': self.bucket,
                'Key': source_key
            }
            
            self.s3_client.copy_object(
                CopySource=copy_source,
                Bucket=self.bucket,
                Key=target_key
            )
            
            log_info(f"S3 copy succeeded: {source_key} -> {target_key}")
            return True
            
        except Exception as e:
            log_error(f"S3 copy failed: {source_key} -> {target_key}, error: {str(e)}")
            return False

    def check_file_exists(self, key: str) -> bool:
        try:
            self.s3_client.head_object(Bucket=self.bucket, Key=key)
            return True
        except:
            return False
            
    def save_file(self, key: str, file_data: bytes, content_type: str, match_etag: Optional[str] = None) -> bool:
        """
        保存文件到S3，支持条件写入
        
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
            log_info(f"Attempting to upload file to S3: {key}, content type: {content_type}, bucket: {self.bucket}")
            
            params = {
                'Bucket': self.bucket,
                'Key': key,
                'Body': file_data,
                'ContentType': content_type
            }
            
            # 如果提供了match_etag，添加条件写入参数
            if match_etag is not None:
                params['IfMatch'] = match_etag
                
            self.s3_client.put_object(**params)
            log_info(f"File uploaded to S3: {key}")
            return True
            
        except self.s3_client.exceptions.ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'PreconditionFailed':
                # ETag不匹配，抛出自定义异常
                from storage.exceptions import ConditionFailedError
                raise ConditionFailedError(f"ETag mismatch for key: {key}")
            else:
                log_error(f"Failed to upload file to S3: {str(e)}")
                if hasattr(e, 'response'):
                    log_error(f"Error response: {e.response}")
                return False
        except Exception as e:
            log_error(f"Failed to upload file to S3: {str(e)}")
            return False
    
    def get_file(self, key: str) -> tuple:
        try:
            response = self.s3_client.get_object(Bucket=self.bucket, Key=key)
            file_data = response['Body'].read()
            content_type = response.get('ContentType', 'application/octet-stream')
            return file_data, content_type
        except self.s3_client.exceptions.NoSuchKey:
            # 文件不存在是正常情况，使用DEBUG级别日志
            log_debug(f"请求的S3文件不存在: {key}")
            return None, None
        except Exception as e:
            # 其他错误才使用ERROR级别日志
            log_error(f"从S3获取文件失败: {str(e)}")
            return None, None

    # === Multipart Upload Coordinator Implementation ===
    
    def init_multipart_upload(self, key: str, content_type: Optional[str] = None) -> Dict[str, Any]:
        """初始化S3分块上传"""
        try:
            params = {
                'Bucket': self.bucket,
                'Key': key
            }
            if content_type:
                params['ContentType'] = content_type
            
            response = self.s3_client.create_multipart_upload(**params)
            upload_id = response['UploadId']
            
            # 计算过期时间（24小时后）
            import time
            expires_at = int(time.time()) + (24 * 60 * 60)
            
            result = {
                "upload_id": upload_id,
                "key": key,
                "expires_at": expires_at,
                "max_parts": 10000,  # S3最大分块数量
                "min_part_size": 5 * 1024 * 1024  # 5MB（除最后一块外）
            }
            
            log_info(f"S3分块上传初始化成功: key={key}, upload_id={upload_id}")
            return result
            
        except Exception as e:
            log_error(f"S3分块上传初始化失败: {str(e)}")
            raise
    
    def get_multipart_upload_url(self, key: str, upload_id: str, part_number: int, expires_in: int = 300) -> Dict[str, Any]:
        """获取S3分块上传的预签名URL"""
        try:
            # 首先验证上传是否还存在
            try:
                self.s3_client.list_parts(
                    Bucket=self.bucket,
                    Key=key,
                    UploadId=upload_id,
                    MaxParts=1
                )
            except self.s3_client.exceptions.NoSuchUpload:
                raise Exception(f"Upload ID {upload_id} not found or has been aborted")
            
            # Use presigned client (which uses external endpoint if configured)
            upload_url = self.s3_presigned_client.generate_presigned_url(
                'upload_part',
                Params={
                    'Bucket': self.bucket,
                    'Key': key,
                    'UploadId': upload_id,
                    'PartNumber': part_number
                },
                ExpiresIn=expires_in
            )
            
            import time
            expires_at = int(time.time()) + expires_in
            
            result = {
                "upload_url": upload_url,
                "part_number": part_number,
                "expires_at": expires_at
            }
            
            log_debug(f"S3分块上传URL生成成功: key={key}, part_number={part_number}")
            return result
            
        except Exception as e:
            log_error(f"S3分块上传URL生成失败: {str(e)}")
            raise
    
    def complete_multipart_upload(self, key: str, upload_id: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """完成S3分块上传"""
        try:
            # 构建parts列表，S3要求按PartNumber排序
            multipart_upload = {
                'Parts': sorted(parts, key=lambda x: x['PartNumber'])
            }
            
            response = self.s3_client.complete_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload=multipart_upload
            )
            
            # 获取文件大小（可选）
            try:
                head_response = self.s3_client.head_object(Bucket=self.bucket, Key=key)
                file_size = head_response.get('ContentLength', 0)
            except:
                file_size = 0
            
            result = {
                "success": True,
                "key": key,
                "size": file_size,
                "etag": response.get('ETag', '').strip('"')
            }
            
            log_info(f"S3分块上传完成: key={key}, size={file_size}")
            return result
            
        except Exception as e:
            log_error(f"S3分块上传完成失败: {str(e)}")
            raise
    
    def abort_multipart_upload(self, key: str, upload_id: str) -> Dict[str, Any]:
        """中止S3分块上传"""
        try:
            self.s3_client.abort_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id
            )
            
            result = {
                "success": True,
                "upload_id": upload_id
            }
            
            log_info(f"S3分块上传中止成功: key={key}, upload_id={upload_id}")
            return result
            
        except self.s3_client.exceptions.NoSuchUpload:
            # 上传已经不存在，视为成功
            log_info(f"S3分块上传已不存在，视为中止成功: key={key}, upload_id={upload_id}")
            return {
                "success": True,
                "upload_id": upload_id
            }
        except Exception as e:
            log_error(f"S3分块上传中止失败: {str(e)}")
            raise
    
    def list_multipart_uploads(self, prefix: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出进行中的S3分块上传"""
        try:
            params = {'Bucket': self.bucket}
            if prefix:
                params['Prefix'] = prefix
            
            response = self.s3_client.list_multipart_uploads(**params)
            
            uploads = []
            for upload in response.get('Uploads', []):
                uploads.append({
                    "key": upload['Key'],
                    "upload_id": upload['UploadId'],
                    "initiated": int(upload['Initiated'].timestamp())
                })
            
            log_debug(f"S3分块上传列表查询成功: 找到{len(uploads)}个进行中的上传")
            return uploads
            
        except Exception as e:
            log_error(f"S3分块上传列表查询失败: {str(e)}")
            raise
    
    # === 新增的下载协调器方法 ===
    
    def get_download_url(self, key: str, expires_in: int = 3600) -> dict:
        """
        生成下载URL（新的协调器模式）
        
        对于S3存储，返回一个有时效的预签名下载URL
        """
        try:
            # Use presigned client (which uses external endpoint if configured)
            download_url = self.s3_presigned_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket, 'Key': key},
                ExpiresIn=expires_in
            )
            
            log_debug(f"S3预签名下载URL生成成功: key={key}, expires_in={expires_in}")
            
            return {
                "download_url": download_url,
                "key": key,
                "expires_at": int(time.time()) + expires_in
            }
            
        except Exception as e:
            log_error(f"S3预签名下载URL生成失败: {str(e)}")
            raise
    
    async def stream_from_disk(self, key: str, range_header: Optional[str] = None):
        """
        对于S3存储适配器，此方法不适用
        
        S3存储的流式传输通过预签名URL直接与S3服务进行，
        不需要通过服务器中转
        """
        raise NotImplementedError(
            "stream_from_disk is not implemented for S3StorageAdapter. "
            "Use get_download_url to get a presigned URL for direct S3 access."
        )
    
    def get_file_with_metadata(self, key: str) -> tuple:
        """
        获取文件内容、类型和ETag
        
        Returns:
            tuple: (文件内容, 内容类型, ETag)
        """
        try:
            response = self.s3_client.get_object(Bucket=self.bucket, Key=key)
            file_data = response['Body'].read()
            content_type = response.get('ContentType', 'application/octet-stream')
            # S3返回的ETag包含引号，需要去除
            etag = response.get('ETag', '').strip('"')
            return file_data, content_type, etag
        except self.s3_client.exceptions.NoSuchKey:
            log_debug(f"请求的S3文件不存在: {key}")
            raise FileNotFoundError(f"File not found: {key}")
        except Exception as e:
            log_error(f"从S3获取文件失败: {str(e)}")
            raise
    
    def list_objects(self, prefix: str, delimiter: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        列出指定前缀下的对象
        
        Args:
            prefix: 对象键的前缀
            delimiter: 分隔符，用于模拟目录结构
            
        Returns:
            List[Dict[str, Any]]: 对象列表
        """
        try:
            params = {
                'Bucket': self.bucket,
                'Prefix': prefix
            }
            
            if delimiter:
                params['Delimiter'] = delimiter
            
            results = []
            
            # 使用分页处理大量对象
            paginator = self.s3_client.get_paginator('list_objects_v2')
            page_iterator = paginator.paginate(**params)
            
            for page in page_iterator:
                # 添加文件对象
                for content in page.get('Contents', []):
                    results.append({
                        "key": content['Key'],
                        "size": content['Size'],
                        "last_modified": content['LastModified'].isoformat() if hasattr(content['LastModified'], 'isoformat') else str(content['LastModified'])
                    })
                
                # 添加"目录"（公共前缀）
                for common_prefix in page.get('CommonPrefixes', []):
                    results.append({
                        "prefix": common_prefix['Prefix']
                    })
            
            return results
            
        except Exception as e:
            log_error(f"列出S3对象失败: {str(e)}")
            raise
    
    # === Direct Chunk Storage Implementation ===
    
    def save_chunk_direct(self, key: str, chunk_data: bytes, content_type: str = "application/octet-stream") -> Dict[str, Any]:
        """
        直接保存chunk到S3存储
        这是简化后的存储方案，不涉及multipart合并
        """
        try:
            # 使用现有的save_file方法直接保存到S3
            success = self.save_file(key, chunk_data, content_type)
            
            if success:
                # 获取文件的ETag
                try:
                    response = self.s3_client.head_object(Bucket=self.bucket, Key=key)
                    etag = response.get('ETag', '').strip('"')
                except:
                    # 如果获取失败，生成一个ETag
                    etag = uuid.uuid4().hex
                
                result = {
                    "success": True,
                    "key": key,
                    "etag": etag,
                    "size": len(chunk_data),
                    "content_type": content_type,
                    "uploaded_at": int(time.time())
                }
                
                log_info(f"直接chunk保存到S3成功: key={key}, size={len(chunk_data)}")
                return result
            else:
                raise Exception("保存文件到S3失败")
                
        except Exception as e:
            log_error(f"直接chunk保存到S3失败: key={key}, error={str(e)}")
            raise

if __name__ == "__main__":
    import unittest
    
    # 创建S3存储适配器实例
    adapter = S3StorageAdapter()
    
    # 生成唯一的测试键前缀，避免与其他测试冲突
    test_prefix = f"test/{uuid.uuid4()}"
    
    # 检查是否有有效的凭证
    has_valid_credentials = all([
        config.get("CLOUDFLARE_R2_BUCKET"),
        config.get("CLOUDFLARE_R2_ENDPOINT"),
        config.get("CLOUDFLARE_R2_ACCESS_KEY_ID"),
        config.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
    ])
    
    class TestS3StorageAdapter(unittest.TestCase):
        def setUp(self):
            # 如果没有有效的凭证，跳过所有测试
            if not has_valid_credentials:
                self.skipTest("没有有效的Cloudflare R2凭证，跳过测试")
            
        def tearDown(self):
            # 清理测试文件
            try:
                # 尝试列出并删除测试前缀下的所有文件
                response = adapter.s3_client.list_objects_v2(
                    Bucket=adapter.bucket,
                    Prefix=test_prefix
                )
                
                if 'Contents' in response:
                    for obj in response['Contents']:
                        try:
                            adapter.s3_client.delete_object(
                                Bucket=adapter.bucket,
                                Key=obj['Key']
                            )
                        except Exception as e:
                            print(f"删除文件 {obj['Key']} 时出错: {str(e)}")
            except Exception as e:
                print(f"清理测试文件时出错: {str(e)}")
            
        def test_save_and_get_file(self):
            # 测试保存和获取文件
            test_key = f"{test_prefix}/save_test.txt"
            test_data = b"Test data for S3"
            content_type = "text/plain"
            
            # 保存文件
            try:
                result = adapter.save_file(test_key, test_data, content_type)
                self.assertTrue(result, "保存文件失败")
            except Exception as e:
                self.fail(f"保存文件时出错: {str(e)}")
            
            # 检查文件是否存在
            try:
                exists = adapter.check_file_exists(test_key)
                self.assertTrue(exists, "文件不存在")
            except Exception as e:
                self.fail(f"检查文件是否存在时出错: {str(e)}")
            
            # 获取文件
            try:
                data, retrieved_type = adapter.get_file(test_key)
                self.assertEqual(data, test_data, "获取的文件内容不匹配")
                self.assertEqual(retrieved_type, content_type, "获取的文件类型不匹配")
            except Exception as e:
                self.fail(f"获取文件时出错: {str(e)}")
            
        def test_delete_file(self):
            # 测试删除文件
            test_key = f"{test_prefix}/delete_test.txt"
            test_data = b"Test data for deletion"
            
            # 保存文件
            try:
                save_result = adapter.save_file(test_key, test_data, "text/plain")
                self.assertTrue(save_result, "保存文件失败")
            except Exception as e:
                self.fail(f"保存文件时出错: {str(e)}")
            
            # 删除文件
            try:
                result = adapter.delete_file(test_key)
                self.assertTrue(result, "删除文件失败")
            except Exception as e:
                self.fail(f"删除文件时出错: {str(e)}")
            
            # 检查文件是否已被删除
            try:
                exists = adapter.check_file_exists(test_key)
                self.assertFalse(exists, "文件仍然存在")
            except Exception as e:
                self.fail(f"检查文件是否存在时出错: {str(e)}")
            
        def test_generate_urls(self):
            # 测试生成上传和下载URL
            test_key = f"{test_prefix}/url_test.txt"
            content_type = "text/plain"
            
            # 生成上传URL
            try:
                upload_url = adapter.generate_upload_url(test_key, content_type)
                self.assertIsInstance(upload_url, str, "上传URL不是字符串")
                self.assertIn(adapter.bucket, upload_url, "上传URL不包含存储桶名称")
                self.assertIn(test_key, upload_url, "上传URL不包含文件键")
            except Exception as e:
                self.fail(f"生成上传URL时出错: {str(e)}")
            
            # 生成下载URL
            try:
                download_url = adapter.generate_download_url(test_key)
                self.assertIsInstance(download_url, str, "下载URL不是字符串")
                # 验证这是一个S3预签名URL（包含必要的参数）
                self.assertIn("X-Amz-Algorithm", download_url, "下载URL应该是S3预签名URL")
                self.assertIn("response-content-disposition", download_url, "下载URL应该包含Content-Disposition参数")
            except Exception as e:
                self.fail(f"生成下载URL时出错: {str(e)}")
            
            # 生成删除URL
            try:
                delete_url = adapter.generate_delete_url(test_key)
                self.assertIsInstance(delete_url, str, "删除URL不是字符串")
                self.assertIn(adapter.bucket, delete_url, "删除URL不包含存储桶名称")
                self.assertIn(test_key, delete_url, "删除URL不包含文件键")
            except Exception as e:
                self.fail(f"生成删除URL时出错: {str(e)}")
            
        def test_get_nonexistent_file(self):
            # 测试获取不存在的文件
            nonexistent_key = f"{test_prefix}/nonexistent.txt"
            try:
                data, content_type = adapter.get_file(nonexistent_key)
                self.assertIsNone(data, "获取不存在的文件应该返回None")
                self.assertIsNone(content_type, "获取不存在的文件应该返回None")
            except Exception as e:
                self.fail(f"获取不存在的文件时出错: {str(e)}")
    
    # 运行测试
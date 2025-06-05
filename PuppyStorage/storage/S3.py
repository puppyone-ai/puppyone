from boto3 import client
from botocore.config import Config
import os
import sys
import logging
import uuid

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
from storage.base import StorageAdapter


class S3StorageAdapter(StorageAdapter):
    def __init__(self):
        try:
            endpoint_url = config.get("CLOUDFLARE_R2_ENDPOINT")
            access_key_id = config.get("CLOUDFLARE_R2_ACCESS_KEY_ID")
            secret_access_key = config.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
            bucket = config.get("CLOUDFLARE_R2_BUCKET")
            
            # 打印配置信息（不包含敏感信息）
            log_info(f"初始化S3客户端，端点: {endpoint_url}, 存储桶: {bucket}")
            
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
            self.bucket = bucket
            log_info(f"使用S3存储，存储桶: {self.bucket}")
        except Exception as e:
            log_error(f"初始化S3客户端失败: {str(e)}")
            raise

    def generate_upload_url(self, key: str, content_type: str, expires_in: int = 300) -> str:
        return self.s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': self.bucket,
                'Key': key,
                'ContentType': content_type
            },
            ExpiresIn=expires_in
        )

    def generate_download_url(self, key: str, expires_in: int = 86400) -> str:
        return self.s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': self.bucket,
                'Key': key
            },
            ExpiresIn=expires_in
        )

    def generate_delete_url(self, key: str, expires_in: int = 300) -> str:
        """生成删除文件的预签名URL"""
        return self.s3_client.generate_presigned_url(
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

    def check_file_exists(self, key: str) -> bool:
        try:
            self.s3_client.head_object(Bucket=self.bucket, Key=key)
            return True
        except:
            return False
            
    def save_file(self, key: str, file_data: bytes, content_type: str) -> bool:
        try:
            log_info(f"尝试上传文件到S3: {key}, 内容类型: {content_type}, 存储桶: {self.bucket}")
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=file_data,
                ContentType=content_type
            )
            log_info(f"文件已上传到S3: {key}")
            return True
        except Exception as e:
            log_error(f"上传文件到S3失败: {str(e)}")
            # 添加更多错误信息
            if hasattr(e, 'response'):
                log_error(f"错误响应: {e.response}")
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
                self.assertIn(adapter.bucket, download_url, "下载URL不包含存储桶名称")
                self.assertIn(test_key, download_url, "下载URL不包含文件键")
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
    unittest.main() 
from boto3 import client
from botocore.config import Config
from utils.config import config
from utils.logger import log_error, log_info
from storage.base import StorageAdapter


class S3StorageAdapter(StorageAdapter):
    def __init__(self):
        self.s3_client = client(
            's3',
            endpoint_url=config.get("CLOUDFLARE_R2_ENDPOINT"),
            aws_access_key_id=config.get("CLOUDFLARE_R2_ACCESS_KEY_ID"),
            aws_secret_access_key=config.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
            region_name="auto",
            config=Config(
                signature_version='s3v4',
                retries={'max_attempts': 3},
                connect_timeout=5,
                read_timeout=60
            )
        )
        self.bucket = config.get("CLOUDFLARE_R2_BUCKET")
        log_info(f"使用S3存储，存储桶: {self.bucket}")

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
            return False
    
    def get_file(self, key: str) -> tuple:
        try:
            response = self.s3_client.get_object(Bucket=self.bucket, Key=key)
            file_data = response['Body'].read()
            content_type = response.get('ContentType', 'application/octet-stream')
            return file_data, content_type
        except Exception as e:
            log_error(f"从S3获取文件失败: {str(e)}")
            return None, None 

if __name__ == "__main__":
    import unittest
    import os
    from unittest.mock import patch, MagicMock
    
    class TestS3StorageAdapter(unittest.TestCase):
        def setUp(self):
            # 创建模拟的S3客户端
            self.mock_s3_client = MagicMock()
            self.original_client = S3StorageAdapter.s3_client
            
            # 使用patch装饰器替换S3客户端
            self.patcher = patch('storage.S3.client', return_value=self.mock_s3_client)
            self.patcher.start()
            
            # 创建适配器实例
            self.adapter = S3StorageAdapter()
            
            # 保存原始配置
            self.original_bucket = self.adapter.bucket
            
            # 设置测试配置
            import utils.config
            self.original_config = utils.config.config.copy()
            utils.config.config["CLOUDFLARE_R2_BUCKET"] = "test-bucket"
            utils.config.config["CLOUDFLARE_R2_ENDPOINT"] = "https://test-endpoint.com"
            utils.config.config["CLOUDFLARE_R2_ACCESS_KEY_ID"] = "test-access-key"
            utils.config.config["CLOUDFLARE_R2_SECRET_ACCESS_KEY"] = "test-secret-key"
            
            # 重新初始化适配器以使用测试配置
            self.adapter = S3StorageAdapter()
            
        def tearDown(self):
            # 恢复原始配置
            import utils.config
            utils.config.config = self.original_config
            
            # 停止patch
            self.patcher.stop()
            
        def test_save_file(self):
            # 测试保存文件
            test_key = "test/save_test.txt"
            test_data = b"Test data for S3"
            content_type = "text/plain"
            
            # 调用保存文件方法
            result = self.adapter.save_file(test_key, test_data, content_type)
            
            # 验证S3客户端被正确调用
            self.mock_s3_client.put_object.assert_called_once_with(
                Bucket=self.adapter.bucket,
                Key=test_key,
                Body=test_data,
                ContentType=content_type
            )
            self.assertTrue(result)
            
        def test_get_file(self):
            # 测试获取文件
            test_key = "test/get_test.txt"
            test_data = b"Test data from S3"
            content_type = "text/plain"
            
            # 设置模拟响应
            mock_response = {
                'Body': MagicMock(read=lambda: test_data),
                'ContentType': content_type
            }
            self.mock_s3_client.get_object.return_value = mock_response
            
            # 调用获取文件方法
            data, retrieved_type = self.adapter.get_file(test_key)
            
            # 验证S3客户端被正确调用
            self.mock_s3_client.get_object.assert_called_once_with(
                Bucket=self.adapter.bucket,
                Key=test_key
            )
            self.assertEqual(data, test_data)
            self.assertEqual(retrieved_type, content_type)
            
        def test_delete_file(self):
            # 测试删除文件
            test_key = "test/delete_test.txt"
            
            # 调用删除文件方法
            result = self.adapter.delete_file(test_key)
            
            # 验证S3客户端被正确调用
            self.mock_s3_client.delete_object.assert_called_once_with(
                Bucket=self.adapter.bucket,
                Key=test_key
            )
            self.assertTrue(result)
            
        def test_check_file_exists(self):
            # 测试检查文件是否存在
            test_key = "test/exists_test.txt"
            
            # 设置模拟响应 - 文件存在
            self.mock_s3_client.head_object.return_value = {}
            
            # 调用检查文件是否存在方法
            result = self.adapter.check_file_exists(test_key)
            
            # 验证S3客户端被正确调用
            self.mock_s3_client.head_object.assert_called_once_with(
                Bucket=self.adapter.bucket,
                Key=test_key
            )
            self.assertTrue(result)
            
            # 设置模拟响应 - 文件不存在
            self.mock_s3_client.head_object.side_effect = Exception("Not found")
            
            # 再次调用检查文件是否存在方法
            result = self.adapter.check_file_exists(test_key)
            self.assertFalse(result)
            
        def test_generate_upload_url(self):
            # 测试生成上传URL
            test_key = "test/upload_test.txt"
            content_type = "text/plain"
            expires_in = 600
            
            # 设置模拟响应
            expected_url = "https://test-upload-url.com"
            self.mock_s3_client.generate_presigned_url.return_value = expected_url
            
            # 调用生成上传URL方法
            url = self.adapter.generate_upload_url(test_key, content_type, expires_in)
            
            # 验证S3客户端被正确调用
            self.mock_s3_client.generate_presigned_url.assert_called_once_with(
                'put_object',
                Params={
                    'Bucket': self.adapter.bucket,
                    'Key': test_key,
                    'ContentType': content_type
                },
                ExpiresIn=expires_in
            )
            self.assertEqual(url, expected_url)
            
        def test_generate_download_url(self):
            # 测试生成下载URL
            test_key = "test/download_test.txt"
            expires_in = 3600
            
            # 设置模拟响应
            expected_url = "https://test-download-url.com"
            self.mock_s3_client.generate_presigned_url.return_value = expected_url
            
            # 调用生成下载URL方法
            url = self.adapter.generate_download_url(test_key, expires_in)
            
            # 验证S3客户端被正确调用
            self.mock_s3_client.generate_presigned_url.assert_called_once_with(
                'get_object',
                Params={
                    'Bucket': self.adapter.bucket,
                    'Key': test_key
                },
                ExpiresIn=expires_in
            )
            self.assertEqual(url, expected_url)
    
    # 运行测试
    unittest.main() 
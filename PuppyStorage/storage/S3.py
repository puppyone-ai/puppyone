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
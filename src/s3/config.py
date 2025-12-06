"""S3 存储模块配置"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class S3Settings(BaseSettings):
    """S3 存储配置"""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
        env_file_encoding="utf-8"
    )

    # S3 服务端点 (LocalStack: http://localhost:4566, AWS: None)
    S3_ENDPOINT_URL: str = "http://localhost:4566"
    S3_BUCKET_NAME: str = "contextbase"
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = "test"  # 本地开发默认值
    S3_SECRET_ACCESS_KEY: str = "test"  # 本地开发默认值

    # S3 文件大小限制配置
    S3_MAX_FILE_SIZE: int = 100 * 1024 * 1024  # 100MB (字节)
    # 降低分片上传阈值，避免大文件单次上传导致SSL错误
    S3_MULTIPART_THRESHOLD: int = 10 * 1024 * 1024  # 10MB (字节) - 超过10MB使用分片上传
    S3_MULTIPART_CHUNKSIZE: int = 5 * 1024 * 1024  # 5MB (字节)


s3_settings = S3Settings()

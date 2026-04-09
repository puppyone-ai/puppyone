"""S3 storage module configuration"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class S3Settings(BaseSettings):
    """S3 storage configuration"""

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=True, extra="ignore", env_file_encoding="utf-8"
    )

    # S3 endpoint (LocalStack: http://localhost:4566, AWS: None)
    S3_ENDPOINT_URL: str = "http://localhost:4566"
    S3_BUCKET_NAME: str = "contextbase"
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = "test"  # Default for local development
    S3_SECRET_ACCESS_KEY: str = "test"  # Default for local development

    # S3 file size limit configuration
    S3_MAX_FILE_SIZE: int = 100 * 1024 * 1024  # 100MB (bytes)
    # Lower the multipart upload threshold to avoid SSL errors from single large uploads
    S3_MULTIPART_THRESHOLD: int = 10 * 1024 * 1024  # 10MB (bytes) - use multipart upload above 10MB
    S3_MULTIPART_CHUNKSIZE: int = 5 * 1024 * 1024  # 5MB (bytes)


s3_settings = S3Settings()

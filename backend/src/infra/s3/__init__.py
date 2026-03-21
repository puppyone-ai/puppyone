"""S3 存储模块"""

from src.infra.s3.router import router
from src.infra.s3.service import s3_service

__all__ = ["router", "s3_service"]

"""S3 storage module"""

from src.infra.s3.router import router
from src.infra.s3.service import s3_service

__all__ = ["router", "s3_service"]

"""
Ingest Module Dependencies - FastAPI dependency injection.
"""

from typing import Annotated

from fastapi import Depends

from src.upload.file.dependencies import get_etl_service
from src.upload.service import IngestService


async def get_ingest_service(
    file_service=Depends(get_etl_service),
) -> IngestService:
    """Get IngestService instance (file-only)."""
    return IngestService(file_service=file_service)


IngestServiceDep = Annotated[IngestService, Depends(get_ingest_service)]

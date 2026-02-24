"""
Ingest Module Dependencies - FastAPI dependency injection.
"""

from typing import Annotated

from fastapi import Depends

from src.upload.file.dependencies import get_etl_service
from src.sync.dependencies import get_import_service
from src.upload.service import IngestService


async def get_ingest_service(
    file_service=Depends(get_etl_service),
    saas_service=Depends(get_import_service),
) -> IngestService:
    """
    Get IngestService instance with underlying services injected.
    """
    return IngestService(
        file_service=file_service,
        saas_service=saas_service,
    )


# Type alias for cleaner dependency injection
IngestServiceDep = Annotated[IngestService, Depends(get_ingest_service)]

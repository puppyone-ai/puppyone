"""
Import Router

Main router that aggregates all import source routers.

Route structure by information source:
- /api/v1/import/file - Local file uploads (ETL)
- /api/v1/import/saas - SaaS integrations (GitHub, Notion, etc.)
- /api/v1/import/url - URL-based imports (future)
"""

from fastapi import APIRouter

from .saas.router import router as saas_router
# Future: from .file.router import router as file_router
# Future: from .url.router import router as url_router

router = APIRouter(prefix="/import", tags=["import"])

# Mount SaaS router
router.include_router(saas_router)

# Future: Mount file router (ETL upload)
# router.include_router(file_router)

# Future: Mount URL router
# router.include_router(url_router)


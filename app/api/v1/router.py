from fastapi import APIRouter
from app.api.v1.endpoints.user import router as user_router
from app.api.v1.endpoints.mcp import router as mcp_instance_router
from app.api.v1.endpoints.user_context import router as user_context_router
from app.api.v1.endpoints.project import router as project_router
from app.api.v1.endpoints.file_parser import router as file_parser_router

router = APIRouter(prefix="/v1")
# router.include_router(user_router)
router.include_router(mcp_instance_router)
router.include_router(user_context_router)
router.include_router(project_router)
router.include_router(file_parser_router)
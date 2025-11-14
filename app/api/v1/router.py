from fastapi import APIRouter
from app.api.v1.endpoints.user import router as user_router
from app.api.v1.endpoints.mcp_token import router as mcp_token_router
from app.api.v1.endpoints.user_context import router as user_context_router

router = APIRouter(prefix="/v1")
# router.include_router(user_router)
router.include_router(mcp_token_router)
router.include_router(user_context_router)
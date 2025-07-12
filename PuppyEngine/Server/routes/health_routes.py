"""
Health check routes for Engine Server
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from Utils.logger import log_info, log_error
from Utils.puppy_exception import PuppyException

# Create router instance
health_router = APIRouter()

@health_router.get("/health")
async def health_check():
    """
    Health check endpoint to verify server status.
    
    Returns:
        JSONResponse: Server health status
    """
    try:
        log_info("Health check endpoint accessed!")
        return JSONResponse(content={"status": "healthy"}, status_code=200)
    except Exception as e:
        log_error(f"Health check error: {str(e)}!")
        raise PuppyException(6000, "Health Check Failed", str(e)) 
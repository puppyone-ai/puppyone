import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from tools.puppy_utils import PuppyException
from tools.puppy_utils import log_info, log_error, log_warning

# 获取环境信息并创建相应的日志器
from tools.puppy_utils.logger import get_logger
from tools.puppy_utils.config import ENV

# 获取特定服务的日志器
storage_logger = get_logger("puppystorage")
log_info = storage_logger.info
log_warning = storage_logger.warning
log_error = storage_logger.error

from server.routes.file_routes import file_router, storage_router
from server.routes.vector_routes import vector_router


try:
    app = FastAPI()

    # 记录当前环境信息
    log_info(f"Storage server starting in {ENV} environment")

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        error_details = exc.errors()
        error_messages = []
        for error in error_details:
            field = " -> ".join(str(x) for x in error["loc"])
            message = error["msg"]
            error_messages.append(f"{field}: {message}")
        
        error_message = "; ".join(error_messages)
        raise PuppyException(
            error_code=3000,  # Validation error code
            error_message="Validation Error",
            cause=error_message,
            service_name="puppystorage"
        )

    app.include_router(vector_router)
    app.include_router(file_router)
    app.include_router(storage_router)
except PuppyException as e:
    log_error(f"Server Initialization Error: {str(e)}")

@app.get("/health")
async def health_check():
    try:
        log_info("Health Check Accessed!")
        return JSONResponse(content={"status": "healthy"}, status_code=200)
    except PuppyException as e:
        log_error(f"Health Check Error: {str(e)}!")
        return JSONResponse(content={"status": "unhealthy", "error": str(e)}, status_code=500)


if __name__ == "__main__":
    try:
        import asyncio
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        config = Config()
        config.bind = ["127.0.0.1:8002"]

        asyncio.run(serve(app, config))
    except PuppyException as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from utils.puppy_exception import PuppyException
from utils.logger import log_info, log_error
from server.routes.file_routes import file_router, storage_router
from server.routes.vector_routes import vector_router


try:
    # 根据部署类型决定是否启用文档接口
    DEPLOYMENT_TYPE = os.getenv("DEPLOYMENT_TYPE", "local").lower()

    # 生产环境禁用文档接口
    if DEPLOYMENT_TYPE == "remote":
        app = FastAPI(
            docs_url=None,
            redoc_url=None,
            openapi_url=None
        )
        log_info("Remote deployment: Documentation endpoints disabled")
    else:
        # 本地环境启用文档接口
        app = FastAPI()
        log_info("Local deployment: Documentation endpoints enabled at /docs and /redoc")

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
            cause=error_message
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

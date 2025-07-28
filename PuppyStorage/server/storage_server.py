import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from utils.puppy_exception import PuppyException
from utils.logger import log_info, log_error
from utils.config import ConfigValidationError
from server.routes.file_routes import file_router, storage_router
from server.routes.vector_routes import vector_router
from server.routes.multipart_routes import multipart_router


try:
    # Configuration validation has been executed when utils.config module is imported
    # If there are configuration errors, the program will exit before this point
    log_info("PuppyStorage configuration validation completed, initializing service...")
    
    # Determine whether to enable documentation interface based on deployment type
    DEPLOYMENT_TYPE = os.getenv("DEPLOYMENT_TYPE", "local").lower()

    # Production environment disables documentation interface
    if DEPLOYMENT_TYPE == "remote":
        app = FastAPI(
            docs_url=None,
            redoc_url=None,
            openapi_url=None
        )
        log_info("Remote deployment: Documentation endpoints disabled")
    else:
        # Local environment enables documentation interface
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
        
        # 清理error_details，确保可以JSON序列化
        cleaned_details = []
        for error in error_details:
            field = " -> ".join(str(x) for x in error["loc"])
            message = error["msg"]
            error_messages.append(f"{field}: {message}")
            
            # 创建一个可以JSON序列化的错误详情
            cleaned_error = {
                "type": error.get("type", "validation_error"),
                "loc": error.get("loc", []),
                "msg": message,
                "input": str(error.get("input", "")) if error.get("input") is not None else None
            }
            cleaned_details.append(cleaned_error)
        
        error_message = "; ".join(error_messages)
        
        # 直接返回422状态码，使用清理过的数据
        return JSONResponse(
            status_code=422,
            content={
                "detail": cleaned_details,
                "error": "Validation Error",
                "message": error_message
            }
        )

    app.include_router(vector_router)
    app.include_router(file_router)
    app.include_router(storage_router)
    app.include_router(multipart_router)
    
    log_info("PuppyStorage service initialization completed")
    
except ConfigValidationError as cve:
    # Configuration validation error, exit directly (error message has been output in config.py)
    exit(1)
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
        log_info("PuppyStorage Server is starting...")
        
        import asyncio
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        # Avoid variable name conflict: use hypercorn_config instead of config
        hypercorn_config = Config()
        hypercorn_config.bind = ["127.0.0.1:8002"]
        # Enable hot-reloading for local development
        hypercorn_config.reload = True

        log_info("Server will start at http://127.0.0.1:8002 (hot-reload enabled)")
        asyncio.run(serve(app, hypercorn_config))
        
    except ConfigValidationError as cve:
        # Configuration validation error, exit directly (error message has been output in config.py)
        exit(1)
    except PuppyException as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyException(7000, "Unexpected Error in Launching PuppyStorage Server", str(e))

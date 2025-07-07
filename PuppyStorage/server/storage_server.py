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


try:
    # 配置验证在 utils.config 模块导入时已经执行
    # 如果有配置错误，程序会在此之前退出
    log_info("PuppyStorage配置验证完成，正在初始化服务...")
    
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
    
    log_info("PuppyStorage服务初始化完成")
    
except ConfigValidationError as cve:
    # 配置验证错误，直接退出（错误信息已在 config.py 中输出）
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
        log_info("PuppyStorage Server 正在启动...")
        
        import asyncio
        from hypercorn.config import Config
        from hypercorn.asyncio import serve

        # 避免变量名冲突：使用 hypercorn_config 而不是 config
        hypercorn_config = Config()
        hypercorn_config.bind = ["127.0.0.1:8002"]

        log_info("服务器将在 http://127.0.0.1:8002 启动")
        asyncio.run(serve(app, hypercorn_config))
        
    except ConfigValidationError as cve:
        # 配置验证错误，直接退出（错误信息已在 config.py 中输出）
        exit(1)
    except PuppyException as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
    except Exception as e:
        log_error(f"Unexpected Error in Launching Server: {str(e)}")
        raise PuppyException(7000, "Unexpected Error in Launching PuppyStorage Server", str(e))

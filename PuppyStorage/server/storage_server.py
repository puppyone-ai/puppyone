import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from utils.puppy_exception import PuppyException
from utils.logger import log_info, log_error
from server.routes.file_routes import file_router
from server.routes.vector_routes import vector_router


try:
    app = FastAPI()

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(vector_router)
    app.include_router(file_router)

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

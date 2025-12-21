"""
MCP Server启动入口
可通过 python -m mcp_service 启动（兼容入口）

推荐启动方式（与主服务一致）：使用 uv run + uvicorn
  uv run uvicorn mcp_service.server:app --host 0.0.0.0 --port 3090 --reload --log-level info
"""
import uvicorn

from .settings import settings
from .server import app

if __name__ == "__main__":
    uvicorn.run(app, host=settings.HOST, port=settings.PORT, log_level=settings.LOG_LEVEL.lower())

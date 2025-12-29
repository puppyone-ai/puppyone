from __future__ import annotations

import httpx

from src.config import settings
from src.utils.logger import log_error


def invalidate_mcp_cache(api_key: str) -> None:
    """
    best-effort 通知 MCP Server 使某个 api_key 的配置缓存失效。

    - 不抛异常（避免影响主流程）
    - MCP_SERVER_URL 未配置时直接跳过
    """

    base = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not base:
        return

    url = f"{base}/cache/invalidate"
    try:
        httpx.post(url, json={"api_key": api_key}, timeout=5.0, trust_env=False)
    except Exception as e:
        log_error(f"Failed to invalidate MCP cache: api_key={api_key[:12]}... err={e}")



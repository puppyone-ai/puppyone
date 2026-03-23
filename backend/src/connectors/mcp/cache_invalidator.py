from __future__ import annotations

import httpx

from src.config import settings
from src.utils.logger import log_error


def invalidate_mcp_cache(api_key: str) -> None:
    """
    Best-effort notification to MCP Server to invalidate the config cache for a given api_key.

    - Does not raise exceptions (to avoid affecting the main flow)
    - Skips silently when MCP_SERVER_URL is not configured
    """

    base = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not base:
        return

    url = f"{base}/cache/invalidate"
    try:
        httpx.post(url, json={"api_key": api_key}, timeout=5.0, trust_env=False)
    except Exception as e:
        log_error(f"Failed to invalidate MCP cache: api_key={api_key[:12]}... err={e}")

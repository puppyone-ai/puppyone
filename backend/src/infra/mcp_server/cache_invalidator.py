from __future__ import annotations

import httpx

from src.config import settings
from src.utils.logger import log_error


def invalidate_mcp_cache(api_key: str) -> None:
    """
    Best-effort notification to MCP Server to invalidate the config cache for an api_key.

    - Does not raise exceptions (to avoid affecting the main flow)
    - Skips directly when MCP_SERVER_URL is not configured
    """

    base = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not base:
        return

    url = f"{base}/cache/invalidate"
    # Authenticate the server-to-server call (ISSUE-008): the MCP service now
    # requires the shared internal secret on this endpoint.
    headers = {"X-Internal-Secret": settings.INTERNAL_API_SECRET or ""}
    try:
        httpx.post(url, json={"api_key": api_key}, headers=headers, timeout=5.0, trust_env=False)
    except Exception as e:
        log_error(f"Failed to invalidate MCP cache: api_key={api_key[:12]}... err={e}")


def invalidate_mcp_surface_cache(access_surface_id: str) -> None:
    """Invalidate MCP cache/session state without retrieving an old bearer token."""
    base = (settings.MCP_SERVER_URL or "").rstrip("/")
    if not base:
        return
    headers = {"X-Internal-Secret": settings.INTERNAL_API_SECRET or ""}
    try:
        httpx.post(
            f"{base}/cache/invalidate",
            json={"access_surface_id": access_surface_id},
            headers=headers,
            timeout=5.0,
            trust_env=False,
        )
    except Exception as e:
        log_error(
            "Failed to invalidate MCP cache: "
            f"access_surface_id={access_surface_id} err={e}"
        )

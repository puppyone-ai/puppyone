from src.config import settings
from src.infra.mcp_server.repository import McpInstanceRepositoryJSON, McpInstanceRepositorySupabase
from src.infra.mcp_server.service import McpService


# Use a global variable to store the singleton instead of lru_cache
# This avoids caching issues during reload
_mcp_service = None


def get_mcp_instance_service() -> McpService:
    """
    Dependency injection factory for mcp_instance_service. Supports choosing storage strategy via configuration.

    NOTE (ISSUE-017): the only live consumer is the /ready + /health readiness
    probe, which calls McpService.check_mcp_server_health() — an HTTP /healthz call
    to the external MCP server. The legacy per-instance api-key dependencies
    (get_verified_mcp_instance / get_mcp_instance_by_api_key) were removed here
    because no route mounted them; the remaining legacy `mcps`-table CRUD is now
    unreachable and slated for removal (decouple the health probe from the instance
    repo, then drop the plaintext-key `mcps` table via migration).
    """
    global _mcp_service
    if _mcp_service is None:
        if settings.STORAGE_TYPE == "json":
            _mcp_service = McpService(McpInstanceRepositoryJSON())
        elif settings.STORAGE_TYPE == "supabase":
            _mcp_service = McpService(McpInstanceRepositorySupabase())
        else:
            raise ValueError(f"Unsupported storage type: {settings.STORAGE_TYPE}")
    return _mcp_service

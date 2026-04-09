"""MCP service test fixtures — set required env vars before import."""

import os

# Set required env vars before any mcp_service imports
os.environ.setdefault("INTERNAL_API_SECRET", "test-secret-for-unit-tests")
os.environ.setdefault("MAIN_SERVICE_URL", "http://localhost:8000")

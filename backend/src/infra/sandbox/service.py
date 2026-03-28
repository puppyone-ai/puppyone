"""
Sandbox service - Unified interface

Automatically selects E2B cloud sandbox or Docker local sandbox based on configuration.

Configuration (in backend/src/config.py):
- SANDBOX_TYPE: "e2b" | "docker" | "auto"
  - "e2b": Use E2B cloud sandbox (requires E2B_API_KEY)
  - "docker": Use local Docker container sandbox
  - "auto": Auto-select (use E2B if E2B_API_KEY exists, otherwise use Docker)
"""

import os
from typing import Any, Callable, Optional

from .base import SandboxBase


class SandboxService:
    """
    Unified sandbox service interface

    Acts as a facade/proxy class, delegating to concrete sandbox implementations (E2B or Docker).
    Supports automatic backend switching via configuration or environment variables.
    """

    def __init__(
        self,
        sandbox_impl: Optional[SandboxBase] = None,
        sandbox_factory: Optional[Callable[[], Any]] = None,
    ):
        """
        Initialize sandbox service

        Args:
            sandbox_impl: Directly provide a sandbox implementation (for testing or forced selection)
            sandbox_factory: E2B sandbox factory (backward compatible, for testing)
        """
        if sandbox_impl is not None:
            self._impl = sandbox_impl
        elif sandbox_factory is not None:
            # Backward compatible: create E2B sandbox using custom factory
            from .e2b_sandbox import E2BSandbox
            self._impl = E2BSandbox(sandbox_factory=sandbox_factory)
        else:
            # Auto-create based on configuration
            self._impl = _create_sandbox_impl()

    async def start(self, session_id: str, data: Any, readonly: bool) -> dict:
        """Create a sandbox session and preload a single JSON data"""
        return await self._impl.start(session_id, data, readonly)

    async def start_with_files(
        self,
        session_id: str,
        files: list,
        readonly: bool,
        s3_service: Optional[Any] = None
    ) -> dict:
        """Create a sandbox session and preload multiple files"""
        return await self._impl.start_with_files(session_id, files, readonly, s3_service)

    async def exec(self, session_id: str, command: str) -> dict:
        """Execute a command in the sandbox"""
        return await self._impl.exec(session_id, command)

    async def read(self, session_id: str) -> dict:
        """Read the contents of /workspace/data.json"""
        return await self._impl.read(session_id)

    async def read_file(self, session_id: str, path: str, parse_json: bool = False) -> dict:
        """Read a file at the specified path in the sandbox"""
        return await self._impl.read_file(session_id, path, parse_json)

    async def stop(self, session_id: str) -> dict:
        """Stop and clean up a sandbox session"""
        return await self._impl.stop(session_id)

    async def status(self, session_id: str) -> dict:
        """Get sandbox session status"""
        return await self._impl.status(session_id)

    async def stop_all(self) -> None:
        """Stop all sandbox sessions"""
        await self._impl.stop_all()

    @property
    def sandbox_type(self) -> str:
        """Return the currently used sandbox type"""
        from .e2b_sandbox import E2BSandbox
        from .docker_sandbox import DockerSandbox

        if isinstance(self._impl, E2BSandbox):
            return "e2b"
        elif isinstance(self._impl, DockerSandbox):
            return "docker"
        else:
            return "unknown"


def _create_sandbox_impl() -> SandboxBase:
    """
    Create sandbox implementation based on configuration

    Priority:
    1. SANDBOX_TYPE from configuration
    2. In auto mode, detect whether E2B_API_KEY exists
    """
    from src.config import settings

    sandbox_type = settings.SANDBOX_TYPE

    # Auto mode: detect environment
    if sandbox_type == "auto":
        if os.getenv("E2B_API_KEY"):
            sandbox_type = "e2b"
            print("[SandboxService] Auto-detected E2B_API_KEY, using E2B sandbox")
        else:
            sandbox_type = "docker"
            print("[SandboxService] No E2B_API_KEY found, using Docker sandbox")

    # Create the corresponding implementation
    if sandbox_type == "e2b":
        from .e2b_sandbox import E2BSandbox
        print("[SandboxService] Initializing E2B cloud sandbox")
        return E2BSandbox()
    else:
        from .docker_sandbox import DockerSandbox
        print("[SandboxService] Initializing Docker local sandbox")
        return DockerSandbox()


def get_sandbox_type() -> str:
    """
    Get the sandbox type that will be used (without creating an instance)

    Used by the frontend to query the current configuration
    """
    from src.config import settings

    sandbox_type = settings.SANDBOX_TYPE

    if sandbox_type == "auto":
        if os.getenv("E2B_API_KEY"):
            return "e2b"
        else:
            return "docker"

    return sandbox_type

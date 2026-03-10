"""
OpenClaw Connector — Bidirectional CLI file sync.

Unlike SaaS connectors, OpenClaw doesn't use the standard fetch() pipeline.
Sync is driven by the CLI pushing/pulling files via FolderSyncService.
The connector exposes spec() and delegates to OpenClawService for lifecycle.

NOTE: This stays in sync/connectors/ to avoid circular imports with the
ConnectorRegistry. The actual sync logic lives in src.filesystem.
"""

from typing import Any, Optional, List

from src.sync.connectors._base import (
    BaseConnector, ConnectorSpec, Capability, AuthRequirement, TriggerMode,
    FetchResult, Credentials,
)
from src.sync.schemas import Sync, PullResult, PushResult, ResourceInfo


class OpenClawConnector(BaseConnector):
    """Bidirectional file-folder sync via CLI daemon."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="filesystem",
            display_name="Desktop Folder",
            capabilities=(
                Capability.PULL | Capability.PUSH
                | Capability.REALTIME | Capability.BOOTSTRAP
            ),
            supported_directions=["bidirectional"],
            default_trigger=TriggerMode.REALTIME,
            default_node_type="folder",
            auth=AuthRequirement.ACCESS_KEY,
            creation_mode="bootstrap",
            description="Folder-to-PuppyOne sync via desktop CLI",
            accept_types=("folder",),
            icon="🦞",
        )

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        raise NotImplementedError(
            "OpenClaw does not use fetch(). "
            "Use POST /api/v1/filesystem/bootstrap instead."
        )

    async def push(self, sync: Sync, content: Any, node_type: str) -> PushResult:
        return PushResult(success=False, error="Use CLI push-file endpoint")

    async def list_resources(self, sync: Sync) -> List[ResourceInfo]:
        return []

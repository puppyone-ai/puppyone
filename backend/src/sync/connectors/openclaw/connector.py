"""
OpenClaw Connector — Bidirectional CLI file sync.

Unlike SaaS connectors, OpenClaw doesn't use the import pipeline.
Sync is driven by the CLI pushing/pulling files via FolderSyncService.
The connector exposes spec() and delegates to OpenClawService for lifecycle.
"""

from typing import Any, Optional, List

from src.sync.connectors._base import (
    BaseConnector, ConnectorSpec, Capability, AuthRequirement, TriggerMode,
    ImportResult, ProgressCallback,
)
from src.sync.schemas import Sync, PullResult, PushResult, ResourceInfo


class OpenClawConnector(BaseConnector):
    """Bidirectional file-folder sync via CLI daemon."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="openclaw",
            display_name="OpenClaw",
            capabilities=(
                Capability.PULL | Capability.PUSH
                | Capability.REALTIME | Capability.BOOTSTRAP
            ),
            supported_directions=["bidirectional"],
            default_trigger=TriggerMode.REALTIME,
            default_node_type="folder",
            auth=AuthRequirement.ACCESS_KEY,
        )

    async def import_data(self, task, on_progress: ProgressCallback) -> ImportResult:
        raise NotImplementedError(
            "OpenClaw does not use the import pipeline. "
            "Use POST /api/v1/sync/syncs/openclaw/bootstrap instead."
        )

    async def pull(self, sync: Sync) -> Optional[PullResult]:
        # Pull is handled by FolderSyncService.pull(), not the connector directly.
        # The CLI calls /api/v1/sync/{folder_id}/pull which goes through folder_router.
        return None

    async def push(self, sync: Sync, content: Any, node_type: str) -> PushResult:
        # Push is handled by FolderSyncService, triggered by CLI push-file endpoint.
        return PushResult(success=False, error="Use CLI push-file endpoint")

    async def list_resources(self, sync: Sync) -> List[ResourceInfo]:
        return []

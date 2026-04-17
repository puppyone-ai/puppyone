"""
Filesystem Connector — Bidirectional CLI file sync via MUT protocol.

Data sync is driven by the CLI daemon using MUT access_point
(clone/push/pull/negotiate). The connector exposes spec() for the
registry; fetch()/push() are not used.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.connectors.datasource._base import ConnectorDeps, ConnectorSetup

from typing import Any, List

from src.connectors.datasource._base import (
    BaseConnector, ConnectorSpec, Capability, AuthRequirement, TriggerMode,
    FetchResult, Credentials,
)
from src.connectors.datasource.schemas import Sync, PushResult, ResourceInfo


class FilesystemConnector(BaseConnector):
    """Bidirectional file-folder sync via CLI daemon + MUT protocol."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="filesystem",
            display_name="Machine Folder",
            capabilities=(
                Capability.PULL | Capability.PUSH
                | Capability.REALTIME | Capability.BOOTSTRAP
            ),
            supported_directions=["bidirectional"],
            default_trigger=TriggerMode.REALTIME,
            default_node_type="folder",
            auth=AuthRequirement.ACCESS_KEY,
            creation_mode="bootstrap",
            description="Sync any folder on your machine via terminal (laptop, server, VPS)",
            accept_types=("folder",),
            icon="🦞",
        )

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        raise NotImplementedError(
            "Filesystem uses MUT protocol directly via access_point. "
            "Use POST /api/v1/filesystem/bootstrap to create an access point."
        )

    async def push(self, sync: Sync, content: Any, node_type: str) -> PushResult:
        raise NotImplementedError(
            "Filesystem push is handled by CLI daemon via MUT protocol."
        )

    async def list_resources(self, sync: Sync) -> List[ResourceInfo]:
        return []


def setup(deps: "ConnectorDeps") -> "ConnectorSetup":
    from src.connectors.datasource._base import ConnectorSetup
    return ConnectorSetup(connector=FilesystemConnector())

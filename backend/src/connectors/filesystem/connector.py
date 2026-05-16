"""
Filesystem Connector — Bidirectional CLI file sync via the Git adapter.

Data sync is driven by the CLI daemon using stock ``git`` against the
access-point-bound URL ``/git/ap/<access_key>.git`` (or by direct
calls to ``/api/v1/ap-fs/*`` / ``/api/v1/local-snapshots``). The
connector here just exposes ``spec()`` for the connector registry;
``fetch()`` / ``push()`` raise NotImplementedError because the actual
data plane lives in the Git adapter and the FS HTTP API.
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
    """Bidirectional file-folder sync — CLI daemon drives the Git adapter."""

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
            "Filesystem connector data plane is the Git adapter — "
            "use `git clone https://<host>/git/ap/<access_key>.git` or "
            "the /api/v1/ap-fs/ endpoints. Call "
            "POST /api/v1/filesystem/bootstrap to provision the access key."
        )

    async def push(self, sync: Sync, content: Any, node_type: str) -> PushResult:
        raise NotImplementedError(
            "Filesystem push is handled by the CLI daemon via the Git "
            "adapter (`git push origin main`) or the FS HTTP API; "
            "this connector class is registry metadata only."
        )

    async def list_resources(self, sync: Sync) -> List[ResourceInfo]:
        return []


def setup(deps: "ConnectorDeps") -> "ConnectorSetup":
    from src.connectors.datasource._base import ConnectorSetup
    return ConnectorSetup(connector=FilesystemConnector())

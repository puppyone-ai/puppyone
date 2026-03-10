"""
BaseConnector — Unified base class for all sync connectors.

Three-layer architecture:
  Trigger Layer  (when)  →  manual / scheduler / webhook
  Connector Layer (what) →  connector.fetch(config, credentials) → FetchResult
  Write Layer    (how)   →  CollaborationService.commit(mutation)

Connector only has ONE core method: fetch().
It does NOT know who triggered it or how data is stored.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Flag, auto, Enum
from typing import Any, Callable, List, Optional


# ============================================================
# Capability flags
# ============================================================

class Capability(Flag):
    PULL        = auto()
    PUSH        = auto()
    INCREMENTAL = auto()
    REALTIME    = auto()
    BOOTSTRAP   = auto()


class AuthRequirement(str, Enum):
    NONE       = "none"
    OAUTH      = "oauth"
    API_KEY    = "api_key"
    ACCESS_KEY = "access_key"


class TriggerMode(str, Enum):
    MANUAL   = "manual"
    POLL     = "poll"
    WEBHOOK  = "webhook"
    REALTIME = "realtime"


# ============================================================
# Credentials (passed to fetch by SyncEngine)
# ============================================================

@dataclass
class Credentials:
    """OAuth / API credentials resolved by SyncEngine, passed to fetch()."""
    access_token: str = ""
    metadata: dict = field(default_factory=dict)


# ============================================================
# FetchResult (returned by fetch)
# ============================================================

@dataclass
class FetchResult:
    """
    Returned by connector.fetch() — the data pulled from an external source.

    SyncEngine uses content_hash to decide whether to write (compare with
    sync.remote_hash). If changed, it constructs a Mutation and commits
    through CollaborationService.
    """
    content: Any
    content_hash: str
    node_type: str = "json"
    node_name: Optional[str] = None
    summary: Optional[str] = None


# ============================================================
# Config field descriptor (for dynamic UI generation)
# ============================================================

@dataclass(frozen=True)
class ConfigField:
    """Describes one user-configurable option for a connector."""
    key: str
    label: str
    type: str = "text"              # text | select | number | url
    required: bool = False
    default: Any = None
    options: Optional[List[dict]] = None   # for type=select: [{"value": "...", "label": "..."}]
    placeholder: Optional[str] = None
    hint: Optional[str] = None


# ============================================================
# Connector specification
# ============================================================

@dataclass(frozen=True)
class ConnectorSpec:
    """
    Static descriptor of a connector — declared once.

    SyncEngine reads this to decide what operations are valid,
    what auth to check, and how to wire triggers.
    Registry exposes this via GET /sync/connectors for frontend.
    """
    provider: str
    display_name: str
    capabilities: Capability
    supported_directions: list[str]
    default_trigger: TriggerMode = TriggerMode.MANUAL
    default_node_type: str = "json"
    auth: AuthRequirement = AuthRequirement.NONE
    oauth_type: Optional[str] = None
    oauth_ui_type: Optional[str] = None
    config_schema: Optional[dict] = None

    # Dynamic UI and registry fields
    supported_sync_modes: tuple[str, ...] = ("import_once", "manual", "scheduled")
    default_sync_mode: str = "import_once"
    creation_mode: str = "direct"  # direct | bootstrap
    config_fields: tuple[ConfigField, ...] = ()
    icon: Optional[str] = None
    description: Optional[str] = None
    accept_types: tuple[str, ...] = ("folder",)
    ui_visible: bool = True


# ============================================================
# Base connector
# ============================================================

class BaseConnector(ABC):
    """
    Unified base class for all external-system connectors.

    Subclasses MUST implement:
      - spec()   — static capability declaration
      - fetch()  — core data retrieval method

    Subclasses MAY override:
      - push()         — for bidirectional sync
      - list_resources() / setup_trigger() / teardown_trigger()
    """

    @abstractmethod
    def spec(self) -> ConnectorSpec:
        """Return the static capability descriptor for this connector."""

    @abstractmethod
    async def fetch(
        self,
        config: dict,
        credentials: Credentials,
    ) -> FetchResult:
        """
        Pull data from the external source. This is the ONLY method
        a connector must implement for data retrieval.

        Args:
            config:      Connector-specific config (labels, max_results, etc.)
            credentials: OAuth token + metadata, resolved by SyncEngine.

        Returns:
            FetchResult with content, content_hash, and node metadata.

        The connector does NOT:
          - Know who triggered the fetch (manual / scheduler / webhook)
          - Know how data is stored (no node_service / collab_service)
          - Manage OAuth token refresh (SyncEngine handles that)
        """

    async def push(
        self, sync: "Sync", content: Any, node_type: str,
    ) -> "PushResult":
        raise NotImplementedError(
            f"{self.spec().provider} does not support push"
        )

    async def list_resources(self, sync: "Sync") -> List["ResourceInfo"]:
        return []

    async def setup_trigger(self, sync: "Sync") -> Optional[Any]:
        return None

    async def teardown_trigger(self, sync: "Sync") -> None:
        pass


from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from src.sync.schemas import Sync, PullResult, PushResult, ResourceInfo

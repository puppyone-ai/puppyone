"""
BaseConnector — Unified base class for all sync connectors.

Replaces both the old SyncAdapter (pull/push) and BaseHandler (import).
Each connector declares its capabilities via ConnectorSpec; the engine
uses those flags to decide what operations are valid.

Two execution modes:
  1. Import mode  — import_data(task, on_progress) → ImportResult
     Used by the ARQ import pipeline for one-time data pulls.
  2. Sync mode    — pull(sync) / push(sync, ...) → PullResult / PushResult
     Used by the sync engine for ongoing bidirectional sync.

New connectors should implement at least import_data() or pull().
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Flag, auto, Enum
from typing import Any, Callable, List, Optional

from src.sync.schemas import Sync, PullResult, PushResult, ResourceInfo


# ============================================================
# Capability flags
# ============================================================

class Capability(Flag):
    """What a connector can do. Compose with | operator."""
    PULL        = auto()  # Can pull data from external → PuppyOne
    PUSH        = auto()  # Can push data from PuppyOne → external
    INCREMENTAL = auto()  # Supports delta sync (cursor / historyId)
    REALTIME    = auto()  # Supports real-time triggers (watcher / webhook)
    BOOTSTRAP   = auto()  # Can scan & list all resources on first connect


class AuthRequirement(str, Enum):
    """How the connector authenticates with the external system."""
    NONE       = "none"        # No auth needed on PuppyOne side
    OAUTH      = "oauth"       # OAuth2 flow (stored in oauth_connection)
    API_KEY    = "api_key"     # User-provided API key (stored in sync.config)
    ACCESS_KEY = "access_key"  # PuppyOne-generated access key (sync.access_key)


class TriggerMode(str, Enum):
    """How sync is triggered."""
    MANUAL   = "manual"    # User clicks "sync now"
    POLL     = "poll"      # Periodic polling (scheduler)
    WEBHOOK  = "webhook"   # External system pushes notification
    REALTIME = "realtime"  # File watcher / SSE / persistent connection


# ============================================================
# Connector specification
# ============================================================

@dataclass(frozen=True)
class ConnectorSpec:
    """
    Static descriptor of a connector — declared once at registration time.

    The engine reads this to decide which operations are valid,
    what auth to check, and how to wire triggers.
    """
    provider: str                           # "gmail", "openclaw", "supabase"
    display_name: str                       # "Gmail", "OpenClaw"
    capabilities: Capability                # PULL | INCREMENTAL | ...
    supported_directions: list[str]         # ["inbound"] or ["bidirectional"]
    default_trigger: TriggerMode = TriggerMode.MANUAL
    default_node_type: str = "json"         # "json", "markdown", "folder"
    auth: AuthRequirement = AuthRequirement.NONE
    oauth_type: Optional[str] = None        # "gmail", "github" — only when auth=OAUTH
    config_schema: Optional[dict] = None    # JSON Schema for provider-specific config


# ============================================================
# Import-mode types (backward compatible with old BaseHandler)
# ============================================================

ProgressCallback = Callable[[int, str], None]


class ImportResult:
    """Result of an import operation (one-time pull)."""

    def __init__(
        self,
        content_node_id: str,
        items_count: int = 0,
        metadata: Optional[dict[str, Any]] = None,
    ):
        self.content_node_id = content_node_id
        self.items_count = items_count
        self.metadata = metadata or {}


@dataclass
class PreviewResult:
    """Preview data for a URL without importing."""
    source_type: str
    title: str
    description: Optional[str] = None
    data: List[dict] = field(default_factory=list)
    fields: List[dict] = field(default_factory=list)
    total_items: int = 0
    structure_info: Optional[dict] = None


# ============================================================
# Base connector
# ============================================================

class BaseConnector(ABC):
    """
    Unified base class for all external-system connectors.

    Subclasses MUST implement:
      - spec()        — static capability declaration
      - import_data() — OR pull(), at least one

    Subclasses MAY override:
      - pull()             — for ongoing sync (default: NotImplementedError)
      - push()             — for bidirectional sync
      - list_resources()   — for bootstrap / first-connect scan
      - setup_trigger()    — for webhook / watcher registration
      - teardown_trigger() — cleanup
      - preview()          — preview a URL before importing
    """

    @abstractmethod
    def spec(self) -> ConnectorSpec:
        """Return the static capability descriptor for this connector."""

    # ── Import mode (ARQ pipeline) ──────────────────────────

    @abstractmethod
    async def import_data(
        self,
        task: "ImportTask",
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """
        One-time data pull via the ARQ import pipeline.

        Args:
            task: ImportTask with user_id, project_id, config, etc.
            on_progress: Callback (progress_pct: 0-100, message: str)

        Returns:
            ImportResult with content_node_id and items_count
        """

    # ── Sync mode (ongoing pull/push) ──────────────────────

    async def pull(self, sync: Sync) -> Optional[PullResult]:
        """
        Pull changes from external source.

        Compare sync.remote_hash to detect changes:
          changed   → return PullResult
          unchanged → return None
        """
        raise NotImplementedError(
            f"{self.spec().provider} does not support sync-mode pull"
        )

    async def push(
        self, sync: Sync, content: Any, node_type: str,
    ) -> PushResult:
        """Push content to external system."""
        raise NotImplementedError(
            f"{self.spec().provider} does not support push"
        )

    async def list_resources(self, sync: Sync) -> List[ResourceInfo]:
        """Scan external source and list all resources (for bootstrap)."""
        return []

    async def setup_trigger(self, sync: Sync) -> Optional[Any]:
        """Register webhook / start watcher. Return trigger handle or None."""
        return None

    async def teardown_trigger(self, sync: Sync) -> None:
        """Unregister webhook / stop watcher."""
        pass

    async def preview(self, url: str, user_id: str, **kwargs) -> PreviewResult:
        """Preview a URL before importing. Override if supported."""
        raise NotImplementedError(
            f"{self.spec().provider} does not support preview"
        )


# Avoid circular import — ImportTask is only needed at runtime
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from src.sync.task.models import ImportTask

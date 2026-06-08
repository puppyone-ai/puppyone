"""Generalized sandbox provider abstraction for scope-keyed Access sandboxes.

This is the V2 "sandbox as access point" provider interface (see
docs/proposals/PUP-sandbox-access-point.md). It is intentionally separate from
the legacy JSON-edit ``infra.sandbox.SandboxBase`` (which models one-shot
``exec`` against ``/workspace/data.json``).

A provider here manages a long-lived, scope-keyed sandbox with an explicit
three-state lifecycle so the session manager can trade warm cost against cold
restart cost:

    RUNNING   compute on, working copy present                (full cost)
    STOPPED   compute off, working copy/disk RETAINED          (storage only)
    DESTROYED everything reclaimed                              ($0)

The key optimization is the STOPPED state: stopping keeps the on-disk working
copy so a restart is an incremental ``git fetch`` rather than a full re-pull.
Only DESTROY frees the disk (and forces a full pull next time). A provider
declares via :class:`ProviderCapabilities` whether it can actually do
stop-with-disk-retained and raw-TCP (SSH) ingress.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum


class SandboxState(str, Enum):
    PENDING = "pending"      # created / starting, not yet usable
    RUNNING = "running"      # usable; compute billed
    STOPPED = "stopped"      # compute off, disk retained; cheap, fast restart
    DESTROYED = "destroyed"  # reclaimed; next use needs a full create + pull
    UNKNOWN = "unknown"

    @property
    def is_terminal(self) -> bool:
        return self is SandboxState.DESTROYED


@dataclass(frozen=True)
class SandboxSpec:
    """What to create. Provider-agnostic; providers map to their own shapes."""

    scope_id: str
    project_id: str
    image: str = ""                 # provider default if empty
    vcpus: int = 1
    memory_mb: int = 2048
    region: str | None = None
    ssh_port: int = 22
    # Server-side scope access material (e.g. git remote URL + access key) is
    # injected into the sandbox here so the user never sees the raw key. Held
    # provider-side, never returned to the client.
    env: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ConnectionInfo:
    """How a user's VSCode Remote-SSH reaches the sandbox.

    ``proxy_command`` is set when the provider does not expose a raw public TCP
    port and SSH must be tunnelled (e.g. E2B over a wss proxy, or Fly via
    ``flyctl``). When present, the client should use it as the SSH
    ``ProxyCommand``; ``host``/``port`` then describe the logical target.
    """

    host: str
    port: int = 22
    username: str = "puppy"
    proxy_command: str | None = None
    extra: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class SandboxInfo:
    """Provider-side view of a sandbox after an operation."""

    sandbox_id: str
    state: SandboxState
    connection: ConnectionInfo | None = None
    raw: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderCapabilities:
    name: str
    # STOPPED retains disk and restart is a cheap resume (vs full recreate).
    supports_stop_resume: bool
    supports_destroy: bool
    # Can expose a raw public TCP port (port 22) for direct VSCode Remote-SSH.
    # False means SSH must go through a proxy/tunnel (see ConnectionInfo).
    supports_tcp_ingress: bool
    # True if the sandbox can be run on the customer's own infrastructure.
    self_hostable: bool = False


class SandboxProvider(ABC):
    """Lifecycle of one scope's sandbox. Implementations are stateless wrappers
    over a backend API/SDK; all durable session state lives in the registry."""

    @abstractmethod
    def capabilities(self) -> ProviderCapabilities: ...

    @abstractmethod
    async def create(self, spec: SandboxSpec) -> SandboxInfo:
        """Provision a new sandbox and bring it to RUNNING (the cold path)."""

    @abstractmethod
    async def start(self, sandbox_id: str) -> SandboxInfo:
        """Resume a STOPPED sandbox (disk retained → fast). Idempotent if already RUNNING."""

    @abstractmethod
    async def stop(self, sandbox_id: str) -> SandboxInfo:
        """Stop compute but RETAIN disk. Idempotent if already STOPPED."""

    @abstractmethod
    async def destroy(self, sandbox_id: str) -> None:
        """Reclaim everything. Idempotent if already gone."""

    @abstractmethod
    async def status(self, sandbox_id: str) -> SandboxInfo:
        """Current provider-side state (used to reconcile drift)."""

    async def exec(self, sandbox_id: str, command: str) -> dict:
        """Run a command (used for warmup / health / incremental fetch).

        Optional — providers that don't support out-of-band exec raise.
        """
        raise NotImplementedError(
            f"{self.capabilities().name} provider does not support exec()"
        )

    async def extend(self, sandbox_id: str) -> None:
        """Push out the sandbox's own idle/auto-stop timeout (best-effort).

        Default no-op for providers that don't self-time-out (e.g. Fly machines,
        which only stop when we tell them to). E2B sandboxes auto-kill at their
        timeout, so the E2B provider overrides this to keep active sessions alive.
        """
        return None

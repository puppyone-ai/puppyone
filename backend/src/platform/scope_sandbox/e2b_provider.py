"""E2B provider — version B (Firecracker; self-hostable / compliance option).

Maps our three-state lifecycle onto E2B's pause/resume model:

    create  → client.create(spec)   → RUNNING
    stop    → client.pause(id)       → STOPPED (filesystem + memory retained)
    start   → client.resume(id)      → RUNNING (fast)
    destroy → client.kill(id)        → DESTROYED
    status  → client.get_state(id)

Why E2B as the alternate version: strongest isolation (Firecracker) and the
**only self-hostable** option (Apache-2.0 infra, BYOC/on-prem) — the pick for
enterprises that want the sandbox inside their own infrastructure / for
compliance. Trade-off vs Fly: **no native public SSH** — VSCode Remote-SSH must
be tunnelled over E2B's wss proxy (sshd + websocat ``ProxyCommand``), which is
why ``supports_tcp_ingress=False`` and ``ConnectionInfo.proxy_command`` is set.

The E2B SDK is wrapped behind the small :class:`E2BClient` protocol so this is
unit-testable without the SDK or live credentials. ``SdkE2BClient`` is the real
implementation; its exact SDK calls SHOULD be validated against the installed
``e2b``/``e2b-code-interpreter`` version before production.
"""

from __future__ import annotations

import asyncio
from typing import Protocol

from src.platform.scope_sandbox.provider import (
    ConnectionInfo,
    ProviderCapabilities,
    SandboxInfo,
    SandboxProvider,
    SandboxSpec,
    SandboxState,
)

# SSH-over-wss tunnel: E2B exposes an internal port via a public wss proxy host
# of the form ``{port}-{sandboxId}.e2b.app``; SSH is reached with websocat as a
# ProxyCommand (see docs/proposals + e2b.dev/docs/sandbox/ssh-access).
_SSH_PROXY_PORT = 8081


class E2BClient(Protocol):
    """Minimal surface the provider needs; the real impl wraps the e2b SDK."""

    def create(self, spec: SandboxSpec) -> str:
        """Create a running sandbox, return its id."""

    def pause(self, sandbox_id: str) -> None: ...
    def resume(self, sandbox_id: str) -> None: ...
    def kill(self, sandbox_id: str) -> None: ...
    def get_state(self, sandbox_id: str) -> SandboxState: ...


class E2BProvider(SandboxProvider):
    def __init__(
        self,
        client: E2BClient,
        *,
        domain: str = "e2b.app",
        username: str = "puppy",
    ) -> None:
        self._client = client
        self._domain = domain
        self._username = username

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            name="e2b",
            supports_stop_resume=True,    # pause/resume retains FS + memory
            supports_destroy=True,
            supports_tcp_ingress=False,   # no native public TCP — SSH via wss tunnel
            self_hostable=True,
        )

    def _connection(self, sandbox_id: str, spec_ssh_port: int = 22) -> ConnectionInfo:
        wss = f"wss://{_SSH_PROXY_PORT}-{sandbox_id}.{self._domain}"
        return ConnectionInfo(
            host=sandbox_id,
            port=spec_ssh_port,
            username=self._username,
            proxy_command=f"websocat --binary -B 65536 - {wss}",
            extra={"wss_url": wss},
        )

    # The E2BClient is synchronous (the e2b SDK is blocking), so every call is
    # offloaded to a thread to avoid blocking the event loop.
    async def create(self, spec: SandboxSpec) -> SandboxInfo:
        sandbox_id = await asyncio.to_thread(self._client.create, spec)
        return SandboxInfo(sandbox_id, SandboxState.RUNNING, self._connection(sandbox_id, spec.ssh_port))

    async def start(self, sandbox_id: str) -> SandboxInfo:
        await asyncio.to_thread(self._client.resume, sandbox_id)
        return SandboxInfo(sandbox_id, SandboxState.RUNNING, self._connection(sandbox_id))

    async def stop(self, sandbox_id: str) -> SandboxInfo:
        await asyncio.to_thread(self._client.pause, sandbox_id)
        return SandboxInfo(sandbox_id, SandboxState.STOPPED)

    async def destroy(self, sandbox_id: str) -> None:
        await asyncio.to_thread(self._client.kill, sandbox_id)

    async def status(self, sandbox_id: str) -> SandboxInfo:
        state = await asyncio.to_thread(self._client.get_state, sandbox_id)
        return SandboxInfo(sandbox_id, state)


class SdkE2BClient(E2BClient):
    """Real :class:`E2BClient` over ``e2b_code_interpreter``.

    ⚠️ The SDK call shapes below follow E2B's v2 pause/resume docs but are NOT
    exercised by unit tests (they require live credentials). VALIDATE against
    the installed ``e2b-code-interpreter`` version before production — the
    pause/resume/connect method names have changed across SDK versions. The SDK
    reads ``E2B_API_KEY`` from the environment when ``api_key`` is None.
    """

    def __init__(self, api_key: str | None = None, *, timeout: int = 300) -> None:
        self._api_key = api_key
        self._timeout = timeout

    def _kwargs(self) -> dict:
        return {"api_key": self._api_key} if self._api_key else {}

    def create(self, spec: SandboxSpec) -> str:
        from e2b_code_interpreter import Sandbox  # lazy: keep import off the hot path
        sbx = Sandbox.create(timeout=self._timeout, **self._kwargs())
        return sbx.sandbox_id

    def pause(self, sandbox_id: str) -> None:
        from e2b_code_interpreter import Sandbox
        Sandbox.connect(sandbox_id, **self._kwargs()).pause()

    def resume(self, sandbox_id: str) -> None:
        from e2b_code_interpreter import Sandbox
        Sandbox.resume(sandbox_id, timeout=self._timeout, **self._kwargs())

    def kill(self, sandbox_id: str) -> None:
        from e2b_code_interpreter import Sandbox
        Sandbox.connect(sandbox_id, **self._kwargs()).kill()

    def get_state(self, sandbox_id: str) -> SandboxState:
        from e2b_code_interpreter import Sandbox
        try:
            Sandbox.connect(sandbox_id, **self._kwargs())
            return SandboxState.RUNNING
        except Exception:
            # Paused or gone — the SDK can't cheaply distinguish without a list
            # call; the manager's registry is the authoritative state, this is
            # only a reconciliation hint.
            return SandboxState.UNKNOWN

"""Application service tying the scope-sandbox library to the HTTP API (#9).

Owns a process-level ``ScopeSandboxManager`` per provider (the manager holds the
warm/cold session lifecycle; the durable store is shared), and orchestrates the
end-user "connect" flow:

  resolve scope → acquire/reuse a sandbox for the scope (clone the scope's git
  content on cold create) → ensure SSH is reachable → grant the user a
  short-lived, revocable key (their pasted public key) → hand back the
  connection info + a ready-to-paste VSCode Remote-SSH config block.

Provider-agnostic: E2B (no native TCP → sshd + websocat tunnel provisioned at
runtime, connection carries a ProxyCommand) and Fly (native TCP, sshd baked into
the image) both flow through the same code; only ``ConnectionInfo`` differs.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from src.config import settings
from src.platform.scope_sandbox import scope_provision, ssh_credentials, ssh_e2b
from src.platform.scope_sandbox.factory import provider_from_settings, store_from_settings
from src.platform.scope_sandbox.manager import AcquireResult, ScopeSandboxManager
from src.platform.scope_sandbox.provider import SandboxProvider, SandboxSpec
from src.platform.scope_sandbox.registry import SandboxSessionStore
from src.utils.logger import log_info

# Env key carrying the scope's git remote URL into the sandbox (read by the
# bootstrap to clone the scope on cold create). Server-side only; the access
# key lives in the URL and is never returned to the client.
GIT_URL_ENV = "PUPPY_SCOPE_GIT_URL"

# Short-lived by default — a connect grants ~8h, re-connect renews. Offboarding
# (revoke) or the TTL elapsing both cut access.
DEFAULT_TTL_S = 8 * 3600


@dataclass
class ConnectInfo:
    """What the frontend needs to open VSCode Remote-SSH."""

    provider: str
    state: str
    via: str                 # reused | resumed | created
    host: str
    port: int
    username: str
    proxy_command: str | None
    needs_websocat: bool     # True for E2B (ProxyCommand uses local websocat)
    ssh_config_block: str
    expires_at: float
    connected_users: int


def _scope_service():
    from src.repo.scope_service import ScopeService
    return ScopeService()


class ScopeSandboxService:
    """One per process. Injectable bits keep it unit-testable without live SDKs."""

    def __init__(
        self,
        *,
        store: SandboxSessionStore | None = None,
        scope_lookup=None,
        manager_factory=None,
    ) -> None:
        # Shared durable store across providers (one row per scope).
        self._store = store or store_from_settings(settings)
        # scope_id -> RepoScope-ish object with .project_id / .path / .access_key
        self._scope_lookup = scope_lookup or (lambda sid: _scope_service().get(sid))
        self._manager_factory = manager_factory or self._build_manager
        self._managers: dict[str, ScopeSandboxManager] = {}

    # ── manager wiring ────────────────────────────────────────────────

    def _build_manager(self, provider_name: str) -> ScopeSandboxManager:
        provider = provider_from_settings(settings, name=provider_name)
        return ScopeSandboxManager(
            provider,
            self._store,
            bootstrap=self._make_bootstrap(),
            # offboarding via revoke_user also pulls the user's SSH key
            revoke_hook=ssh_credentials.revoke_ssh_access,
        )

    def _manager(self, provider_name: str | None = None) -> ScopeSandboxManager:
        name = provider_name or settings.SCOPE_SANDBOX_PROVIDER
        mgr = self._managers.get(name)
        if mgr is None:
            mgr = self._manager_factory(name)
            self._managers[name] = mgr
        return mgr

    def _make_bootstrap(self):
        """Cold-create hook: stand up SSH (E2B only) + clone the scope content."""
        async def bootstrap(provider: SandboxProvider, sandbox_id: str, spec: SandboxSpec) -> None:
            # E2B has no native TCP ingress → provision sshd + websocat tunnel at
            # runtime (publickey-only). Fly bakes sshd into the image → skip.
            if not provider.capabilities().supports_tcp_ingress:
                await ssh_e2b.provision_e2b_ssh(provider, sandbox_id)  # no seed key
            git_url = spec.env.get(GIT_URL_ENV, "")
            if git_url:
                await scope_provision.provision_scope_workspace(
                    provider, sandbox_id, git_url=git_url,
                )
        return bootstrap

    # ── git url ───────────────────────────────────────────────────────

    @staticmethod
    def _git_url(public_base: str, access_key: str) -> str:
        return f"{public_base.rstrip('/')}/git/ap/{access_key}.git"

    # ── connect / status / revoke ─────────────────────────────────────

    async def connect(
        self,
        *,
        project_id: str,
        scope_id: str,
        user_id: str,
        user_email: str,
        user_name: str,
        public_key: str,
        public_base: str,
        provider_name: str | None = None,
        ttl_s: int = DEFAULT_TTL_S,
        now: float | None = None,
    ) -> ConnectInfo:
        scope = self._scope_lookup(scope_id)
        if scope is None or scope.project_id != project_id:
            raise LookupError("scope not found in project")

        now = time.time() if now is None else now
        git_url = self._git_url(public_base, scope.access_key)
        mgr = self._manager(provider_name)

        spec = SandboxSpec(scope_id=scope_id, project_id=project_id, env={GIT_URL_ENV: git_url})
        result: AcquireResult = await mgr.acquire(spec, user_id, now=now)
        session = result.session
        provider = mgr.provider
        sid = session.sandbox_id

        # per-user working tree + git identity (#7): push attributes to the person
        await ssh_credentials.provision_user_workspace(
            provider, sid, user_id,
            git_url=git_url, user_email=user_email, user_name=user_name,
        )
        # short-lived, revocable SSH grant (#5)
        expires_at = now + ttl_s
        await ssh_credentials.grant_ssh_access(
            provider, sid, user_id, public_key, expires_at=expires_at,
        )

        conn = session.connection
        host = conn.host if conn else sid
        port = conn.port if conn else 22
        username = conn.username if conn else "user"
        proxy = conn.proxy_command if conn else None
        log_info(
            f"[scope-sandbox] connect scope={scope_id} user={user_id} "
            f"via={result.via.value} provider={session.provider}"
        )
        return ConnectInfo(
            provider=session.provider,
            state=session.state.value,
            via=result.via.value,
            host=host,
            port=port,
            username=username,
            proxy_command=proxy,
            needs_websocat=proxy is not None and "websocat" in proxy,
            ssh_config_block=_ssh_config_block(scope_id, host, port, username, proxy),
            expires_at=expires_at,
            connected_users=len(session.connected_users),
        )

    def status(self, *, project_id: str, scope_id: str, user_id: str) -> dict:
        session = self._store.get(scope_id)
        if session is None or session.project_id != project_id:
            return {"state": "none", "connected": False, "connected_users": 0}
        return {
            "state": session.state.value,
            "provider": session.provider,
            "connected": user_id in session.connected_users,
            "connected_users": len(session.connected_users),
            "sandbox_id": session.sandbox_id,
        }

    async def revoke(self, *, project_id: str, scope_id: str, user_id: str) -> int:
        """Revoke the user's SSH access + drop them from the session. Returns the
        number of users still connected."""
        session = self._store.get(scope_id)
        if session is None or session.project_id != project_id:
            return 0
        mgr = self._manager(session.provider)  # use the provider that owns this box
        return await mgr.revoke_user(scope_id, user_id)


def _ssh_config_block(
    scope_id: str, host: str, port: int, username: str, proxy_command: str | None,
) -> str:
    """A ready-to-paste ``~/.ssh/config`` block (provider-agnostic)."""
    alias = f"puppy-{scope_id[:8]}"
    lines = [
        f"Host {alias}",
        f"    HostName {host}",
        f"    User {username}",
        f"    Port {port}",
        "    IdentityFile ~/.ssh/id_ed25519   # path to YOUR private key",
    ]
    if proxy_command:
        lines.append(f"    ProxyCommand {proxy_command}")
    lines += [
        "    StrictHostKeyChecking no",
        "    UserKnownHostsFile /dev/null",
    ]
    return "\n".join(lines) + "\n"


# Process-level singleton (built lazily so importing the module is cheap).
_SERVICE: ScopeSandboxService | None = None


def get_scope_sandbox_service() -> ScopeSandboxService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = ScopeSandboxService()
    return _SERVICE

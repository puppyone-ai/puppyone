"""Install + start the scope-sync sidecar inside a sandbox (P0 closed loop).

Provider-agnostic: writes the bundled sidecar script into the box and starts the
``watch`` daemon detached, configured from the managed SyncPolicy. Command
builders are pure (unit-tested); the async runner just feeds them to
``provider.exec``. The sidecar then drives checkpoint/publish + consumes
``/scope-sync/events`` (M3) on its own.
"""

from __future__ import annotations

import base64
from pathlib import Path

# The sidecar script has TWO locations:
#  - canonical (repo-root/sandbox/scope-sync-sidecar/) — source of truth, used in
#    dev + by the E2B template build + the local E2E harness;
#  - bundled (this package's _sidecar/) — a byte-identical copy that DOES ship with
#    the deployed backend (the canonical lives outside backend/ and is absent from
#    the deploy image). Kept in sync by test_sidecar_bundle_matches_canonical.
# Prefer the canonical (always fresh in dev); fall back to the bundled copy so the
# deployed backend can always install the sidecar.
_SIDECAR_CANONICAL = (
    Path(__file__).resolve().parents[4] / "sandbox" / "scope-sync-sidecar" / "sync_sidecar.py"
)
_SIDECAR_BUNDLED = Path(__file__).resolve().parent / "_sidecar" / "sync_sidecar.py"

INSTALL_DIR = "~/.puppyone"
SIDECAR_REMOTE = f"{INSTALL_DIR}/sync_sidecar.py"
SIDECAR_LOG = "/tmp/puppy_sidecar.log"


def load_sidecar_script() -> str:
    for src in (_SIDECAR_CANONICAL, _SIDECAR_BUNDLED):
        if src.is_file():
            return src.read_text(encoding="utf-8")
    raise FileNotFoundError(
        f"sidecar script not found at {_SIDECAR_CANONICAL} or {_SIDECAR_BUNDLED}"
    )


def install_command(script_text: str) -> str:
    """Shell command that writes the sidecar script into the box (base64 so no
    quoting/newline hazards)."""
    b64 = base64.b64encode(script_text.encode("utf-8")).decode("ascii")
    return f"mkdir -p {INSTALL_DIR} && printf %s '{b64}' | base64 -d > {SIDECAR_REMOTE}"


def _shq(v: str) -> str:
    """Single-quote a value for the shell (escape embedded quotes)."""
    return "'" + str(v).replace("'", "'\\''") + "'"


def start_command(env: dict[str, str], *, self_detach: bool = True) -> str:
    """Start the sidecar's watch loop after replacing any prior one.

    ``self_detach=True`` (SSH-based providers like Fly): the command detaches
    itself (setsid + & + echo) so the exec returns immediately.

    ``self_detach=False`` (E2B): a FOREGROUND long-runner — E2B's ``commands.run``
    kills the process tree on return, so a self-detaching ``&`` does NOT survive;
    the caller must background it via ``provider.exec(..., background=True)``."""
    prefix = " ".join(f"{k}={_shq(v)}" for k, v in sorted(env.items()))
    if self_detach:
        # SSH/Fly: one command — replace prior sidecar, then self-detach.
        return (
            f"pkill -f '[s]ync_sidecar.py' 2>/dev/null; true; "
            f"{prefix} setsid python3 {SIDECAR_REMOTE} watch </dev/null "
            f">{SIDECAR_LOG} 2>&1 & echo sidecar-started"
        )
    # E2B: a CLEAN foreground long-runner (no pkill-chain, no setsid/&) — chaining
    # statements breaks E2B's background launch. The caller pkills separately (see
    # install_and_start) and backgrounds this via exec(background=True).
    return f"{prefix} python3 {SIDECAR_REMOTE} watch </dev/null >{SIDECAR_LOG} 2>&1"


def stop_command() -> str:
    return "pkill -f '[s]ync_sidecar.py' 2>/dev/null; true"


# Agent task-boundary markers (#3): the kinds the sidecar's watch loop acts on.
# publish-kinds → publish now; checkpoint-kinds → checkpoint now. Both stack on
# top of the quiescence fallback.
MARKER_KINDS = ("done", "save", "publish", "verified", "checkpoint", "draft")


def marker_command(kind: str = "done") -> str:
    """Shell command a PuppyOne-aware client runs IN the sandbox to emit a precise
    task-boundary marker (the MCP `sync_signal` tool shells to exactly this; an
    agent over SSH can run it directly). One source of truth for the install path."""
    safe = kind if kind in MARKER_KINDS else "done"
    return f"python3 {SIDECAR_REMOTE} signal {safe}"


def build_sidecar_env(
    policy: dict,
    *,
    repo_dir: str,
    events_url: str,
    project_id: str,
    scope_id: str,
    token: str,
    remote: str = "origin",
    branch: str = "main",
) -> dict[str, str]:
    """Map a resolved SyncPolicy (asdict) → the sidecar's SYNC_* env."""
    return {
        "SYNC_REPO": repo_dir,
        "SYNC_REMOTE": remote,
        "SYNC_BRANCH": branch,
        "SYNC_DEBOUNCE_S": str(policy.get("checkpoint_debounce_s", 4)),
        "SYNC_QUIESCENCE_S": str(policy.get("quiescence_publish_s", 0)),
        "SYNC_MAX_CHECKPOINTS": str(policy.get("checkpoint_chain_max", 100)),
        "SYNC_CHECKPOINT_TTL_S": str(policy.get("checkpoint_chain_ttl_s", 0)),
        "SYNC_CONFLICT_POLICY": str(policy.get("conflict_policy", "agent_auto_resolve")),
        "SYNC_EVENTS_URL": events_url,
        "SYNC_PROJECT_ID": project_id,
        "SYNC_SCOPE_ID": scope_id,
        "SYNC_TOKEN": token,
    }


async def install_and_start(
    provider,
    sandbox_id: str,
    *,
    repo_dir: str,
    env: dict[str, str],
    script_text: str | None = None,
) -> None:
    """Install the sidecar script + start its watch loop in the sandbox.

    Some providers (E2B) kill a command's process tree when the exec returns, so a
    self-detaching ``&`` does not survive — they advertise
    ``background_exec_required`` and we launch the watch as a FOREGROUND command
    via ``provider.exec(..., background=True)``. SSH-based providers (Fly) self-
    detach instead."""
    needs_bg = bool(getattr(provider.capabilities(), "background_exec_required", False))
    await provider.exec(sandbox_id, install_command(script_text or load_sidecar_script()))
    if needs_bg:
        # E2B: pkill any prior sidecar in a SEPARATE foreground exec (chaining it
        # into the backgrounded command breaks E2B's launch), then background a
        # clean foreground watch.
        await provider.exec(sandbox_id, stop_command())
        await provider.exec(sandbox_id, start_command({**env, "SYNC_REPO": repo_dir},
                                                       self_detach=False), background=True)
    else:
        await provider.exec(sandbox_id, start_command({**env, "SYNC_REPO": repo_dir},
                                                       self_detach=True))


async def stop(provider, sandbox_id: str) -> None:
    await provider.exec(sandbox_id, stop_command())

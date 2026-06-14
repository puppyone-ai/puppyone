"""Sidecar install/start command builders + env mapping (pure parts)."""

from __future__ import annotations

import base64

from src.platform.scope_sync.sidecar_provision import (
    SIDECAR_REMOTE,
    build_sidecar_env,
    install_command,
    marker_command,
    start_command,
    stop_command,
)


def test_install_command_base64_writes_script():
    cmd = install_command("print('hi')\n")
    assert "base64 -d >" in cmd and SIDECAR_REMOTE in cmd
    b64 = cmd.split("printf %s '", 1)[1].split("'", 1)[0]
    assert base64.b64decode(b64).decode() == "print('hi')\n"


def test_start_command_detached_with_env_prefix():
    cmd = start_command({"SYNC_REPO": "/home/user/scope", "SYNC_QUIESCENCE_S": "120"})
    assert "setsid python3" in cmd and "watch </dev/null" in cmd
    assert "SYNC_REPO='/home/user/scope'" in cmd and "SYNC_QUIESCENCE_S='120'" in cmd
    assert "[s]ync_sidecar.py" in cmd            # replaces a prior sidecar, no self-kill
    assert cmd.rstrip().endswith("echo sidecar-started")


def test_start_command_single_quotes_values_safely():
    cmd = start_command({"SYNC_EVENTS_URL": "https://x/api/v1/scope-sync/events"})
    assert "SYNC_EVENTS_URL='https://x/api/v1/scope-sync/events'" in cmd


def test_stop_command_uses_bracket_trick():
    assert "[s]ync_sidecar.py" in stop_command()


def test_marker_command_targets_installed_sidecar():
    cmd = marker_command("done")
    assert cmd == f"python3 {SIDECAR_REMOTE} signal done"


def test_marker_command_rejects_unknown_kind():
    # an unknown/injected kind degrades to the safe default rather than passing through
    assert marker_command("rm -rf /") == f"python3 {SIDECAR_REMOTE} signal done"
    assert marker_command("checkpoint").endswith("signal checkpoint")


def test_build_sidecar_env_maps_policy():
    policy = {"checkpoint_debounce_s": 3.0, "quiescence_publish_s": 120.0,
              "checkpoint_chain_max": 50, "checkpoint_chain_ttl_s": 3600.0,
              "conflict_policy": "agent_review"}
    env = build_sidecar_env(
        policy, repo_dir="/home/user/scope",
        events_url="https://api/x/scope-sync/events",
        project_id="p1", scope_id="s1", token="tok",
    )
    assert env["SYNC_REPO"] == "/home/user/scope"
    assert env["SYNC_DEBOUNCE_S"] == "3.0" and env["SYNC_QUIESCENCE_S"] == "120.0"
    assert env["SYNC_MAX_CHECKPOINTS"] == "50" and env["SYNC_CHECKPOINT_TTL_S"] == "3600.0"
    assert env["SYNC_CONFLICT_POLICY"] == "agent_review"
    assert env["SYNC_EVENTS_URL"] == "https://api/x/scope-sync/events"
    assert env["SYNC_PROJECT_ID"] == "p1" and env["SYNC_SCOPE_ID"] == "s1" and env["SYNC_TOKEN"] == "tok"


def test_build_sidecar_env_defaults_checkpoint_bounds():
    env = build_sidecar_env({}, repo_dir="/r", events_url="u",
                            project_id="p", scope_id="s", token="t")
    assert env["SYNC_MAX_CHECKPOINTS"] == "100" and env["SYNC_CHECKPOINT_TTL_S"] == "0"


from dataclasses import dataclass


@dataclass
class _Caps:
    background_exec_required: bool = False


class _FakeProvider:
    def __init__(self, *, background_exec_required=False):
        self.calls: list[tuple[str, bool]] = []
        self._caps = _Caps(background_exec_required)

    def capabilities(self):
        return self._caps

    async def exec(self, sandbox_id, command, *, background=False):
        self.calls.append((command, background))
        return {"stdout": "", "exit_code": 0}


async def test_install_and_start_ssh_provider_self_detaches():
    # Fly-like (background_exec_required=False): start command self-detaches,
    # exec runs normally (background=False).
    prov = _FakeProvider(background_exec_required=False)
    from src.platform.scope_sync.sidecar_provision import install_and_start
    await install_and_start(prov, "sb-1", repo_dir="/home/user/scope",
                            env={"SYNC_QUIESCENCE_S": "120"}, script_text="x=1\n")
    assert len(prov.calls) == 2
    install_cmd, install_bg = prov.calls[0]
    start_cmd, start_bg = prov.calls[1]
    assert "base64 -d >" in install_cmd and install_bg is False
    assert "setsid python3" in start_cmd and "& echo sidecar-started" in start_cmd
    assert "SYNC_REPO='/home/user/scope'" in start_cmd and start_bg is False


async def test_install_and_start_e2b_provider_backgrounds_foreground_runner():
    # E2B-like (background_exec_required=True): start is a FOREGROUND command (no
    # setsid/&), launched via exec(background=True) so it survives.
    prov = _FakeProvider(background_exec_required=True)
    from src.platform.scope_sync.sidecar_provision import install_and_start
    await install_and_start(prov, "sb-1", repo_dir="/home/user/scope",
                            env={"SYNC_QUIESCENCE_S": "120"}, script_text="x=1\n")
    # install (fg) → pkill prior (fg) → clean foreground watch (background=True)
    assert "base64 -d >" in prov.calls[0][0] and prov.calls[0][1] is False
    pkill_cmd, pkill_bg = prov.calls[1]
    assert "pkill" in pkill_cmd and pkill_bg is False                   # separate, NOT chained
    start_cmd, start_bg = prov.calls[2]
    assert start_bg is True
    assert "setsid" not in start_cmd and "& echo" not in start_cmd      # not self-detaching
    assert "pkill" not in start_cmd                                     # pkill not chained in
    assert "python3" in start_cmd and "watch" in start_cmd and "SYNC_REPO='/home/user/scope'" in start_cmd


def test_sidecar_bundle_matches_canonical():
    # The bundled copy (shipped with backend) MUST be byte-identical to the
    # canonical sidecar source — guards against drift when the canonical changes.
    from src.platform.scope_sync.sidecar_provision import _SIDECAR_BUNDLED, _SIDECAR_CANONICAL
    assert _SIDECAR_BUNDLED.is_file(), "bundled sidecar copy missing from backend package"
    if _SIDECAR_CANONICAL.is_file():
        assert _SIDECAR_BUNDLED.read_bytes() == _SIDECAR_CANONICAL.read_bytes(), (
            "bundled sidecar drifted from canonical — re-copy "
            "sandbox/scope-sync-sidecar/sync_sidecar.py into backend/.../_sidecar/"
        )

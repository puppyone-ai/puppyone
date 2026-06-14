"""Sidecar install/start command builders + env mapping (pure parts)."""

from __future__ import annotations

import base64

from src.platform.scope_sync.sidecar_provision import (
    SIDECAR_REMOTE,
    build_sidecar_env,
    install_command,
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


def test_build_sidecar_env_maps_policy():
    policy = {"checkpoint_debounce_s": 3.0, "quiescence_publish_s": 120.0}
    env = build_sidecar_env(
        policy, repo_dir="/home/user/scope",
        events_url="https://api/x/scope-sync/events",
        project_id="p1", scope_id="s1", token="tok",
    )
    assert env["SYNC_REPO"] == "/home/user/scope"
    assert env["SYNC_DEBOUNCE_S"] == "3.0" and env["SYNC_QUIESCENCE_S"] == "120.0"
    assert env["SYNC_EVENTS_URL"] == "https://api/x/scope-sync/events"
    assert env["SYNC_PROJECT_ID"] == "p1" and env["SYNC_SCOPE_ID"] == "s1" and env["SYNC_TOKEN"] == "tok"


async def test_install_and_start_runs_two_execs():
    calls: list[str] = []

    class FakeProvider:
        async def exec(self, sandbox_id, command):
            calls.append(command)
            return {"stdout": "", "exit_code": 0}

    from src.platform.scope_sync.sidecar_provision import install_and_start
    await install_and_start(FakeProvider(), "sb-1", repo_dir="/home/user/scope",
                            env={"SYNC_QUIESCENCE_S": "120"}, script_text="x=1\n")
    assert len(calls) == 2
    assert "base64 -d >" in calls[0]                          # install
    assert "setsid python3" in calls[1] and "SYNC_REPO='/home/user/scope'" in calls[1]  # start

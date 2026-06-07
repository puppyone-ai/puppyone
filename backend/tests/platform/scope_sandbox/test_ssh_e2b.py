"""Unit tests for the E2B SSH provisioning helpers (pure parts)."""

from __future__ import annotations

from src.platform.scope_sandbox.ssh_e2b import (
    DEFAULT_FORWARD_PORT,
    DEFAULT_SSH_PORT,
    provision_steps,
    ssh_proxy_command,
    vscode_ssh_config_block,
)

PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY puppyone"


def test_provision_steps_order_and_content():
    steps = provision_steps(PUBKEY, forward_port=8081, ssh_port=22)
    assert "authorized_keys" in steps[1] and PUBKEY in steps[1]
    assert "ssh-keygen -A" in steps[2]
    assert "websocat" in steps[3]              # install (idempotent)
    assert "/usr/sbin/sshd -p 22" in steps[4]
    # forwarder is last and detached, bridging the forward port → sshd
    assert "ws-l:0.0.0.0:8081" in steps[-1] and "tcp:127.0.0.1:22" in steps[-1]
    assert "nohup" in steps[-1] and steps[-1].rstrip().endswith("forwarder-started")


def test_provision_steps_sanitizes_quotes_in_key():
    # A key with an embedded quote+command must not break out of the single
    # quoting. After sanitization the step has exactly 4 single quotes
    # (the two pairs: '%s\n' and '<key>') — a stray quote would make 5+.
    steps = provision_steps("ssh-ed25519 ABC'; rm -rf / #", forward_port=1, ssh_port=2)
    assert steps[1].count("'") == 4


def test_ssh_proxy_command():
    cmd = ssh_proxy_command(r"C:\bin\websocat.exe", "8081-abc.e2b.app")
    assert cmd == r"C:\bin\websocat.exe --binary -B 65536 - wss://8081-abc.e2b.app"


def test_vscode_config_block():
    block = vscode_ssh_config_block(
        host_alias="puppy-scope-1",
        wss_host="8081-abc.e2b.app",
        key_path=r"C:\keys\id_ed25519",
        websocat_path=r"C:\bin\websocat.exe",
    )
    assert "Host puppy-scope-1" in block
    assert "HostName 8081-abc.e2b.app" in block
    assert "ProxyCommand C:\\bin\\websocat.exe --binary -B 65536 - wss://8081-abc.e2b.app" in block
    assert "User user" in block
    assert "StrictHostKeyChecking no" in block


def test_defaults():
    assert DEFAULT_FORWARD_PORT == 8081 and DEFAULT_SSH_PORT == 22

"""Shared command-safety policy for sandbox execution (ISSUE-009).

Both the sandbox HTTP endpoint (``connectors/sandbox_endpoint``) and the agent
bash tool (``connectors/agent``) route execution through
``SandboxService.exec``.  Enforcing the forbidden-pattern blacklist here — at
the single choke point — prevents per-caller policy drift, where one entry path
(the agent tool) historically skipped the validation the endpoint applied.

This is a defense-in-depth layer only. A regex blacklist is trivially evadable
(``$IFS``, encoding, variable splicing); the decisive isolation control is the
container boundary (see ISSUE-010: network isolation, cap-drop, no-new-privileges,
read-only rootfs).
"""

from __future__ import annotations

import re

# Patterns that must never run in the sandbox regardless of entry point:
# privilege escalation, host pseudo-filesystems, host lifecycle, and the cloud
# instance-metadata IP (SSRF / credential theft).
_FORBIDDEN_PATTERNS = [
    r"\bsudo\b",
    r"/etc/",
    r"/proc/",
    r"/sys/",
    r"/dev/",
    r"(^|\s)mount(\s|$)",
    r"(^|\s)umount(\s|$)",
    r"(^|\s)reboot(\s|$)",
    r"(^|\s)shutdown(\s|$)",
    r"(^|\s)mkfs(\s|$)",
    r"169\.254\.169\.254",
]
_COMPILED = [re.compile(pattern) for pattern in _FORBIDDEN_PATTERNS]


class SandboxCommandRejected(ValueError):
    """Raised when a command matches a forbidden pattern."""


def assert_command_allowed(command: str) -> None:
    """Raise ``SandboxCommandRejected`` if the command hits the blacklist."""
    if not isinstance(command, str):
        return
    for pattern in _COMPILED:
        if pattern.search(command):
            raise SandboxCommandRejected("Command contains forbidden operations")

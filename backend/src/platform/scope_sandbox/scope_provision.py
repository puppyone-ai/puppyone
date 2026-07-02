"""Provision a scope's git workspace inside a sandbox (the cold-path bootstrap).

After a sandbox is CREATED, this makes it a ready working environment for the
scope: clone the scope's content via the PuppyOne git remote and configure git.
The git remote URL embeds the scope access_key (the server-side credential — the
end user never sees it), so all git/CLI inside the sandbox operate on the scope
without exposing the key.

Crucially it sets ``pull.rebase true``: PuppyOne enforces LINEAR history and
rejects merge-commit pushes ("merge commits are not supported; fetch and
rebase onto the remote main branch"), so the correct collaboration workflow is
rebase. Without this default, a user's plain ``git pull`` makes a merge commit
that the server rejects (see docs/proposals/sandbox-collab-session-results-2026-06.md).

Provider-agnostic: uses ``provider.exec`` (works for E2B/Fly). SSH provisioning
(ssh_e2b) is layered separately on top for E2B.
"""

from __future__ import annotations

DEFAULT_WORKDIR = "scope"


def _safe(value: str) -> str:
    # identity/url are server-controlled; strip quotes/newlines defensively so a
    # value can't break out of the shell command.
    return value.replace("'", "").replace('"', "").replace("\n", "").strip()


def provision_scope_steps(
    git_url: str,
    workdir: str,
    user_email: str,
    user_name: str,
) -> list[str]:
    """Ordered shell commands to clone + configure the scope workspace. Pure."""
    wd = _safe(workdir).strip("/") or DEFAULT_WORKDIR
    url = _safe(git_url)
    email = _safe(user_email)
    name = _safe(user_name)
    return [
        "command -v git >/dev/null 2>&1 || (sudo apt-get update -qq && sudo apt-get install -y -qq git)",
        # idempotent: re-running provisioning on sandbox reuse must not fail on an
        # existing clone (a user reconnecting hits this with the tree already there).
        f"test -d ~/{wd}/.git || GIT_TERMINAL_PROMPT=0 git clone {url} ~/{wd}",
        # PuppyOne rejects merge commits → rebase is the only valid pull workflow.
        f"git -C ~/{wd} config pull.rebase true",
        f"git -C ~/{wd} config user.email '{email}'",
        f"git -C ~/{wd} config user.name '{name}'",
    ]


async def provision_scope_workspace(
    provider,
    sandbox_id: str,
    *,
    git_url: str,
    workdir: str = DEFAULT_WORKDIR,
    user_email: str = "user@puppyone.ai",
    user_name: str = "puppyone",
) -> None:
    """Run the clone + git-config steps inside ``sandbox_id`` via provider.exec.
    Raises if any step fails (a bare, unprovisioned workspace is unusable)."""
    for cmd in provision_scope_steps(git_url, workdir, user_email, user_name):
        await provider.exec(sandbox_id, cmd)

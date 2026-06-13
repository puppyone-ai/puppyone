#!/usr/bin/env python3
"""PuppyOne scope-sync sidecar — runs INSIDE the sandbox, beside the agent's SSH.

Self-contained (stdlib only). Implements the two-speed sync over plain git,
mirroring src/platform/scope_sync (which is unit-tested):

  - change → debounced **checkpoint** (commit on a private `work` branch, never
    pushed) — the change lane.
  - long quiescence (or explicit) → **publish** (fetch → rebase work onto the
    scope branch → ff push) — the version lane.
  - upstream paths → **integrate** (sparse checkout) when disjoint.

Config via env (the server hands these via the managed SyncPolicy):
  SYNC_REPO (required, repo dir) · SYNC_REMOTE=origin · SYNC_BRANCH=main
  SYNC_WORK=work · SYNC_DEBOUNCE_S=4 · SYNC_QUIESCENCE_S=180 (0 disables) · SYNC_POLL_S=2

Usage:
  sync_sidecar.py watch                 # the daemon loop
  sync_sidecar.py checkpoint|publish|status
  sync_sidecar.py integrate <path>...   # sparse-pull disjoint upstream paths
  sync_sidecar.py rollback <commit>
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time

REPO = os.environ.get("SYNC_REPO", ".")
REMOTE = os.environ.get("SYNC_REMOTE", "origin")
BRANCH = os.environ.get("SYNC_BRANCH", "main")
WORK = os.environ.get("SYNC_WORK", "work")
DEBOUNCE_S = float(os.environ.get("SYNC_DEBOUNCE_S", "4"))
QUIESCENCE_S = float(os.environ.get("SYNC_QUIESCENCE_S", "180"))
POLL_S = float(os.environ.get("SYNC_POLL_S", "2"))

_ENV = {
    "GIT_AUTHOR_NAME": "puppyone-sync", "GIT_AUTHOR_EMAIL": "sync@puppyone.ai",
    "GIT_COMMITTER_NAME": "puppyone-sync", "GIT_COMMITTER_EMAIL": "sync@puppyone.ai",
    "GIT_TERMINAL_PROMPT": "0",
}


def git(*args: str, check: bool = True, env_extra: dict | None = None) -> tuple[int, str, str]:
    env = {**os.environ, **_ENV, **(env_extra or {})}
    p = subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, env=env)
    if check and p.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.returncode, p.stdout, p.stderr


def dirty_paths() -> set[str]:
    out = git("status", "--porcelain")[1]
    paths = set()
    for line in out.splitlines():
        rest = line[3:] if len(line) > 3 else line.strip()
        if " -> " in rest:
            rest = rest.split(" -> ", 1)[1]
        if rest.strip():
            paths.add(rest.strip().strip('"'))
    return paths


def snapshot_tree() -> str:
    fd, idx = tempfile.mkstemp(prefix="puppy-idx-"); os.close(fd)
    try:
        git("read-tree", "HEAD", env_extra={"GIT_INDEX_FILE": idx})
        git("add", "-A", env_extra={"GIT_INDEX_FILE": idx})
        return git("write-tree", env_extra={"GIT_INDEX_FILE": idx})[1].strip()
    finally:
        try: os.remove(idx)
        except OSError: pass


def checkpoint() -> str | None:
    if not dirty_paths():
        return None
    git("add", "-A")
    git("commit", "--no-verify", "--allow-empty", "-m", f"checkpoint @{int(time.time())}")
    return git("rev-parse", "HEAD")[1].strip()


def publish() -> str:
    checkpoint()  # capture current state first (revertible)
    for _ in range(3):
        git("fetch", REMOTE, BRANCH)
        rc = git("rebase", f"{REMOTE}/{BRANCH}", check=False)[0]
        if rc != 0:
            conflicted = git("diff", "--name-only", "--diff-filter=U", check=False)[1].split()
            git("rebase", "--abort", check=False)
            return f"CONFLICT {' '.join(conflicted)}"
        if git("push", REMOTE, f"HEAD:{BRANCH}", check=False)[0] == 0:
            return f"PUBLISHED {git('rev-parse', 'HEAD')[1].strip()}"
    return "CONFLICT (push race)"


def integrate(paths: list[str]) -> None:
    if not paths:
        return
    git("fetch", REMOTE, BRANCH)
    git("checkout", f"{REMOTE}/{BRANCH}", "--", *paths)


def status() -> str:
    n = git("rev-list", "--count", WORK, check=False)[1].strip() or "?"
    return f"dirty={sorted(dirty_paths())} work_commits={n}"


def watch() -> None:
    # Drive on the working-tree CONTENT hash, not dirty-vs-HEAD: a checkpoint
    # commits the change → the tree goes "clean", but the CONTENT is unchanged,
    # so the content hash is stable across our own commits (only a real edit
    # moves it). This is what makes quiescence-publish fire after a checkpoint.
    base = snapshot_tree()
    last_tree = base            # last content hash we observed
    committed_tree = base       # content hash captured by the last checkpoint
    published_tree = base       # content hash last pushed to SoT
    last_activity = None
    print(f"[sidecar] watching {REPO} (debounce={DEBOUNCE_S}s quiescence={QUIESCENCE_S}s)", flush=True)
    while True:
        now = time.time()
        cur = snapshot_tree()
        if cur != last_tree:                       # a real edit landed
            last_activity, last_tree = now, cur
        if last_activity is not None:
            # debounced checkpoint: uncheckpointed content + edits paused
            if cur != committed_tree and now - last_activity >= DEBOUNCE_S:
                cp = checkpoint()
                if cp:
                    print(f"[sidecar] checkpoint {cp[:10]}", flush=True)
                committed_tree = cur
            # quiescence publish: unpublished content + long idle
            if QUIESCENCE_S > 0 and cur != published_tree and now - last_activity >= QUIESCENCE_S:
                res = publish()
                print(f"[sidecar] publish → {res}", flush=True)
                if res.startswith("PUBLISHED"):
                    published_tree = committed_tree = cur
        time.sleep(POLL_S)


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "status"
    if cmd == "watch":
        watch()
    elif cmd == "checkpoint":
        print(checkpoint() or "clean")
    elif cmd == "publish":
        print(publish())
    elif cmd == "integrate":
        integrate(argv[2:])
        print("integrated")
    elif cmd == "rollback":
        git("reset", "--hard", argv[2])
        print(f"rolled back to {argv[2]}")
    else:
        print(status())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

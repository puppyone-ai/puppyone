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

Precise task boundaries: a PuppyOne-aware client (MCP tool / CLI) can emit an
explicit marker so the sidecar acts at the real end of a work unit instead of
waiting out quiescence. `signal done|save|publish` → publish now; `signal
checkpoint` → checkpoint now. Markers STACK on top of quiescence (the universal
fallback for non-aware clients).

Usage:
  sync_sidecar.py watch                 # the daemon loop
  sync_sidecar.py checkpoint|publish|status
  sync_sidecar.py signal [done|save|publish|checkpoint]   # agent task-boundary marker
  sync_sidecar.py integrate <path>...   # sparse-pull disjoint upstream paths
  sync_sidecar.py rollback <commit>
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = os.environ.get("SYNC_REPO", ".")
REMOTE = os.environ.get("SYNC_REMOTE", "origin")
BRANCH = os.environ.get("SYNC_BRANCH", "main")
WORK = os.environ.get("SYNC_WORK", "work")
DEBOUNCE_S = float(os.environ.get("SYNC_DEBOUNCE_S", "4"))
QUIESCENCE_S = float(os.environ.get("SYNC_QUIESCENCE_S", "180"))
POLL_S = float(os.environ.get("SYNC_POLL_S", "2"))
# Bound the private checkpoint chain (commits ahead of the last publish): too
# many, or too old → compact to one (metadata-only; working tree never touched).
MAX_CHECKPOINTS = int(os.environ.get("SYNC_MAX_CHECKPOINTS", "100"))
CHECKPOINT_TTL_S = float(os.environ.get("SYNC_CHECKPOINT_TTL_S", "0"))
# Upstream event channel (M3): poll PuppyOne for path-scoped "SoT advanced"
# events and integrate lazily. Optional — unset → fall back to plain fetch.
EVENTS_URL = os.environ.get("SYNC_EVENTS_URL", "")        # .../api/v1/scope-sync/events
PROJECT_ID = os.environ.get("SYNC_PROJECT_ID", "")
SCOPE_ID = os.environ.get("SYNC_SCOPE_ID", "")
TOKEN = os.environ.get("SYNC_TOKEN", "")
EVENTS_EVERY = int(os.environ.get("SYNC_EVENTS_EVERY", "3"))  # consume every N polls

# Multi-end same-scope (#6): each end (sandbox/session) is its OWN clone → its own
# private checkpoint lane; publish reconciles all lanes at the shared SoT via
# fetch→rebase→ff-push (disjoint edits auto-merge, only true overlap conflicts).
# LANE labels the end for attribution (checkpoint trailer) + isolates its cursor.
LANE = os.environ.get("SYNC_LANE", "") or socket.gethostname() or "end"
_LANE_SAFE = re.sub(r"[^A-Za-z0-9_.-]", "_", LANE)[:64]
_CURSOR_FILE = f"/tmp/puppy_sync_cursor.{_LANE_SAFE}"
# Publish push-race: another end advanced SoT between our fetch and push. Re-fetch,
# re-rebase (auto-merges its disjoint changes) and retry, with a small backoff.
PUBLISH_ATTEMPTS = int(os.environ.get("SYNC_PUBLISH_ATTEMPTS", "5"))
# Agent task-boundary markers (M2): a PuppyOne-aware client appends a line here
# (via the `signal` subcommand or an MCP tool that shells to it); the watch loop
# drains + acts on it immediately, ahead of the quiescence heuristic.
SIGNAL_FILE = os.environ.get("SYNC_SIGNAL_FILE", "/tmp/puppy_sync_signal")
_PUBLISH_SIGNALS = {"publish", "done", "save", "verified"}
_CHECKPOINT_SIGNALS = {"checkpoint", "draft"}


def _paths_overlap(a, b) -> bool:
    na = {p.strip("/") for p in a}
    nb = {p.strip("/") for p in b}
    return any(x == y or x.startswith(y + "/") or y.startswith(x + "/") for x in na for y in nb)

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


def git_bytes(*args: str, check: bool = True) -> tuple[int, bytes, bytes]:
    """git with raw bytes stdout — for binary-safe blob reads (`git show`)."""
    env = {**os.environ, **_ENV}
    p = subprocess.run(["git", "-C", REPO, *args], capture_output=True, env=env)
    if check and p.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {p.stderr.decode(errors='replace').strip()}")
    return p.returncode, p.stdout, p.stderr


# ── working-tree lock ──────────────────────────────────────────────────
# The watch daemon and any manually-invoked CLI op (an agent running
# `sync_sidecar.py publish`) both mutate the same git index/worktree. Without
# coordination they contend git's own index.lock — and our git() raises
# SystemExit on failure, which would KILL the daemon. A re-entrant, cross-process
# mkdir lock (atomic on POSIX + Windows) serializes our own mutators so git's
# index.lock is never contended by us. Best-effort: a stale lock (dead holder) is
# reclaimed, and a timeout degrades to "proceed" so sync never blocks forever.
LOCK_DIR = os.environ.get("SYNC_LOCK", "/tmp/puppy_sync.lock")
LOCK_TIMEOUT_S = float(os.environ.get("SYNC_LOCK_TIMEOUT_S", "30"))
_lock_depth = 0


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, ValueError):
        return False
    except PermissionError:
        return True          # exists, just not ours to signal
    except OSError:
        return True          # platform without os.kill(0) semantics → assume alive
    return True


def _force_unlock() -> None:
    """Remove the lock dir AND its pid file (rmdir alone fails on a non-empty dir)."""
    with contextlib.suppress(OSError):
        os.remove(os.path.join(LOCK_DIR, "pid"))
    with contextlib.suppress(OSError):
        os.rmdir(LOCK_DIR)


def _reclaim_if_stale() -> bool:
    """If the lock is held by a dead process, remove it. Returns True if reclaimed."""
    try:
        with open(os.path.join(LOCK_DIR, "pid")) as f:
            holder = int(f.read().strip() or "0")
    except (OSError, ValueError):
        return False
    if holder and holder != os.getpid() and not _pid_alive(holder):
        _force_unlock()
        return True
    return False


@contextlib.contextmanager
def worktree_lock():
    """Serialize our own worktree mutations (re-entrant within a process)."""
    global _lock_depth
    if _lock_depth > 0:                      # already held here → re-enter
        _lock_depth += 1
        try:
            yield
        finally:
            _lock_depth -= 1
        return
    deadline = time.time() + LOCK_TIMEOUT_S
    while True:
        try:
            os.mkdir(LOCK_DIR)
            break
        except FileExistsError:
            if _reclaim_if_stale():
                continue
            if time.time() >= deadline:
                print("[sidecar] worktree lock timeout — reclaiming", flush=True)
                _force_unlock()
                continue
            time.sleep(0.05)
    _lock_depth += 1
    with contextlib.suppress(OSError):
        with open(os.path.join(LOCK_DIR, "pid"), "w") as f:
            f.write(str(os.getpid()))
    try:
        yield
    finally:
        _lock_depth -= 1
        with contextlib.suppress(OSError):
            os.remove(os.path.join(LOCK_DIR, "pid"))
        with contextlib.suppress(OSError):
            os.rmdir(LOCK_DIR)


def _atomic_write_bytes(abspath: str, data: bytes) -> None:
    """Write via a temp file in the same dir + rename, so a reader (the agent)
    never sees a half-written file. Atomic on the same filesystem."""
    d = os.path.dirname(abspath) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".puppy-int-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, abspath)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(tmp)
        raise


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


def _chain_base() -> str | None:
    """The last published commit = merge-base of the upstream branch and HEAD.
    Private checkpoints are the commits in ``base..HEAD``."""
    rc, out, _ = git("merge-base", f"{REMOTE}/{BRANCH}", "HEAD", check=False)
    base = out.strip()
    return base if rc == 0 and base else None


def _compact_checkpoints() -> str | None:
    """Collapse the private checkpoint chain into ONE commit when it exceeds the
    count cap or its oldest commit is older than the TTL. Metadata-only:
    ``reset --soft`` keeps the index + working tree, so no edit is ever lost — only
    deep *private* undo points beyond the bound are discarded (publish is the
    durable record). No-op when both bounds are disabled."""
    if MAX_CHECKPOINTS <= 0 and CHECKPOINT_TTL_S <= 0:
        return None
    base = _chain_base()
    if not base:
        return None
    rng = f"{base}..HEAD"
    count = int(git("rev-list", "--count", rng)[1].strip() or "0")
    if count <= 1:
        return None
    over_count = MAX_CHECKPOINTS > 0 and count > MAX_CHECKPOINTS
    over_ttl = False
    if CHECKPOINT_TTL_S > 0:
        times = git("log", "--format=%ct", rng)[1].split()
        if times:
            over_ttl = (int(time.time()) - int(times[-1])) >= CHECKPOINT_TTL_S  # oldest
    if not (over_count or over_ttl):
        return None
    git("reset", "--soft", base)        # collapse; index + working tree preserved
    git("commit", "--no-verify", "--allow-empty",
        "-m", f"checkpoint (compacted {count}) @{int(time.time())}")
    head = git("rev-parse", "HEAD")[1].strip()
    print(f"[sidecar] compacted {count} checkpoints → {head[:10]}", flush=True)
    return head


def checkpoint() -> str | None:
    with worktree_lock():
        if not dirty_paths():
            return None
        git("add", "-A")
        # the Sync-Lane trailer survives rebase → SoT records which end published
        git("commit", "--no-verify", "--allow-empty",
            "-m", f"checkpoint @{int(time.time())}", "-m", f"Sync-Lane: {LANE}")
        _compact_checkpoints()           # keep the private chain bounded
        return git("rev-parse", "HEAD")[1].strip()


def publish() -> str:
    with worktree_lock():
        checkpoint()  # capture current state first (revertible)
        for attempt in range(max(1, PUBLISH_ATTEMPTS)):
            git("fetch", REMOTE, BRANCH)
            rc = git("rebase", f"{REMOTE}/{BRANCH}", check=False)[0]
            if rc != 0:
                conflicted = git("diff", "--name-only", "--diff-filter=U", check=False)[1].split()
                git("rebase", "--abort", check=False)
                return f"CONFLICT {' '.join(conflicted)}"
            if git("push", REMOTE, f"HEAD:{BRANCH}", check=False)[0] == 0:
                return f"PUBLISHED {git('rev-parse', 'HEAD')[1].strip()}"
            # another end won the push race → back off, then re-fetch+rebase+retry
            time.sleep(min(0.05 * (attempt + 1), 0.5))
        return "CONFLICT (push race)"


def integrate(paths: list[str], *, guard_dirty: bool = True) -> tuple[list[str], list[str]]:
    """Sparse-pull upstream paths into the working tree. Returns (applied, held).

    Hardened against agent write contention (the agent edits the same tree):
      - per-path JUST-IN-TIME dirty re-check under the lock → never clobber a path
        the agent is touching (TOCTOU-safe; overlap is HELD, not overwritten);
      - write each file via temp + atomic rename (binary-safe) → the agent never
        observes a half-written file;
      - a path absent upstream (deleted) is HELD, not destructively removed."""
    if not paths:
        return [], []
    applied: list[str] = []
    held: list[str] = []
    with worktree_lock():
        git("fetch", REMOTE, BRANCH)
        dirty = dirty_paths() if guard_dirty else set()
        for p in paths:
            norm = p.strip("/")
            if guard_dirty and _paths_overlap([norm], dirty):
                held.append(p)               # agent is editing this → hold
                continue
            rc, data, _ = git_bytes("show", f"{REMOTE}/{BRANCH}:{norm}", check=False)
            if rc != 0:
                held.append(p)               # not present upstream → don't delete
                continue
            _atomic_write_bytes(os.path.join(REPO, norm), data)
            git("add", "--", norm)
            applied.append(p)
    return applied, held


def consume_events() -> None:
    """Poll the server for path-scoped upstream events and integrate lazily:
    disjoint from the local dirty set → sparse-checkout those paths; overlap →
    hold (skip; the next publish's rebase reconciles it). Optional/guarded."""
    if not (EVENTS_URL and PROJECT_ID and SCOPE_ID):
        return
    try:
        cursor = 0
        if os.path.exists(_CURSOR_FILE):
            cursor = int(open(_CURSOR_FILE).read().strip() or "0")
        # Sidecar authenticates with the scope access_key (X-Access-Key) against
        # the /scope-sync/ap/events endpoint — same credential it clones with.
        url = f"{EVENTS_URL}?cursor={cursor}"
        req = urllib.request.Request(url, headers={"X-Access-Key": TOKEN} if TOKEN else {})
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.load(resp)
        data = body.get("data", body)
        for ev in data.get("events", []):
            paths = ev.get("affected_paths", [])
            if not paths:
                continue
            # integrate() does the per-path JIT dirty-guard + atomic write itself:
            # disjoint paths are applied, overlapping/absent ones held.
            applied, held = integrate(paths)
            if applied:
                print(f"[sidecar] integrated upstream {applied}", flush=True)
            if held:
                print(f"[sidecar] upstream HOLD (overlap) {held}", flush=True)
        if data.get("cursor"):
            open(_CURSOR_FILE, "w").write(str(data["cursor"]))
    except Exception as exc:  # noqa: BLE001 - event polling is best-effort
        print(f"[sidecar] event poll skipped: {exc}", flush=True)


def signal(kind: str = "done") -> str:
    """Record an agent task-boundary marker (CLI/MCP). Appends one line so the
    watch loop drains + acts on it immediately, ahead of quiescence."""
    kind = (kind or "done").strip().lower()
    with open(SIGNAL_FILE, "a") as f:
        f.write(kind + "\n")
    return kind


def _drain_signals() -> list[str]:
    """Atomically claim pending markers: rename the file then read it, so any
    marker written concurrently lands in a fresh file rather than being lost."""
    if not os.path.exists(SIGNAL_FILE):
        return []
    claim = SIGNAL_FILE + ".claim"
    try:
        os.replace(SIGNAL_FILE, claim)   # atomic on POSIX; new writes start fresh
    except OSError:
        return []
    try:
        with open(claim) as f:
            return [ln.strip().lower() for ln in f if ln.strip()]
    finally:
        try:
            os.remove(claim)
        except OSError:
            pass


def status() -> str:
    n = git("rev-list", "--count", WORK, check=False)[1].strip() or "?"
    return f"dirty={sorted(dirty_paths())} work_commits={n}"


def _new_watch_state() -> dict:
    # Drive on the working-tree CONTENT hash, not dirty-vs-HEAD: a checkpoint
    # commits the change → the tree goes "clean", but the CONTENT is unchanged,
    # so the content hash is stable across our own commits (only a real edit
    # moves it). This is what makes quiescence-publish fire after a checkpoint.
    base = snapshot_tree()
    return {
        "last_tree": base,        # last content hash we observed
        "committed_tree": base,   # content hash captured by the last checkpoint
        "published_tree": base,   # content hash last pushed to SoT
        "last_activity": None,
        "loops": 0,
    }


def _do_publish(st: dict, cur: str, why: str) -> None:
    res = publish()                                # publish() checkpoints first
    print(f"[sidecar] publish → {res}{why}", flush=True)
    if res.startswith("PUBLISHED"):
        st["published_tree"] = st["committed_tree"] = cur


def _do_checkpoint(st: dict, cur: str, why: str) -> None:
    cp = checkpoint()
    if cp:
        print(f"[sidecar] checkpoint {cp[:10]}{why}", flush=True)
    st["committed_tree"] = cur


def _handle_signals(st: dict, cur: str, sigs: list[str]) -> bool:
    """Act on an agent task-boundary marker immediately (ahead of quiescence).
    Returns True if a marker was handled (the heuristic path is then skipped)."""
    if not sigs:
        return False
    if any(s in _PUBLISH_SIGNALS for s in sigs):
        _do_publish(st, cur, " (signal)")
        return True
    if any(s in _CHECKPOINT_SIGNALS for s in sigs):
        _do_checkpoint(st, cur, " (signal)")
        return True
    return False


def _watch_step(st: dict, now: float) -> None:
    """One poll iteration (extracted for testability). Order: upstream events →
    agent markers (precise, immediate) → debounced checkpoint → quiescence
    publish (the universal fallback)."""
    st["loops"] += 1
    if EVENTS_URL and st["loops"] % max(1, EVENTS_EVERY) == 0:
        consume_events()

    sigs = _drain_signals()
    cur = snapshot_tree()
    if cur != st["last_tree"]:                     # a real edit landed
        st["last_activity"], st["last_tree"] = now, cur

    if _handle_signals(st, cur, sigs):
        return
    if st["last_activity"] is None:
        return

    idle = now - st["last_activity"]
    # debounced checkpoint: uncheckpointed content + edits paused
    if cur != st["committed_tree"] and idle >= DEBOUNCE_S:
        _do_checkpoint(st, cur, "")
    # quiescence publish: unpublished content + long idle (universal fallback)
    if QUIESCENCE_S > 0 and cur != st["published_tree"] and idle >= QUIESCENCE_S:
        _do_publish(st, cur, "")


def watch() -> None:
    st = _new_watch_state()
    print(f"[sidecar] watching {REPO} (debounce={DEBOUNCE_S}s quiescence={QUIESCENCE_S}s)", flush=True)
    while True:
        _watch_step(st, time.time())
        time.sleep(POLL_S)


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "status"
    if cmd == "watch":
        watch()
    elif cmd == "checkpoint":
        print(checkpoint() or "clean")
    elif cmd == "publish":
        print(publish())
    elif cmd == "signal":
        print(f"signalled {signal(argv[2] if len(argv) > 2 else 'done')}")
    elif cmd == "integrate":
        applied, held = integrate(argv[2:])
        print(f"integrated={applied} held={held}")
    elif cmd == "rollback":
        git("reset", "--hard", argv[2])
        print(f"rolled back to {argv[2]}")
    else:
        print(status())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

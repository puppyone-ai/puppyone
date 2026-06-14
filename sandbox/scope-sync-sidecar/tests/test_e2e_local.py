"""Local end-to-end of the real sync_sidecar.py — no E2B, no network beyond a
localhost stub.

Builds a tiny world that mirrors production topology:

    sot.git (bare)          ← the PuppyOne scope SoT (git remote)
      ├── wt_a  (clone)      ← sandbox working tree, user A
      └── wt_b  (clone)      ← sandbox working tree, user B

and drives the ACTUAL sidecar subcommands over it to prove the closed loop:

  edit in A → checkpoint (private commit) → publish (ff push to SoT)
            → B integrate (sparse pull of A's path)
            → consume_events (HTTP /ap/events with X-Access-Key → integrate)

Run: python -m pytest sandbox/scope-sync-sidecar/tests/test_e2e_local.py -q
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

SIDECAR = Path(__file__).resolve().parents[1] / "sync_sidecar.py"

_GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_TERMINAL_PROMPT": "0",
}


def _git(repo: Path, *args: str) -> str:
    p = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, env={**os.environ, **_GIT_ENV},
    )
    assert p.returncode == 0, f"git {args} failed: {p.stderr}"
    return p.stdout.strip()


def _sidecar(repo: Path, *args: str, env_extra: dict | None = None) -> str:
    env = {**os.environ, **_GIT_ENV, "SYNC_REPO": str(repo),
           "SYNC_BRANCH": "main", "SYNC_REMOTE": "origin", **(env_extra or {})}
    p = subprocess.run(
        [sys.executable, str(SIDECAR), *args],
        capture_output=True, text=True, env=env,
    )
    assert p.returncode == 0, f"sidecar {args} failed: {p.stdout}\n{p.stderr}"
    return p.stdout.strip()


@pytest.fixture()
def world(tmp_path: Path):
    sot = tmp_path / "sot.git"
    sot.mkdir()
    _git(sot, "init", "--bare", "--initial-branch=main")

    # seed the SoT with an initial commit on main via a throwaway clone
    seed = tmp_path / "seed"
    _git(tmp_path, "clone", str(sot), str(seed))
    (seed / "README.md").write_text("scope root\n")
    (seed / "docs").mkdir()
    (seed / "docs" / "intro.md").write_text("intro v1\n")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-m", "seed")
    _git(seed, "push", "origin", "main")

    wt_a = tmp_path / "wt_a"
    wt_b = tmp_path / "wt_b"
    _git(tmp_path, "clone", str(sot), str(wt_a))
    _git(tmp_path, "clone", str(sot), str(wt_b))
    return {"sot": sot, "a": wt_a, "b": wt_b}


def _head(repo: Path, ref: str = "HEAD") -> str:
    return _git(repo, "rev-parse", ref)


def test_checkpoint_publish_integrate(world):
    a, b, sot = world["a"], world["b"], world["sot"]

    # ── A edits + checkpoints (private commit, not pushed) ──────────────
    (a / "docs" / "feature.md").write_text("feature draft\n")
    cp = _sidecar(a, "checkpoint")
    assert cp and cp != "clean"
    # SoT must NOT have advanced yet — checkpoint is private
    assert _head(sot, "main") == _head(b)  # b still at seed
    a_after_cp = _head(a)
    assert a_after_cp == cp

    # editing more then checkpoint again chains commits, still private
    (a / "docs" / "feature.md").write_text("feature draft\nmore\n")
    cp2 = _sidecar(a, "checkpoint")
    assert cp2 != cp
    assert _head(sot, "main") != cp2  # still unpublished

    # ── A publishes → ff push to SoT ───────────────────────────────────
    res = _sidecar(a, "publish")
    assert res.startswith("PUBLISHED"), res
    assert _head(sot, "main") == _head(a)  # SoT now carries A's work

    # ── B integrates the path lazily (sparse pull) ─────────────────────
    assert not (b / "docs" / "feature.md").exists()
    _sidecar(b, "integrate", "docs/feature.md")
    assert (b / "docs" / "feature.md").read_text() == "feature draft\nmore\n"
    # integrate is sparse: it does NOT fast-forward B's branch head
    assert _head(b) != _head(sot, "main")


def test_publish_is_noop_when_clean(world):
    a, sot = world["a"], world["sot"]
    before = _head(sot, "main")
    res = _sidecar(a, "publish")
    # nothing dirty → rebase+push of the unchanged head is a no-op publish
    assert res.startswith("PUBLISHED")
    assert _head(sot, "main") == before


def test_publish_conflict_is_reported_not_crashed(world):
    """A and B edit the SAME line; B publishes first, A's publish must report a
    CONFLICT (and abort cleanly) rather than corrupt or crash."""
    a, b, sot = world["a"], world["b"], world["sot"]

    (b / "docs" / "intro.md").write_text("intro EDITED BY B\n")
    assert _sidecar(b, "publish").startswith("PUBLISHED")

    (a / "docs" / "intro.md").write_text("intro EDITED BY A\n")
    res = _sidecar(a, "publish")
    assert res.startswith("CONFLICT"), res
    assert "docs/intro.md" in res
    # SoT keeps B's version; A's tree is intact (rebase aborted)
    assert _head(sot, "main") == _head(b)
    assert (a / "docs" / "intro.md").read_text() == "intro EDITED BY A\n"


# ── consume_events: HTTP /ap/events (X-Access-Key) → lazy integrate ────

class _EventsHandler(BaseHTTPRequestHandler):
    payload: dict = {}
    seen_key: list = []

    def do_GET(self):
        type(self).seen_key.append(self.headers.get("X-Access-Key"))
        body = json.dumps({"data": self.payload}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # silence
        pass


def test_consume_events_integrates_disjoint_path(world, tmp_path):
    """B's sidecar polls /ap/events, sees an upstream publish of docs/feature.md
    (disjoint from B's dirty set) and sparse-integrates it — exercising the real
    HTTP path + X-Access-Key header."""
    a, b = world["a"], world["b"]

    # A publishes docs/feature.md to the SoT
    (a / "docs" / "feature.md").write_text("from A via events\n")
    assert _sidecar(a, "publish").startswith("PUBLISHED")

    # stub the events endpoint announcing that path
    _EventsHandler.payload = {
        "events": [{"affected_paths": ["docs/feature.md"]}],
        "cursor": 7,
    }
    _EventsHandler.seen_key = []
    srv = HTTPServer(("127.0.0.1", 0), _EventsHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    cursor_file = tmp_path / "cursor"
    code = (
        "import sync_sidecar as s; "
        f"s._CURSOR_FILE = r'{cursor_file}'; "
        "s.consume_events()"
    )
    env = {
        **os.environ, **_GIT_ENV,
        "SYNC_REPO": str(b), "SYNC_BRANCH": "main", "SYNC_REMOTE": "origin",
        "SYNC_EVENTS_URL": f"http://127.0.0.1:{port}/ap/events",
        "SYNC_PROJECT_ID": "p1", "SYNC_SCOPE_ID": "s1", "SYNC_TOKEN": "AKEY123",
        "PYTHONPATH": str(SIDECAR.parent),
    }
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env)
    srv.shutdown()
    assert p.returncode == 0, p.stderr

    # the path was integrated into B, and the access key was sent
    assert (b / "docs" / "feature.md").read_text() == "from A via events\n"
    assert _EventsHandler.seen_key == ["AKEY123"]
    assert cursor_file.read_text().strip() == "7"


def test_signal_marker_publishes_ahead_of_quiescence(world, tmp_path):
    """An agent task-boundary marker (`signal done`) makes the watch loop publish
    immediately — without waiting out the (here very long) quiescence window —
    stacking on top of the heuristic. Exercises signal/_drain_signals + _watch_step
    against a real git world by importing the sidecar with the env preset."""
    a, sot = world["a"], world["sot"]
    import importlib

    sig_file = tmp_path / "sig"
    os.environ.update({
        "SYNC_REPO": str(a), "SYNC_BRANCH": "main", "SYNC_REMOTE": "origin",
        "SYNC_DEBOUNCE_S": "0", "SYNC_QUIESCENCE_S": "99999",  # quiescence effectively off
        "SYNC_SIGNAL_FILE": str(sig_file),
        **_GIT_ENV,
    })
    sys.path.insert(0, str(SIDECAR.parent))
    try:
        s = importlib.import_module("sync_sidecar")
        importlib.reload(s)  # re-read env into module globals

        before = _head(sot, "main")
        (a / "docs" / "intro.md").write_text("edited, awaiting a marker\n")

        st = s._new_watch_state()
        # tick 1: edit observed, but no marker and quiescence is ~forever → no publish
        s._watch_step(st, now=1.0)
        assert _head(sot, "main") == before

        # agent emits the task-boundary marker → next tick publishes immediately
        assert s.signal("done") == "done"
        assert sig_file.read_text() == "done\n"
        s._watch_step(st, now=2.0)
        assert _head(sot, "main") == _head(a)        # SoT advanced on the marker
        assert _head(sot, "main") != before
        assert not sig_file.exists()                 # marker drained (claimed)
    finally:
        for k in ("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_DEBOUNCE_S",
                  "SYNC_QUIESCENCE_S", "SYNC_SIGNAL_FILE"):
            os.environ.pop(k, None)
        sys.path.remove(str(SIDECAR.parent))


def test_drain_signals_is_atomic_claim(tmp_path):
    """_drain_signals renames-then-reads so it returns each marker once and a
    concurrent append isn't lost (lands in a fresh file)."""
    import importlib
    sig_file = tmp_path / "sig"
    os.environ["SYNC_SIGNAL_FILE"] = str(sig_file)
    sys.path.insert(0, str(SIDECAR.parent))
    try:
        s = importlib.import_module("sync_sidecar")
        importlib.reload(s)
        assert s._drain_signals() == []             # nothing pending
        s.signal("checkpoint"); s.signal("done")
        assert s._drain_signals() == ["checkpoint", "done"]
        assert s._drain_signals() == []             # claimed once, now empty
    finally:
        os.environ.pop("SYNC_SIGNAL_FILE", None)
        sys.path.remove(str(SIDECAR.parent))


def _import_sidecar(repo, tmp_path, **extra):
    """Import sync_sidecar with env preset (its module globals read env at load)."""
    import importlib
    os.environ.update({
        "SYNC_REPO": str(repo), "SYNC_BRANCH": "main", "SYNC_REMOTE": "origin",
        "SYNC_LOCK": str(tmp_path / "lock"), **_GIT_ENV, **extra,
    })
    if str(SIDECAR.parent) not in sys.path:
        sys.path.insert(0, str(SIDECAR.parent))
    s = importlib.import_module("sync_sidecar")
    importlib.reload(s)
    return s


def _cleanup_env(*keys):
    for k in keys:
        os.environ.pop(k, None)
    p = str(SIDECAR.parent)
    if p in sys.path:
        sys.path.remove(p)


def test_integrate_holds_dirty_path_just_in_time(world, tmp_path):
    """integrate() is independently safe: a path the agent is editing (dirty) is
    HELD and its working copy is NOT clobbered, even when passed directly without
    consume_events' coarse overlap check."""
    a, b = world["a"], world["b"]
    (a / "extra.md").write_text("a\n")
    # A publishes changes to BOTH intro.md and a new file
    (a / "docs" / "intro.md").write_text("A upstream intro\n")
    assert _sidecar(a, "publish").startswith("PUBLISHED")

    s = _import_sidecar(b, tmp_path)
    try:
        # B has an uncommitted local edit to intro.md (agent mid-task)
        (b / "docs" / "intro.md").write_text("B WORKING COPY do not clobber\n")
        applied, held = s.integrate(["docs/intro.md", "extra.md"])
        assert "docs/intro.md" in held            # dirty → held
        assert "extra.md" in applied              # disjoint → applied
        assert (b / "docs" / "intro.md").read_text() == "B WORKING COPY do not clobber\n"
        assert (b / "extra.md").exists()
    finally:
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK")


def test_integrate_is_binary_safe(world, tmp_path):
    """A binary blob upstream integrates byte-exact (temp+rename, raw bytes)."""
    a, b = world["a"], world["b"]
    blob = bytes(range(256)) * 4
    (a / "logo.bin").write_bytes(blob)
    assert _sidecar(a, "publish").startswith("PUBLISHED")

    s = _import_sidecar(b, tmp_path)
    try:
        applied, held = s.integrate(["logo.bin"])
        assert applied == ["logo.bin"] and not held
        assert (b / "logo.bin").read_bytes() == blob   # exact, not text-mangled
    finally:
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK")


def test_integrate_holds_path_absent_upstream(world, tmp_path):
    s = _import_sidecar(world["b"], tmp_path)
    try:
        applied, held = s.integrate(["does/not/exist.md"])
        assert applied == [] and held == ["does/not/exist.md"]   # not destructively removed
    finally:
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK")


def test_worktree_lock_reentrant_and_releases(world, tmp_path):
    s = _import_sidecar(world["a"], tmp_path)
    try:
        lock_dir = os.environ["SYNC_LOCK"]
        assert not os.path.exists(lock_dir)
        with s.worktree_lock():
            assert os.path.isdir(lock_dir)
            with s.worktree_lock():                 # re-entrant: no deadlock
                assert os.path.isdir(lock_dir)
            assert os.path.isdir(lock_dir)          # inner exit keeps it held
        assert not os.path.exists(lock_dir)         # outer exit releases
    finally:
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK")


def test_worktree_lock_reclaims_stale(world, tmp_path):
    """A lock left by a dead process is reclaimed (via staleness) rather than
    blocking forever. _pid_alive is monkeypatched so the test is deterministic
    cross-platform (os.kill(pid,0) liveness semantics differ on Windows)."""
    s = _import_sidecar(world["a"], tmp_path, SYNC_LOCK_TIMEOUT_S="3")
    orig = s._pid_alive
    s._pid_alive = lambda pid: False                # the holder is dead
    try:
        lock_dir = os.environ["SYNC_LOCK"]
        os.mkdir(lock_dir)
        with open(os.path.join(lock_dir, "pid"), "w") as f:
            f.write("999999")
        with s.worktree_lock():                     # reclaims immediately (stale)
            assert os.path.isdir(lock_dir)
        assert not os.path.exists(lock_dir)
    finally:
        s._pid_alive = orig
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK", "SYNC_LOCK_TIMEOUT_S")


def _count_ahead(repo):
    return int(_git(repo, "rev-list", "--count", "origin/main..HEAD") or "0")


def test_checkpoint_chain_capped_by_count(world, tmp_path):
    """The private checkpoint chain is bounded: past the count cap it compacts to
    one commit, and the working-tree content (latest edit) is never lost."""
    a = world["a"]
    s = _import_sidecar(a, tmp_path, SYNC_MAX_CHECKPOINTS="3", SYNC_CHECKPOINT_TTL_S="0")
    try:
        last = ""
        for i in range(6):
            last = f"draft revision {i}\n"
            (a / "docs" / "intro.md").write_text(last)
            s.checkpoint()
            assert _count_ahead(a) <= 3            # never exceeds the cap
        # the chain compacted at least once, content intact, and publishable
        assert (a / "docs" / "intro.md").read_text() == last
        assert s.publish().startswith("PUBLISHED")
        assert _git(world["sot"], "show", "main:docs/intro.md") == last.strip()
    finally:
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK",
                     "SYNC_MAX_CHECKPOINTS", "SYNC_CHECKPOINT_TTL_S")


def test_checkpoint_chain_capped_by_ttl(world, tmp_path):
    """With the count cap disabled, a checkpoint older than the TTL still triggers
    compaction (so a slow trickle of edits doesn't accumulate forever)."""
    a = world["a"]
    s = _import_sidecar(a, tmp_path, SYNC_MAX_CHECKPOINTS="0", SYNC_CHECKPOINT_TTL_S="1")
    try:
        (a / "docs" / "intro.md").write_text("first\n")
        s.checkpoint()
        assert _count_ahead(a) == 1
        time.sleep(1.2)                            # let the first checkpoint age past TTL
        (a / "docs" / "intro.md").write_text("second\n")
        s.checkpoint()                             # commit→2, then TTL-compact→1
        assert _count_ahead(a) == 1
        assert (a / "docs" / "intro.md").read_text() == "second\n"
    finally:
        _cleanup_env("SYNC_REPO", "SYNC_BRANCH", "SYNC_REMOTE", "SYNC_LOCK",
                     "SYNC_MAX_CHECKPOINTS", "SYNC_CHECKPOINT_TTL_S")


def test_consume_events_holds_on_overlap(world, tmp_path):
    """If the upstream path overlaps B's own dirty edit, the sidecar HOLDs (does
    not clobber B's working copy); the next publish's rebase reconciles it."""
    a, b = world["a"], world["b"]

    (a / "docs" / "intro.md").write_text("A changed intro\n")
    assert _sidecar(a, "publish").startswith("PUBLISHED")

    # B has a local uncommitted edit to the SAME path
    (b / "docs" / "intro.md").write_text("B local uncommitted intro\n")

    _EventsHandler.payload = {"events": [{"affected_paths": ["docs/intro.md"]}], "cursor": 3}
    _EventsHandler.seen_key = []
    srv = HTTPServer(("127.0.0.1", 0), _EventsHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    code = (
        "import sync_sidecar as s; "
        f"s._CURSOR_FILE = r'{tmp_path / 'c'}'; "
        "s.consume_events()"
    )
    env = {
        **os.environ, **_GIT_ENV,
        "SYNC_REPO": str(b), "SYNC_BRANCH": "main", "SYNC_REMOTE": "origin",
        "SYNC_EVENTS_URL": f"http://127.0.0.1:{port}/ap/events",
        "SYNC_PROJECT_ID": "p1", "SYNC_SCOPE_ID": "s1", "SYNC_TOKEN": "K",
        "PYTHONPATH": str(SIDECAR.parent),
    }
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env)
    srv.shutdown()
    assert out.returncode == 0, out.stderr
    assert "HOLD" in out.stdout
    # B's uncommitted edit is preserved (not clobbered by the upstream version)
    assert (b / "docs" / "intro.md").read_text() == "B local uncommitted intro\n"

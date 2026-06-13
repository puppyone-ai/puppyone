"""Git adapter tests against REAL local git repos (bare remote + clones).

Validates the in-sandbox sync git logic — checkpoints as draft commits, publish
as fetch→rebase→ff-push, rebase-conflict detection, sparse integrate — without
any network or PuppyOne server. A bare repo stands in for the scope remote.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from src.platform.scope_sync.coordinator import SyncCoordinator
from src.platform.scope_sync.policy import Persona, policy_for
from src.platform.scope_sync.git_adapters import (
    GitCheckpointStore,
    GitPublisher,
    GitWorkingTree,
    open_repo,
)
from src.platform.scope_sync.ports import PublishOutcome

_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    "GIT_TERMINAL_PROMPT": "0",
}


def _git(cwd, *args):
    import os
    p = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True,
                       env={**os.environ, **_ENV})
    if p.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} @ {cwd}: {p.stderr}")
    return p.stdout.strip()


def _world(tmp: Path) -> tuple[Path, Path]:
    """bare remote + clone A on branches main+work with one base commit."""
    bare = tmp / "remote.git"
    a = tmp / "A"
    _git(tmp, "init", "--bare", str(bare))
    a.mkdir()
    _git(a, "init")
    _git(a, "remote", "add", "origin", str(bare))
    _git(a, "checkout", "-b", "main")
    (a / "base.txt").write_text("base\n")
    _git(a, "add", "-A"); _git(a, "commit", "-m", "base")
    _git(a, "push", "-u", "origin", "main")
    _git(a, "checkout", "-b", "work")
    return a, bare


def _clone(bare: Path, dest: Path) -> Path:
    _git(dest.parent, "clone", str(bare), str(dest))
    _git(dest, "checkout", "main")
    _git(dest, "checkout", "-b", "work")
    return dest


def _repo(d: Path):
    return open_repo(str(d), remote="origin", branch="main", work_branch="work")


# ── working tree ──────────────────────────────────────────────────────

def test_dirty_paths_and_snapshot(tmp_path):
    a, _ = _world(tmp_path)
    wt = GitWorkingTree(_repo(a))
    assert wt.dirty_paths() == set()
    (a / "new.txt").write_text("hi\n")
    assert wt.dirty_paths() == {"new.txt"}
    t1 = wt.snapshot().tree_hash
    (a / "new.txt").write_text("changed\n")
    assert wt.snapshot().tree_hash != t1          # content-addressed tree changes
    # snapshot used a temp index → main index/HEAD untouched (still no commits on work beyond base)
    assert _git(a, "rev-list", "--count", "work") == "1"


def test_checkpoint_chain_then_rollback(tmp_path):
    a, _ = _world(tmp_path)
    r = _repo(a)
    wt, cps = GitWorkingTree(r), GitCheckpointStore(r)
    (a / "f.txt").write_text("v1\n")
    cp1 = cps.save(wt.snapshot(), created_at=1, parent_id=None)
    (a / "f.txt").write_text("v2\n")
    cp2 = cps.save(wt.snapshot(), created_at=2, parent_id=cp1.id)
    assert _git(a, "rev-list", "--count", "work") == "3"   # base + 2 checkpoints
    # rollback to cp1 → working tree back to v1, no remote change
    wt.restore(cp1)
    assert (a / "f.txt").read_text() == "v1\n"


# ── publish ───────────────────────────────────────────────────────────

def test_publish_pushes_to_remote(tmp_path):
    a, bare = _world(tmp_path)
    r = _repo(a)
    wt, cps, pub = GitWorkingTree(r), GitCheckpointStore(r), GitPublisher(r)
    (a / "f.txt").write_text("hello\n")
    cps.save(wt.snapshot(), created_at=1, parent_id=None)
    res = pub.publish(wt.snapshot(), conflict_policy="agent_review")
    assert res.outcome is PublishOutcome.PUBLISHED
    # a fresh clone sees the published content on main
    b = _clone(bare, tmp_path / "B")
    assert (b / "f.txt").read_text() == "hello\n"


def test_publish_conflict_on_overlapping_edit(tmp_path):
    a, bare = _world(tmp_path)
    b = _clone(bare, tmp_path / "B")
    ra, rb = _repo(a), _repo(b)
    # A edits base.txt and publishes
    (a / "base.txt").write_text("from-A\n")
    GitCheckpointStore(ra).save(GitWorkingTree(ra).snapshot(), created_at=1, parent_id=None)
    assert GitPublisher(ra).publish(GitWorkingTree(ra).snapshot(),
                                    conflict_policy="x").outcome is PublishOutcome.PUBLISHED
    # B edits the SAME file and tries to publish → rebase conflict
    (b / "base.txt").write_text("from-B\n")
    GitCheckpointStore(rb).save(GitWorkingTree(rb).snapshot(), created_at=1, parent_id=None)
    res = GitPublisher(rb).publish(GitWorkingTree(rb).snapshot(), conflict_policy="agent_review")
    assert res.outcome is PublishOutcome.CONFLICT
    assert "base.txt" in res.conflict_paths and res.conflict_policy == "agent_review"


def test_disjoint_publish_then_other_publishes_cleanly(tmp_path):
    a, bare = _world(tmp_path)
    b = _clone(bare, tmp_path / "B")
    ra, rb = _repo(a), _repo(b)
    # A publishes a NEW file
    (a / "a.txt").write_text("A\n")
    GitCheckpointStore(ra).save(GitWorkingTree(ra).snapshot(), created_at=1, parent_id=None)
    GitPublisher(ra).publish(GitWorkingTree(ra).snapshot(), conflict_policy="x")
    # B edits a DIFFERENT file → publish rebases cleanly over A's change
    (b / "b.txt").write_text("B\n")
    GitCheckpointStore(rb).save(GitWorkingTree(rb).snapshot(), created_at=1, parent_id=None)
    res = GitPublisher(rb).publish(GitWorkingTree(rb).snapshot(), conflict_policy="x")
    assert res.outcome is PublishOutcome.PUBLISHED
    # final remote has both files
    c = _clone(bare, tmp_path / "C")
    assert (c / "a.txt").exists() and (c / "b.txt").exists()


# ── sparse integrate ──────────────────────────────────────────────────

def test_integrate_brings_disjoint_upstream_path_without_touching_dirty(tmp_path):
    a, bare = _world(tmp_path)
    b = _clone(bare, tmp_path / "B")
    ra = _repo(a)
    # A publishes upstream.txt
    (a / "upstream.txt").write_text("from-upstream\n")
    GitCheckpointStore(ra).save(GitWorkingTree(ra).snapshot(), created_at=1, parent_id=None)
    GitPublisher(ra).publish(GitWorkingTree(ra).snapshot(), conflict_policy="x")
    # B is mid-edit on a different file; integrate only the upstream path
    (b / "mine.txt").write_text("WIP\n")
    GitWorkingTree(_repo(b)).integrate({"upstream.txt"})
    assert (b / "upstream.txt").read_text() == "from-upstream\n"  # pulled
    assert (b / "mine.txt").read_text() == "WIP\n"                 # in-flight edit preserved


# ── end-to-end via the coordinator (local) ───────────────────────────

def test_coordinator_publishes_through_git(tmp_path):
    a, bare = _world(tmp_path)
    r = _repo(a)
    coord = SyncCoordinator(policy_for(Persona.NON_DEV), GitWorkingTree(r),
                            GitCheckpointStore(r), GitPublisher(r), clock=lambda: 0.0)
    from src.platform.scope_sync.policy import SyncAction, TriggerEvent
    (a / "doc.md").write_text("# hi\n")
    # agent finished a task → publish
    assert SyncAction.PUBLISH in coord.handle(TriggerEvent.AGENT_DONE, now=10)
    b = _clone(bare, tmp_path / "B")
    assert (b / "doc.md").read_text() == "# hi\n"


@pytest.fixture(autouse=True)
def _git_available():
    try:
        subprocess.run(["git", "--version"], capture_output=True, check=True)
    except Exception:  # noqa: BLE001
        pytest.skip("git not available")

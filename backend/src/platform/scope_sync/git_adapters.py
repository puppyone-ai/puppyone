"""Git-backed implementations of the sync ports (run inside the sandbox).

The sandbox already has the scope cloned (scope_provision). These adapters drive
the two-speed model with plain git — incremental + content-addressed:

  - GitWorkingTree   : dirty paths (status), tree snapshot (temp index, read-only
                       on the main index), local rollback (reset --hard), and
                       sparse upstream integrate (checkout <remote>/<branch> -- paths).
  - GitCheckpointStore: checkpoints = commits on a private draft branch (``work``),
                       a parent-linked chain, NEVER pushed → the "change" lane.
  - GitPublisher     : fetch → rebase work onto <remote>/<branch> → ff push. Rebase
                       is the only valid workflow against PuppyOne's linear-history
                       remote; a rebase conflict surfaces as a CONFLICT result.

All git runs as the sandbox user; no network except fetch/push.
"""

from __future__ import annotations

import os
import subprocess
import tempfile

from src.platform.scope_sync.ports import Checkpoint, PublishOutcome, PublishResult, TreeSnapshot

_AUTHOR_ENV = {
    "GIT_AUTHOR_NAME": "puppyone-sync",
    "GIT_AUTHOR_EMAIL": "sync@puppyone.ai",
    "GIT_COMMITTER_NAME": "puppyone-sync",
    "GIT_COMMITTER_EMAIL": "sync@puppyone.ai",
    "GIT_TERMINAL_PROMPT": "0",
}


class GitError(RuntimeError):
    pass


class _GitRepo:
    def __init__(self, repo_dir: str, *, remote: str = "origin", branch: str = "main",
                 work_branch: str = "work") -> None:
        self.dir = repo_dir
        self.remote = remote
        self.branch = branch          # the scope branch on the remote (SoT)
        self.work = work_branch       # local private branch holding checkpoint commits

    def git(self, *args: str, check: bool = True, env_extra: dict | None = None) -> tuple[int, str, str]:
        env = {**os.environ, **_AUTHOR_ENV, **(env_extra or {})}
        p = subprocess.run(["git", "-C", self.dir, *args], capture_output=True, text=True, env=env)
        if check and p.returncode != 0:
            raise GitError(f"git {' '.join(args)} failed ({p.returncode}): {p.stderr.strip()}")
        return p.returncode, p.stdout, p.stderr

    def out(self, *args: str) -> str:
        return self.git(*args)[1].strip()


def _porcelain_paths(porcelain: str) -> set[str]:
    paths: set[str] = set()
    for line in porcelain.splitlines():
        if not line.strip():
            continue
        rest = line[3:] if len(line) > 3 else line.strip()
        if " -> " in rest:            # rename: take the destination path
            rest = rest.split(" -> ", 1)[1]
        paths.add(rest.strip().strip('"'))
    return paths


class GitWorkingTree:
    def __init__(self, repo: _GitRepo) -> None:
        self._r = repo

    def dirty_paths(self) -> set[str]:
        return _porcelain_paths(self._r.out("status", "--porcelain"))

    def snapshot(self) -> TreeSnapshot:
        """Tree of the current working state, computed in a TEMP index so the
        main index/HEAD are untouched (read-only). changed_paths = dirty paths."""
        changed = self.dirty_paths()
        fd, idx = tempfile.mkstemp(prefix="puppy-idx-")
        os.close(fd)
        try:
            env = {"GIT_INDEX_FILE": idx}
            self._r.git("read-tree", "HEAD", env_extra=env)
            self._r.git("add", "-A", env_extra=env)
            tree = self._r.git("write-tree", env_extra=env)[1].strip()
        finally:
            try:
                os.remove(idx)
            except OSError:
                pass
        return TreeSnapshot(tree_hash=tree, changed_paths=tuple(sorted(changed)))

    def restore(self, checkpoint: Checkpoint) -> None:
        """Local rollback: reset work + working tree to a checkpoint commit. No SoT change."""
        self._r.git("reset", "--hard", checkpoint.id)

    def integrate(self, paths: set[str]) -> None:
        """Fast-forward only ``paths`` from upstream (sparse checkout of <remote>/<branch>)."""
        if not paths:
            return
        self._r.git("fetch", self._r.remote, self._r.branch)
        self._r.git("checkout", f"{self._r.remote}/{self._r.branch}", "--", *sorted(paths))


class GitCheckpointStore:
    """Checkpoints = commits on the private ``work`` branch (never pushed)."""

    def __init__(self, repo: _GitRepo) -> None:
        self._r = repo

    def save(self, snap: TreeSnapshot, *, created_at: float, parent_id: str | None) -> Checkpoint:
        self._r.git("add", "-A")
        # allow-empty so a checkpoint always advances the chain even if add -A
        # produced no index delta (rare; the coordinator already gates on dirty).
        self._r.git("commit", "--no-verify", "--allow-empty", "-m", f"checkpoint @{created_at:.0f}")
        sha = self._r.out("rev-parse", "HEAD")
        return Checkpoint(id=sha, created_at=created_at, tree_hash=snap.tree_hash,
                          changed_paths=snap.changed_paths, parent_id=parent_id)

    def latest(self) -> Checkpoint | None:
        rc, out, _ = self._r.git("rev-parse", "HEAD", check=False)
        if rc != 0:
            return None
        return Checkpoint(id=out.strip(), created_at=0.0, tree_hash="", changed_paths=())

    def list(self) -> list[Checkpoint]:
        rc, out, _ = self._r.git("rev-list", self._r.work, check=False)
        if rc != 0:
            return []
        return [Checkpoint(id=s, created_at=0.0, tree_hash="", changed_paths=()) for s in out.split()]

    def get(self, checkpoint_id: str) -> Checkpoint | None:
        rc, _, _ = self._r.git("cat-file", "-e", f"{checkpoint_id}^{{commit}}", check=False)
        return Checkpoint(id=checkpoint_id, created_at=0.0, tree_hash="", changed_paths=()) if rc == 0 else None


class GitPublisher:
    def __init__(self, repo: _GitRepo, *, max_retries: int = 2) -> None:
        self._r = repo
        self._max_retries = max_retries

    def fetch(self) -> None:
        self._r.git("fetch", self._r.remote, self._r.branch)

    def publish(self, snap: TreeSnapshot, *, conflict_policy: str) -> PublishResult:
        """Rebase ``work`` onto <remote>/<branch> then ff push (linear history).
        Rebase conflict → abort + return CONFLICT(paths)."""
        for _ in range(self._max_retries + 1):
            self.fetch()
            rc, _, _ = self._r.git("rebase", f"{self._r.remote}/{self._r.branch}", check=False)
            if rc != 0:
                conflicted = self._conflicted_paths()
                self._r.git("rebase", "--abort", check=False)
                return PublishResult(PublishOutcome.CONFLICT, conflict_paths=tuple(sorted(conflicted)),
                                     conflict_policy=conflict_policy)
            push_rc, _, _ = self._r.git("push", self._r.remote, f"HEAD:{self._r.branch}", check=False)
            if push_rc == 0:
                head = self._r.out("rev-parse", "HEAD")
                return PublishResult(PublishOutcome.PUBLISHED, version_id=head)
            # non-ff race: someone pushed between fetch and push → retry
        return PublishResult(PublishOutcome.CONFLICT, conflict_paths=(),
                             conflict_policy=conflict_policy)

    def _conflicted_paths(self) -> set[str]:
        rc, out, _ = self._r.git("diff", "--name-only", "--diff-filter=U", check=False)
        return {p.strip() for p in out.splitlines() if p.strip()} if rc == 0 else set()


def open_repo(repo_dir: str, *, remote: str = "origin", branch: str = "main",
              work_branch: str = "work") -> _GitRepo:
    return _GitRepo(repo_dir, remote=remote, branch=branch, work_branch=work_branch)

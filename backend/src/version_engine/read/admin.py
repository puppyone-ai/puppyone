"""
VersionAdminService — Server-level read operations for the version tree.

Handles:
  - Commit history queries (get_commit_history, get_commit_content)
  - Commit diff (compute_diff)

Project bootstrap (initial empty root) is owned by ``VersionWriteEngine``
— see ``engine.initialize_project_tree``. The legacy ``init_tree`` entry
point on this class is kept as a thin delegate so existing callers keep
working without dragging write logic into the read path.

All writes (including rollback) go through ProductOperationAdapter → Write Engine handlers.
Commits are identified by 40-hex SHA-1 git commit-object IDs (the
hash of the loose-encoded ``commit`` body produced by
``encode_commit``); the old integer ``version`` is no longer used at
any layer.
"""

from __future__ import annotations

import asyncio
import json

from src.version_engine.write_engine.diff import diff_trees
from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.tree import read_tree

from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager


_SCOPE_PROMOTE_TRAILER = "PuppyOne-Source: scope-promote"
_HISTORY_VISIBLE_FETCH_MULTIPLIER = 20
_HISTORY_VISIBLE_FETCH_FLOOR = 1000


class VersionAdminService:
    """Admin operations for version tree: init, version history, diff.

    Regular file writes go through ProductOperationAdapter.
    """

    def __init__(self, repo_manager: VersionRepoManager):
        self._repos = repo_manager

    # ================================================================
    # Initialization (delegated — write happens in L5)
    # ================================================================

    async def init_tree(self, project_id: str) -> str:
        """Initialize an empty version tree for a project.

        Thin delegate to ``VersionWriteEngine.initialize_project_tree``.
        Kept here so existing callers (project router, demo seeding,
        startup) don't need to learn a new entry point, but the actual
        ref write lives in the write engine where it belongs.
        """
        # Local import avoids a cycle: write_engine imports from
        # infrastructure, which imports from this package's __init__.
        from src.version_engine.write_engine.engine import VersionWriteEngine

        engine = VersionWriteEngine(self._repos)
        return await engine.initialize_project_tree(project_id)

    # ================================================================
    # Commit history queries (hash-identity)
    # ================================================================

    async def get_commit_history(
        self,
        project_id: str,
        path: str | None = None,
        limit: int = 50,
        since_commit_id: str = "",
    ) -> list[dict]:
        """Get commit history ordered by ``(created_at ASC, commit_id ASC)``.

        Contract: linear ASC order (oldest first). When ``limit > 0`` we return the
        *newest* ``limit`` commits (the tail of the ASC list), not the
        oldest — so callers asking for "latest 50" actually get the
        most recent 50.

        When *path* is specified we need to fetch a larger batch from
        the DB because the SQL query returns all commits (not just
        those touching the file) and we filter in Python. We cap the
        post-filter result at *limit* so callers always get at most
        the requested number of entries.

        ``since_commit_id`` is an exclusive anchor — commits strictly
        newer than this one are returned. Leave empty to fetch from
        the head (latest).
        """
        repo = self._repos.get_repo(project_id)
        fetch_limit = _history_fetch_limit(limit)
        entries = repo.history.get_since(since_commit_id, limit=fetch_limit)
        entries = [
            e for e in entries
            if _is_user_visible_history_entry(e)
        ]

        if path:
            entries = [
                e for e in entries
                if any(c.get("path") == path for c in e.get("changes", []))
            ]

        if limit > 0:
            # entries is ASC (oldest first) — keep the *tail* so callers
            # asking for "latest 50" see the most recent visible changes,
            # not technical projections or the oldest rows.
            entries = entries[-limit:]

        return entries

    async def get_commit_content(
        self,
        project_id: str,
        path: str,
        commit_id: str,
    ) -> bytes:
        """Get file content at a specific commit."""
        repo = self._repos.get_repo(project_id)
        entry = await asyncio.to_thread(repo.history.get_entry, commit_id)
        if not entry:
            raise ValueError(f"Commit {commit_id} not found")

        resolved = await asyncio.to_thread(
            _resolve_entry_blob, repo.store, entry, path,
        )
        if resolved is None:
            raise ValueError(f"Commit {commit_id} has no root hash")

        _root_hash, _lookup_path, blob_hash = resolved
        if not blob_hash:
            raise FileNotFoundError(f"File {path} not found at {commit_id}")

        return await asyncio.to_thread(repo.store.get, blob_hash)

    async def compute_diff(
        self, project_id: str, from_commit_id: str, to_commit_id: str
    ) -> list[dict]:
        """Compute the diff between two commits."""
        repo = self._repos.get_repo(project_id)

        entry1 = await asyncio.to_thread(repo.history.get_entry, from_commit_id)
        entry2 = await asyncio.to_thread(repo.history.get_entry, to_commit_id)
        if not entry1 or not entry2:
            raise ValueError(f"Commit {from_commit_id} or {to_commit_id} not found")

        root1 = _resolve_entry_root(entry1)
        root2 = _resolve_entry_root(entry2)

        if not root1 or not root2:
            return []

        return await asyncio.to_thread(diff_trees, repo.store, root1, root2)


def _resolve_entry_root(entry: dict) -> str:
    """Extract the best available tree root hash from a history entry.

    Prefers root_hash (full project tree); falls back to scope_hash
    for backwards compatibility with commits recorded before the fix.
    """
    root = entry.get("root_hash", "")
    if root:
        return root
    return entry.get("scope_hash", "")


def _resolve_entry_blob(
    store: ObjectStore,
    entry: dict,
    path: str,
) -> tuple[str, str, str] | None:
    """Resolve a history path against either full-root or scope-root trees.

    History rows store user-facing paths. Scoped Git commits may only carry a
    ``scope_hash`` whose tree is already rooted at ``scope_path``. In that case
    ``New Folder/file.md`` must be looked up as ``file.md`` inside the scope
    tree, otherwise the Changes UI cannot load diffs for scoped commits.
    """
    candidates = _entry_tree_path_candidates(entry, path)
    if not candidates:
        return None

    for root_hash, lookup_path in candidates:
        if not lookup_path:
            continue
        blob_hash = _resolve_path_hash(store, root_hash, lookup_path)
        if blob_hash:
            return root_hash, lookup_path, blob_hash

    root_hash, lookup_path = candidates[0]
    return root_hash, lookup_path, ""


def _entry_tree_path_candidates(entry: dict, path: str) -> list[tuple[str, str]]:
    clean_path = path.strip("/")
    candidates: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(root_hash: str, lookup_path: str | None) -> None:
        if not root_hash or lookup_path is None:
            return
        candidate = (root_hash, lookup_path.strip("/"))
        if candidate in seen:
            return
        seen.add(candidate)
        candidates.append(candidate)

    root_hash = entry.get("root_hash", "") or ""
    add(root_hash, clean_path)

    scope_hash = entry.get("scope_hash", "") or ""
    scoped_path = _path_relative_to_scope(clean_path, entry.get("scope_path", ""))
    add(scope_hash, scoped_path)

    # Compatibility for older rows/callers that already pass paths relative to
    # the scoped tree.
    add(scope_hash, clean_path)
    return candidates


def _path_relative_to_scope(path: str, scope_path: str) -> str | None:
    clean_path = path.strip("/")
    clean_scope = (scope_path or "").strip("/")
    if not clean_scope:
        return clean_path
    if clean_path == clean_scope:
        return ""
    prefix = f"{clean_scope}/"
    if clean_path.startswith(prefix):
        return clean_path[len(prefix):]
    return None


def _history_fetch_limit(limit: int) -> int:
    """Fetch enough raw rows to keep legacy projections out of UI history.

    Older projects may contain internal ``scope-promote`` rows from the
    pre-root-first writer. Product history does not show them. If we fetched
    exactly ``limit`` raw rows and the newest rows were all projections, the UI
    would look empty even though older user commits exist.
    """
    if limit <= 0:
        return 0
    return max(limit * _HISTORY_VISIBLE_FETCH_MULTIPLIER, _HISTORY_VISIBLE_FETCH_FLOOR)


def _is_user_visible_history_entry(entry: dict) -> bool:
    """Return False for projection rows that should not appear in History UI."""
    message = entry.get("message", "") or ""
    if _SCOPE_PROMOTE_TRAILER in message:
        return False

    changes = entry.get("changes") or []
    if isinstance(changes, str):
        try:
            changes = json.loads(changes)
        except Exception:
            changes = []
    if isinstance(changes, list):
        for change in changes:
            if not isinstance(change, dict):
                continue
            action = str(change.get("action") or change.get("op") or "").lower()
            if action == "scope-promote":
                return False
    return True


def _resolve_path_hash(store: ObjectStore, root_hash: str, path: str) -> str:
    """Resolve a file path to its blob hash by navigating the tree — O(depth)."""
    if not root_hash or not path:
        return ""
    parts = [p for p in path.split("/") if p]
    if not parts:
        return ""
    try:
        current = root_hash
        for part in parts[:-1]:
            entries = read_tree(store, current)
            if part not in entries:
                return ""
            typ, h = entries[part]
            if typ != "T":
                return ""
            current = h
        entries = read_tree(store, current)
        leaf = parts[-1]
        if leaf not in entries:
            return ""
        typ, h = entries[leaf]
        return h if typ != "T" else ""
    except Exception:
        return ""

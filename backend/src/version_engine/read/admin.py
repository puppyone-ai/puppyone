"""
VersionAdminService — Server-level admin and history operations for version tree.

Handles:
  - Tree initialization (init_tree)
  - Commit history queries (get_commit_history, get_commit_content)
  - Commit diff (compute_diff)

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
from src.version_engine.write_engine.object_store import ObjectStore
from src.version_engine.write_engine.tree import read_tree
from src.version_engine.write_engine.git_object_format import EMPTY_TREE_SHA1

from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.utils.logger import log_info, log_warning


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
    # Initialization
    # ================================================================

    async def init_tree(self, project_id: str) -> str:
        """Initialize an empty version tree for a project.

        If the project already has a root_hash and the blob exists in S3,
        no action is taken (idempotent). Returns the root_hash.
        """
        repo = self._repos.get_repo(project_id)
        existing = repo.history.get_root_hash()

        if existing:
            if existing == EMPTY_TREE_SHA1:
                return existing
            backend = repo.store._backend
            if hasattr(backend, "async_exists") and await backend.async_exists(existing):
                return existing
            log_warning(
                f"[VersionAdmin] root_hash {existing} set in PG but missing in S3, re-initializing"
            )

        repo.history.set_root_hash(EMPTY_TREE_SHA1)

        log_info(f"[VersionAdmin] Initialized empty tree for project {project_id}")
        return EMPTY_TREE_SHA1

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

        root = _resolve_entry_root(entry)
        if not root:
            raise ValueError(f"Commit {commit_id} has no root hash")

        blob_hash = await asyncio.to_thread(
            _resolve_path_hash, repo.store, root, path,
        )
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


def _history_fetch_limit(limit: int) -> int:
    """Fetch enough raw rows to keep technical projections out of UI history.

    The history table intentionally contains internal projection commits such as
    ``scope-promote`` because scoped Git refs need them. Product history does
    not. If we fetched exactly ``limit`` raw rows and the newest rows were all
    projections, the UI would look empty even though older user commits exist.
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

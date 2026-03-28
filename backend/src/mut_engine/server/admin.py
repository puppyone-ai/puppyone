"""
MutAdminService — Server-level admin and history operations for MUT tree.

Handles:
  - Tree initialization (init_tree)
  - Version history queries (get_version_history, get_version_content)
  - Version diff (compute_diff)

All writes (including rollback) go through MutOps → MUT protocol handlers.
"""

from __future__ import annotations

import json

from mut.core.object_store import ObjectStore
from mut.core.tree import tree_to_flat
from mut.core.diff import diff_trees

from src.mut_engine.server.repo_manager import MutRepoManager
from src.utils.logger import log_info, log_warning


class MutAdminService:
    """Admin operations for MUT tree: init, version history, diff.

    Regular file writes go through MutOps.
    """

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager

    # ================================================================
    # Initialization
    # ================================================================

    async def init_tree(self, project_id: str) -> str:
        """Initialize an empty Mut tree for a project.

        If the project already has a root_hash and the blob exists in S3,
        no action is taken (idempotent). Returns the root_hash.
        """
        repo = self._repos.get_repo(project_id)
        existing = repo.history.get_root_hash()
        backend = repo.store._backend

        if existing and hasattr(backend, 'async_exists'):
            if await backend.async_exists(existing):
                return existing
            log_warning(f"[MutAdmin] root_hash {existing} set in PG but missing in S3, re-uploading")

        empty_tree = json.dumps({}, sort_keys=True).encode()

        from mut.core.object_store import hash_bytes
        root_hash = hash_bytes(empty_tree)

        if hasattr(backend, 'async_put'):
            await backend.async_put(root_hash, empty_tree)
        else:
            import asyncio
            await asyncio.to_thread(repo.store.put, empty_tree)

        repo.history.set_root_hash(root_hash)
        if not existing:
            repo.history.set_latest_version(0)

        log_info(f"[MutAdmin] Initialized empty tree for project {project_id}")
        return root_hash

    # ================================================================
    # Version history queries
    # ================================================================

    async def get_version_history(
        self,
        project_id: str,
        path: str | None = None,
        limit: int = 50,
        since_version: int = 0,
    ) -> list[dict]:
        """Get version history."""
        repo = self._repos.get_repo(project_id)
        entries = repo.history.get_since(since_version, limit=limit)

        if path:
            entries = [
                e for e in entries
                if any(c.get("path") == path for c in e.get("changes", []))
            ]

        return entries

    async def get_version_content(
        self,
        project_id: str,
        path: str,
        version: int,
    ) -> bytes:
        """Get file content at a specific version."""
        repo = self._repos.get_repo(project_id)
        entry = repo.history.get_entry(version)
        if not entry:
            raise ValueError(f"Version {version} not found")

        root = entry.get("root_hash", "")
        if not root:
            raise ValueError(f"Version {version} has no root hash")

        blob_hash = _resolve_path_hash(repo.store, root, path)
        if not blob_hash:
            raise FileNotFoundError(f"File {path} not found at v{version}")

        return repo.store.get(blob_hash)

    async def compute_diff(
        self, project_id: str, v1: int, v2: int
    ) -> list[dict]:
        """Compute the diff between two versions."""
        repo = self._repos.get_repo(project_id)

        entry1 = repo.history.get_entry(v1)
        entry2 = repo.history.get_entry(v2)
        if not entry1 or not entry2:
            raise ValueError(f"Version {v1} or {v2} not found")

        root1 = entry1.get("root_hash", "")
        root2 = entry2.get("root_hash", "")

        if not root1 or not root2:
            return []

        return diff_trees(repo.store, root1, root2)


def _resolve_path_hash(store: ObjectStore, root_hash: str, path: str) -> str:
    """Resolve a file path to its blob hash within a Merkle tree."""
    if not root_hash:
        return ""
    try:
        flat = tree_to_flat(store, root_hash)
        return flat.get(path, "")
    except Exception:
        return ""

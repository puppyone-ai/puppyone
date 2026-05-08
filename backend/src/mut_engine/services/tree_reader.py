"""
MutTreeReader — Direct read interface for the Mut Merkle tree

Reads the file tree directly from the Merkle tree in the S3 ObjectStore.
This is the sole entry point for all tree browsing and file reading.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from mut.core.object_store import ObjectStore
from mut.core.tree import read_tree, tree_to_flat

from src.infra.file_formats import detect_mime, detect_node_type
from src.mut_engine.server.repo_manager import MutRepoManager
from src.utils.logger import log_error

# `detect_type` is re-exported (alias of `detect_node_type`) so the
# many existing imports of `tree_reader.detect_type` keep working.
# All format knowledge lives in `src.infra.file_formats`.
detect_type = detect_node_type
__all__ = ["detect_type", "detect_mime", "MutEntry", "MutTreeReader"]


@dataclass
class MutEntry:
    """A single entry (file or directory) in the Mut tree."""
    name: str
    path: str
    type: str              # "folder" | "json" | "markdown" | "file"
    content_hash: str | None = None
    size_bytes: int | None = None
    mime_type: str | None = None
    children_count: int | None = None


class MutTreeReader:
    """Read the Mut Merkle tree directly, bypassing PG.

    The sole entry point for all file browsing and content reading.
    Replaces all read operations of ContentNodeRepository + ContentNodeService.
    """

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager

    def list_dir(self, project_id: str, path: str = "") -> list[MutEntry]:
        """List directory contents (similar to ls).

        Reads the Mut tree object directly and returns a list of child entries.
        Empty path = project root directory.
        """
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash for {project_id}: {e}")
            return []
        if not root_hash:
            return []

        tree_hash = root_hash
        if path:
            tree_hash = self._navigate_to_subtree(repo.store, root_hash, path)
            if not tree_hash:
                return []

        try:
            entries = read_tree(repo.store, tree_hash)
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to read tree at {path}: {e}")
            return []

        result = [
            self._build_entry(repo.store, name, typ, hash_val, path)
            for name, (typ, hash_val) in entries.items()
            if name != ".keep"
        ]
        result.sort(key=lambda e: (e.type != "folder", e.name.lower()))
        return result

    def _build_entry(self, store, name: str, typ: str,
                     hash_val: str, parent_path: str) -> MutEntry:
        entry_path = f"{parent_path}/{name}" if parent_path else name
        if typ == "T":
            return MutEntry(
                name=name, path=entry_path, type="folder",
                children_count=self._count_children(store, hash_val),
            )
        return MutEntry(
            name=name, path=entry_path, type=detect_type(name),
            content_hash=hash_val, mime_type=detect_mime(name),
        )

    def read_file(self, project_id: str, path: str) -> bytes:
        """Read file content."""
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            raise FileNotFoundError(f"Project {project_id} is not initialized: {e}")
        if not root_hash:
            raise FileNotFoundError(f"Project {project_id} has no content")

        blob_hash = self._resolve_blob(repo.store, root_hash, path)
        if not blob_hash:
            raise FileNotFoundError(f"File not found: {path}")

        return repo.store.get(blob_hash)

    def stat(self, project_id: str, path: str) -> MutEntry | None:
        """Get information for a single entry (similar to stat)."""
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash for stat: {e}")
            return None
        if not root_hash:
            return None

        if not path:
            return MutEntry(name="", path="", type="folder")

        parent_path = os.path.dirname(path)
        name = os.path.basename(path)

        parent_hash = root_hash
        if parent_path:
            parent_hash = self._navigate_to_subtree(repo.store, root_hash, parent_path)
            if not parent_hash:
                return None

        try:
            entries = read_tree(repo.store, parent_hash)
        except Exception:
            return None

        if name not in entries:
            return None

        typ, hash_val = entries[name]

        if typ == "T":
            child_count = self._count_children(repo.store, hash_val)
            return MutEntry(
                name=name,
                path=path,
                type="folder",
                children_count=child_count,
            )

        return MutEntry(
            name=name,
            path=path,
            type=detect_type(name),
            content_hash=hash_val,
            mime_type=detect_mime(name),
        )

    def list_tree(
        self, project_id: str, path: str = "", max_depth: int = -1
    ) -> list[MutEntry]:
        """Recursively list the directory tree (for a full tree view).

        max_depth = -1 means unlimited recursion.
        """
        try:
            repo = self._repos.get_repo(project_id)
            root_hash = repo.history.get_root_hash()
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash for list_tree: {e}")
            return []
        if not root_hash:
            return []

        tree_hash = root_hash
        if path:
            tree_hash = self._navigate_to_subtree(repo.store, root_hash, path)
            if not tree_hash:
                return []

        result: list[MutEntry] = []
        self._walk_tree(repo.store, tree_hash, path, result, 0, max_depth)
        return result

    def exists(self, project_id: str, path: str) -> bool:
        """Check whether a path exists."""
        return self.stat(project_id, path) is not None

    def get_root_hash(self, project_id: str) -> str:
        """Get the current root hash of the project."""
        try:
            repo = self._repos.get_repo(project_id)
            return repo.history.get_root_hash() or ""
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get root hash: {e}")
            return ""

    def get_head_commit_id(self, project_id: str) -> str:
        """Get the project's current global head commit_id (may be empty).

        Returns the commit_id of the most recent commit across all scopes.
        """
        try:
            repo = self._repos.get_repo(project_id)
            return repo.history.get_head_commit_id() or ""
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get head commit_id: {e}")
            return ""

    # ── Internal helpers ──

    def _navigate_to_subtree(
        self, store: ObjectStore, root_hash: str, path: str
    ) -> str | None:
        parts = [p for p in path.split("/") if p]
        current = root_hash
        for part in parts:
            try:
                entries = read_tree(store, current)
            except Exception:
                return None
            if part not in entries:
                return None
            typ, h = entries[part]
            if typ != "T":
                return None
            current = h
        return current

    def _resolve_blob(
        self, store: ObjectStore, root_hash: str, path: str
    ) -> str | None:
        """Navigate directly to a blob by path — O(depth) not O(total files)."""
        if not root_hash:
            return None
        parts = [p for p in path.split("/") if p]
        if not parts:
            return None
        try:
            current = root_hash
            for part in parts[:-1]:
                entries = read_tree(store, current)
                if part not in entries:
                    return None
                typ, h = entries[part]
                if typ != "T":
                    return None
                current = h
            entries = read_tree(store, current)
            leaf = parts[-1]
            if leaf not in entries:
                return None
            typ, h = entries[leaf]
            if typ == "T":
                return None
            return h
        except Exception:
            return None

    def _count_children(self, store: ObjectStore, tree_hash: str) -> int:
        try:
            entries = read_tree(store, tree_hash)
            return sum(1 for name in entries if name != ".keep")
        except Exception:
            return 0

    def _walk_tree(
        self,
        store: ObjectStore,
        tree_hash: str,
        prefix: str,
        result: list[MutEntry],
        depth: int,
        max_depth: int,
    ) -> None:
        if max_depth >= 0 and depth > max_depth:
            return

        try:
            entries = read_tree(store, tree_hash)
        except Exception:
            return

        for name, (typ, hash_val) in sorted(entries.items()):
            if name == ".keep":
                continue

            entry_path = f"{prefix}/{name}" if prefix else name

            if typ == "T":
                child_count = self._count_children(store, hash_val)
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type="folder",
                    children_count=child_count,
                ))
                self._walk_tree(
                    store, hash_val, entry_path, result, depth + 1, max_depth
                )
            else:
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type=detect_type(name),
                    content_hash=hash_val,
                    mime_type=detect_mime(name),
                ))

"""
MutTreeReader — Direct read interface for the Mut Merkle tree

Reads the file tree directly from the Merkle tree in the S3 ObjectStore.
This is the sole entry point for all tree browsing and file reading.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from mut.core.object_store import ObjectStore
from mut.core.protocol import normalize_path

from src.infra.file_formats import detect_mime, detect_node_type
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.services.object_compat import read_blob_compat, read_tree_compat
from src.utils.logger import log_error

# `detect_type` is re-exported (alias of `detect_node_type`) so the
# many existing imports of `tree_reader.detect_type` keep working.
# All format knowledge lives in `src.infra.file_formats`.
detect_type = detect_node_type
__all__ = ["detect_type", "detect_mime", "MutBlobRead", "MutEntry", "MutTreeReader"]


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
    created_at: str | None = None
    modified_at: str | None = None


@dataclass
class MutBlobRead:
    """Bytes read from a MUT blob, plus the full blob size."""
    content: bytes
    total_size: int
    content_hash: str
    ranged: bool = False


class MutTreeReader:
    """Read the Mut Merkle tree directly, bypassing PG.

    The sole entry point for all file browsing and content reading.
    Replaces all read operations of ContentNodeRepository + ContentNodeService.
    """

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager

    def list_dir_in_scope(
        self,
        project_id: str,
        scope_path: str,
        path: str = "",
        *,
        include_size: bool = False,
    ) -> list[MutEntry]:
        """List from a scope head directly, bypassing project-root projection."""

        try:
            repo = self._repos.get_server_repo(project_id)
            root_hash = repo.get_scope_hash(normalize_path(scope_path)) or ""
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get scope hash for {project_id}: {e}")
            return []
        if not root_hash:
            return []

        rel_path = normalize_path(path)
        tree_hash = root_hash
        if rel_path:
            tree_hash = self._navigate_to_subtree(repo.store, root_hash, rel_path)
            if not tree_hash:
                return []

        try:
            entries = read_tree_compat(repo.store, tree_hash)
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to read scope tree at {path}: {e}")
            return []

        display_path = _join_scope_path(scope_path, rel_path)
        result = [
            self._build_entry(
                repo.store, name, typ, hash_val, display_path,
                include_size=include_size,
            )
            for name, (typ, hash_val) in entries.items()
            if name != ".keep"
        ]
        result.sort(key=lambda e: (e.type != "folder", e.name.lower()))
        return result

    def read_file_in_scope(self, project_id: str, scope_path: str, path: str) -> bytes:
        """Read a scope-relative file from the canonical scope head."""

        try:
            repo = self._repos.get_server_repo(project_id)
            root_hash = repo.get_scope_hash(normalize_path(scope_path)) or ""
        except Exception as e:
            raise FileNotFoundError(f"Project {project_id} is not initialized: {e}")
        if not root_hash:
            raise FileNotFoundError(f"Scope {scope_path!r} has no content")

        blob_hash = self._resolve_blob(repo.store, root_hash, normalize_path(path))
        if not blob_hash:
            raise FileNotFoundError(f"File not found: {path}")
        return read_blob_compat(repo.store, blob_hash)

    def read_file_range_in_scope(
        self,
        project_id: str,
        scope_path: str,
        path: str,
        *,
        start: int = 0,
        limit: int | None = None,
    ) -> MutBlobRead:
        """Read a byte range from a scope-relative file."""

        try:
            repo = self._repos.get_server_repo(project_id)
            root_hash = repo.get_scope_hash(normalize_path(scope_path)) or ""
        except Exception as e:
            raise FileNotFoundError(f"Project {project_id} is not initialized: {e}")
        if not root_hash:
            raise FileNotFoundError(f"Scope {scope_path!r} has no content")

        blob_hash = self._resolve_blob(repo.store, root_hash, normalize_path(path))
        if not blob_hash:
            raise FileNotFoundError(f"File not found: {path}")

        content = read_blob_compat(repo.store, blob_hash)
        if start <= 0 and limit is None:
            return MutBlobRead(
                content=content,
                total_size=len(content),
                content_hash=blob_hash,
                ranged=False,
            )
        safe_start = max(0, start)
        end = len(content) if limit is None else min(len(content), safe_start + limit)
        return MutBlobRead(
            content=content[safe_start:end],
            total_size=len(content),
            content_hash=blob_hash,
            ranged=safe_start > 0 or limit is not None,
        )

    def stat_in_scope(
        self,
        project_id: str,
        scope_path: str,
        path: str,
        *,
        include_size: bool = False,
    ) -> MutEntry | None:
        """Stat a scope-relative path from the canonical scope head."""

        scope_norm = normalize_path(scope_path)
        rel_path = normalize_path(path)
        try:
            repo = self._repos.get_server_repo(project_id)
            root_hash = repo.get_scope_hash(scope_norm) or ""
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get scope hash for stat: {e}")
            return None

        if not rel_path:
            return MutEntry(
                name=os.path.basename(scope_norm),
                path=scope_norm,
                type="folder",
                size_bytes=0 if include_size else None,
            )
        if not root_hash:
            return None

        parent_path = os.path.dirname(rel_path)
        name = os.path.basename(rel_path)
        parent_hash = root_hash
        if parent_path:
            parent_hash = self._navigate_to_subtree(repo.store, root_hash, parent_path)
            if not parent_hash:
                return None

        try:
            entries = read_tree_compat(repo.store, parent_hash)
        except Exception:
            return None
        if name not in entries:
            return None

        typ, hash_val = entries[name]
        display_path = _join_scope_path(scope_norm, rel_path)
        if typ == "T":
            return MutEntry(
                name=name,
                path=display_path,
                type="folder",
                size_bytes=0 if include_size else None,
                children_count=self._count_children(repo.store, hash_val),
            )
        return MutEntry(
            name=name,
            path=display_path,
            type=detect_type(name),
            content_hash=hash_val,
            size_bytes=self._blob_size(repo.store, hash_val) if include_size else None,
            mime_type=detect_mime(name),
        )

    def list_tree_in_scope(
        self,
        project_id: str,
        scope_path: str,
        path: str = "",
        max_depth: int = -1,
        *,
        include_size: bool = False,
        max_entries: int | None = None,
    ) -> list[MutEntry]:
        """Recursively list from a scope head directly."""

        try:
            repo = self._repos.get_server_repo(project_id)
            root_hash = repo.get_scope_hash(normalize_path(scope_path)) or ""
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to get scope hash for list_tree: {e}")
            return []
        if not root_hash:
            return []

        rel_path = normalize_path(path)
        tree_hash = root_hash
        if rel_path:
            tree_hash = self._navigate_to_subtree(repo.store, root_hash, rel_path)
            if not tree_hash:
                return []

        result: list[MutEntry] = []
        self._walk_tree(
            repo.store,
            tree_hash,
            _join_scope_path(scope_path, rel_path),
            result,
            0,
            max_depth,
            include_size=include_size,
            max_entries=max_entries,
        )
        return result

    def list_dir(
        self, project_id: str, path: str = "", *, include_size: bool = False
    ) -> list[MutEntry]:
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
            entries = read_tree_compat(repo.store, tree_hash)
        except Exception as e:
            log_error(f"[MutTreeReader] Failed to read tree at {path}: {e}")
            return []

        result = [
            self._build_entry(
                repo.store, name, typ, hash_val, path,
                include_size=include_size,
            )
            for name, (typ, hash_val) in entries.items()
            if name != ".keep"
        ]
        result.sort(key=lambda e: (e.type != "folder", e.name.lower()))
        return result

    def _build_entry(
        self,
        store,
        name: str,
        typ: str,
        hash_val: str,
        parent_path: str,
        *,
        include_size: bool = False,
    ) -> MutEntry:
        entry_path = f"{parent_path}/{name}" if parent_path else name
        if typ == "T":
            return MutEntry(
                name=name, path=entry_path, type="folder",
                size_bytes=0 if include_size else None,
                children_count=self._count_children(store, hash_val),
            )
        return MutEntry(
            name=name, path=entry_path, type=detect_type(name),
            content_hash=hash_val,
            size_bytes=self._blob_size(store, hash_val) if include_size else None,
            mime_type=detect_mime(name),
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

        return read_blob_compat(repo.store, blob_hash)

    def read_file_range(
        self,
        project_id: str,
        path: str,
        *,
        start: int = 0,
        limit: int | None = None,
    ) -> MutBlobRead:
        """Read a byte range from decoded file content.

        The storage backend keeps git loose-object bytes, not raw file bytes.
        Ranges must be applied after ObjectStore decodes the blob, otherwise
        callers would receive slices of zlib-framed object data.
        """
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

        if start <= 0 and limit is None:
            content = read_blob_compat(repo.store, blob_hash)
            return MutBlobRead(
                content=content,
                total_size=len(content),
                content_hash=blob_hash,
                ranged=False,
            )

        content = read_blob_compat(repo.store, blob_hash)
        safe_start = max(0, start)
        end = len(content) if limit is None else min(len(content), safe_start + limit)
        return MutBlobRead(
            content=content[safe_start:end],
            total_size=len(content),
            content_hash=blob_hash,
            ranged=safe_start > 0 or limit is not None,
        )

    def stat(
        self, project_id: str, path: str, *, include_size: bool = False
    ) -> MutEntry | None:
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
            return MutEntry(
                name="", path="", type="folder",
                size_bytes=0 if include_size else None,
            )

        parent_path = os.path.dirname(path)
        name = os.path.basename(path)

        parent_hash = root_hash
        if parent_path:
            parent_hash = self._navigate_to_subtree(repo.store, root_hash, parent_path)
            if not parent_hash:
                return None

        try:
            entries = read_tree_compat(repo.store, parent_hash)
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
                size_bytes=0 if include_size else None,
                children_count=child_count,
            )

        return MutEntry(
            name=name,
            path=path,
            type=detect_type(name),
            content_hash=hash_val,
            size_bytes=self._blob_size(repo.store, hash_val) if include_size else None,
            mime_type=detect_mime(name),
        )

    def list_tree(
        self,
        project_id: str,
        path: str = "",
        max_depth: int = -1,
        *,
        include_size: bool = False,
        max_entries: int | None = None,
    ) -> list[MutEntry]:
        """Recursively list the directory tree (for a full tree view).

        max_depth = -1 means unlimited recursion.
        max_entries limits returned entries to protect object-store backed
        scopes from unbounded recursive walks.
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
        self._walk_tree(
            repo.store, tree_hash, path, result, 0, max_depth,
            include_size=include_size,
            max_entries=max_entries,
        )
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
                entries = read_tree_compat(store, current)
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
                entries = read_tree_compat(store, current)
                if part not in entries:
                    return None
                typ, h = entries[part]
                if typ != "T":
                    return None
                current = h
            entries = read_tree_compat(store, current)
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
            entries = read_tree_compat(store, tree_hash)
            return sum(1 for name in entries if name != ".keep")
        except Exception:
            return 0

    def _blob_size(self, store: ObjectStore, blob_hash: str) -> int:
        try:
            return len(read_blob_compat(store, blob_hash))
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
        *,
        include_size: bool = False,
        max_entries: int | None = None,
    ) -> None:
        if max_entries is not None and len(result) >= max_entries:
            return
        if max_depth >= 0 and depth > max_depth:
            return

        try:
            entries = read_tree_compat(store, tree_hash)
        except Exception:
            return

        for name, (typ, hash_val) in sorted(entries.items()):
            if name == ".keep":
                continue
            if max_entries is not None and len(result) >= max_entries:
                return

            entry_path = f"{prefix}/{name}" if prefix else name

            if typ == "T":
                child_count = self._count_children(store, hash_val)
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type="folder",
                    size_bytes=0 if include_size else None,
                    children_count=child_count,
                ))
                self._walk_tree(
                    store, hash_val, entry_path, result, depth + 1, max_depth,
                    include_size=include_size,
                    max_entries=max_entries,
                )
            else:
                result.append(MutEntry(
                    name=name,
                    path=entry_path,
                    type=detect_type(name),
                    content_hash=hash_val,
                    size_bytes=self._blob_size(store, hash_val) if include_size else None,
                    mime_type=detect_mime(name),
                ))


def _join_scope_path(scope_path: str, rel_path: str) -> str:
    scope = normalize_path(scope_path)
    rel = normalize_path(rel_path)
    if not scope:
        return rel
    if not rel:
        return scope
    return f"{scope}/{rel}"

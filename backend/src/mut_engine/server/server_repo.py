"""
PuppyOneServerRepo — S3/PG adapter for MUT ServerRepo

Implements the ServerRepo interface required by MUT handlers.py, but backed by
S3 ObjectStore + Supabase History/Audit/Scope instead of a local filesystem.

Key differences from Mut's filesystem-based ServerRepo:
  - No current/ directory — files reconstructed from Merkle tree in S3
  - write_scope_files() stages to memory (for use by build_scope_tree)
  - delete_scope_file() is a no-op (merged_files already reflects deletions)
  - Per-scope versioning via mut_scope_state table (no global lock needed)
  - next_global_version() uses PG atomic update for cross-scope ordering
"""

from __future__ import annotations

import json
import threading
from typing import Optional

from mut.core.object_store import ObjectStore
from mut.core.tree import read_tree, tree_to_flat
from mut.core.protocol import normalize_path
from mut.server.scope_manager import ScopeManager

from src.mut_engine.server.backends.supabase_history import SupabaseHistoryManager
from src.mut_engine.server.backends.supabase_audit import SupabaseAuditManager
from src.utils.logger import log_error


class PuppyOneServerRepo:
    """MUT ServerRepo adapter backed by S3 + Supabase.

    Supports Mut v4 per-scope versioning: each scope independently tracks
    its own version number (scope_version) and Merkle tree hash (scope_hash).
    The global version counter provides cross-scope ordering.
    """

    def __init__(
        self,
        project_id: str,
        project_name: str,
        store: ObjectStore,
        history: SupabaseHistoryManager,
        audit: SupabaseAuditManager,
        scopes: ScopeManager,
    ):
        self._project_id = project_id
        self._project_name = project_name
        self.store = store
        self.history = history
        self.audit = audit
        self.scopes = scopes

        self._scope_locks: dict[str, threading.Lock] = {}
        self._scope_locks_guard = threading.Lock()

        self._pending_scope: dict[str, tuple[str, dict[str, bytes]]] = {}
        self._last_scope_build: Optional[tuple[str, str]] = None

        # In-memory global version counter for atomic increment
        self._version_counter: int | None = None
        self._version_lock = threading.Lock()

    # ── Project info ──

    def get_project_name(self) -> str:
        return self._project_name

    # ── Scope (delegated to ScopeManager) ──

    def add_scope(self, scope_id: str, path: str,
                  exclude: list | None = None) -> dict:
        return self.scopes.add(scope_id, path, exclude)

    # ── Global Version ──

    def get_latest_version(self) -> int:
        return self.history.get_latest_version()

    def set_latest_version(self, version: int) -> None:
        self.history.set_latest_version(version)

    def next_global_version(self) -> int:
        """Atomically increment and return the next global version.

        Thread-safe via threading.Lock (called from asyncio.to_thread).
        """
        with self._version_lock:
            if self._version_counter is None:
                self._version_counter = self.history.get_latest_version()
            self._version_counter += 1
            self.history.set_latest_version(self._version_counter)
            return self._version_counter

    # ── Global Root Hash (deprecated, kept for backwards compat) ──

    def get_root_hash(self) -> str:
        return self.history.get_root_hash()

    def set_root_hash(self, h: str) -> None:
        self.history.set_root_hash(h)

    # ── Per-Scope Version + Hash ──

    def get_scope_version(self, scope_path: str) -> int:
        return self.history.get_scope_version(scope_path)

    def set_scope_version(self, scope_path: str, version: int) -> None:
        self.history.set_scope_version(scope_path, version)

    def get_scope_hash(self, scope_path: str) -> str:
        return self.history.get_scope_hash(scope_path)

    def set_scope_hash(self, scope_path: str, h: str) -> None:
        self.history.set_scope_hash(scope_path, h)

    # ── History ──

    def record_history(
        self, version: int, who: str, message: str,
        scope_path: str, changes: list,
        conflicts: list | None = None,
        scope_hash: str = "", scope_version: str = "",
        root_hash: str = "",
    ) -> None:
        self.history.record(
            version, who, message, scope_path, changes, conflicts,
            root_hash=root_hash, scope_hash=scope_hash,
            scope_version=scope_version,
        )

    def get_history_since(
        self, since_version: int, scope_path: str | None = None, limit: int = 0,
    ) -> list[dict]:
        return self.history.get_since(since_version, scope_path, limit)

    def get_history_entry(self, version: int) -> dict | None:
        return self.history.get_entry(version)

    # ── Audit (delegate) ──

    def record_audit(self, event_type: str, agent_id: str, detail: dict) -> None:
        self.audit.record(event_type, agent_id, detail)

    # ── Lock (threading-based, safe for asyncio.to_thread) ──

    def acquire_lock(self, scope_id: str) -> bool:
        with self._scope_locks_guard:
            if scope_id not in self._scope_locks:
                self._scope_locks[scope_id] = threading.Lock()
            lock = self._scope_locks[scope_id]
        return lock.acquire(blocking=False)

    def release_lock(self, scope_id: str) -> None:
        with self._scope_locks_guard:
            lock = self._scope_locks.get(scope_id)
        if lock:
            try:
                lock.release()
            except RuntimeError:
                pass

    # ── File operations (Merkle tree based, no filesystem) ──

    def list_scope_files(self, scope: dict) -> dict[str, bytes]:
        """Walk the Merkle tree in S3 to reconstruct scope files.

        Prefers scope_hash for the current scope state, falls back to
        global root_hash + tree navigation for backwards compatibility.
        """
        scope_path = normalize_path(scope.get("path", ""))

        # Try scope_hash first (new per-scope versioning)
        scope_hash = self.get_scope_hash(scope_path)
        if scope_hash and self.store.exists(scope_hash):
            return self._files_from_tree(scope_hash, scope_path, scope)

        # Fallback: global root_hash + tree navigation
        root_hash = self.get_root_hash()
        if not root_hash:
            return {}

        try:
            if scope_path:
                subtree_hash = self._navigate_to_subtree(root_hash, scope_path)
                if not subtree_hash:
                    return {}
            else:
                subtree_hash = root_hash

            return self._files_from_tree(subtree_hash, scope_path, scope)
        except Exception as e:
            log_error(f"[ServerRepo] list_scope_files failed: {e}")
            return {}

    def _files_from_tree(self, tree_hash: str, scope_path: str,
                         scope: dict) -> dict[str, bytes]:
        """Extract files from a tree hash, applying exclude filters."""
        excludes = [normalize_path(e) for e in scope.get("exclude", [])]
        flat = tree_to_flat(self.store, tree_hash)
        result: dict[str, bytes] = {}
        for rel_path, blob_hash in flat.items():
            full_rel = f"{scope_path}/{rel_path}" if scope_path else rel_path
            if _is_excluded(full_rel, excludes):
                continue
            result[rel_path] = self.store.get(blob_hash)
        return result

    def write_scope_files(self, scope: dict, files: dict[str, bytes]) -> None:
        """Stage merged files for build_scope_tree (no filesystem write)."""
        key = _scope_key(scope)
        self._pending_scope[key] = (scope.get("path", ""), files)

    def delete_scope_file(self, scope: dict, rel_path: str) -> None:
        """No-op: merged_files dict already reflects deletions."""

    def build_scope_tree(self, scope: dict) -> str:
        """Build Merkle tree for scope files."""
        key = _scope_key(scope)

        if key in self._pending_scope:
            scope_path, files = self._pending_scope.pop(key)
            tree_hash = self._build_tree_from_files(files)
            self._last_scope_build = (scope_path, tree_hash)
            return tree_hash

        # No pending write — return current scope hash or navigate tree
        scope_path = normalize_path(scope.get("path", ""))
        scope_hash = self.get_scope_hash(scope_path)
        if scope_hash and self.store.exists(scope_hash):
            return scope_hash

        root_hash = self.get_root_hash()
        if not root_hash:
            return self.store.put(json.dumps({}, sort_keys=True).encode())

        if scope_path:
            subtree_hash = self._navigate_to_subtree(root_hash, scope_path)
            if subtree_hash:
                return subtree_hash

        return root_hash if not scope_path else self.store.put(
            json.dumps({}, sort_keys=True).encode()
        )

    def build_full_tree(self) -> str:
        """Build full project tree. Fallback for first push (no old root)."""
        if self._last_scope_build:
            scope_path, scope_tree_hash = self._last_scope_build
            self._last_scope_build = None
            prefix = scope_path.strip("/") if scope_path else ""
            if not prefix:
                return scope_tree_hash
            parts = prefix.split("/")
            current = scope_tree_hash
            for part in reversed(parts):
                entries = {part: ["T", current]}
                current = self.store.put(json.dumps(entries, sort_keys=True).encode())
            return current

        root = self.get_root_hash()
        if root:
            return root
        return self.store.put(json.dumps({}, sort_keys=True).encode())

    # ── Internal helpers ──

    def _navigate_to_subtree(self, tree_hash: str, scope_path: str) -> str | None:
        parts = scope_path.split("/") if scope_path else []
        current = tree_hash
        for part in parts:
            if not part:
                continue
            try:
                entries = read_tree(self.store, current)
            except Exception:
                return None
            if part not in entries:
                return None
            typ, h = entries[part]
            if typ != "T":
                return None
            current = h
        return current

    def _build_tree_from_files(self, files: dict[str, bytes]) -> str:
        nested: dict = {}
        for path, content in files.items():
            parts = path.split("/")
            d = nested
            for p in parts[:-1]:
                d = d.setdefault(p, {})
            blob_hash = self.store.put(content)
            d[parts[-1]] = ("B", blob_hash)
        return _write_nested_tree(self.store, nested)


def _scope_key(scope: dict) -> str:
    return scope.get("id", scope.get("path", "_default"))


def _is_excluded(full_rel: str, excludes: list[str]) -> bool:
    return any(
        full_rel.startswith(exc + "/") or full_rel == exc
        for exc in excludes
    )


def _write_nested_tree(store: ObjectStore, node: dict) -> str:
    entries: dict = {}
    for name, val in sorted(node.items()):
        if isinstance(val, tuple):
            entries[name] = list(val)
        else:
            sub_hash = _write_nested_tree(store, val)
            entries[name] = ["T", sub_hash]
    return store.put(json.dumps(entries, sort_keys=True).encode())

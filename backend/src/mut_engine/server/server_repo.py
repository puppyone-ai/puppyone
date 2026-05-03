"""
PuppyOneServerRepo — S3/PG adapter for MUT ServerRepo

Implements the ServerRepo interface required by MUT handlers.py, but backed by
S3 ObjectStore + Supabase History/Audit/Scope instead of a local filesystem.

Key design:
  - All reads go through root_hash (global tree) for cross-scope visibility
  - CAS on scope_hash for concurrency control (no application-level locks)
  - Commits are identified by a 16-hex commit_id (hash of metadata), not
    an integer counter. Linear history is preserved by ordering commits
    on (created_at ASC, commit_id ASC).
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from typing import ClassVar

from mut.core.object_store import ObjectStore
from mut.core.protocol import normalize_path
from mut.core.tree import read_tree, tree_to_flat
from mut.server.scope_manager import ScopeManager

from src.mut_engine.server.backends.supabase_audit import SupabaseAuditManager
from src.mut_engine.server.backends.supabase_history import SupabaseHistoryManager
from src.utils.logger import log_error


class PuppyOneServerRepo:
    """MUT ServerRepo adapter backed by S3 + Supabase.

    All reads go through root_hash for cross-scope visibility.
    CAS on scope_hash for concurrency control — no application-level locks.
    """

    # Process-wide cache for ``list_scope_files`` results, keyed by
    # (project_id, scope_path, scope_hash). Content is immutable
    # under the hash so entries never need invalidation. Bound size
    # so a long-lived process doesn't grow unbounded as scopes
    # advance — older entries fall out FIFO-style.
    #
    # Why class-level rather than instance-level: ``get_server_repo``
    # mints a fresh PuppyOneServerRepo on every API request, but
    # ``handle_push`` calls ``list_scope_files`` AGAIN on every CAS
    # retry inside the same request, AND the next request also
    # benefits from the cache as long as nothing mutated the scope.
    # Putting the dict on the class gives both behaviours from one
    # cache.
    _scope_files_cache: ClassVar[OrderedDict[tuple[str, str, str], dict[str, bytes]]] = OrderedDict()
    _scope_files_cache_lock: ClassVar[threading.Lock] = threading.Lock()
    _SCOPE_FILES_CACHE_MAX: ClassVar[int] = 32

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

        self._pending_scope: dict[str, tuple[str, dict[str, bytes]]] = {}
        self._last_scope_build: tuple[str, str] | None = None

    # ── Project info ──

    def get_project_name(self) -> str:
        return self._project_name

    # ── Scope (delegated to ScopeManager) ──

    def add_scope(self, scope_id: str, path: str,
                  exclude: list | None = None) -> dict:
        return self.scopes.add(scope_id, path, exclude)

    # ── Global Head Commit ──

    def get_head_commit_id(self) -> str:
        return self.history.get_head_commit_id()

    def set_head_commit_id(self, cid: str) -> None:
        self.history.set_head_commit_id(cid)

    # ── Global Root Hash ──
    #
    # Note: only ``cas_update_root_hash`` is exposed on this façade. The
    # unchecked ``set_root_hash`` lives on ``self.history`` and is reserved
    # for the bootstrap path (``MutAdmin.initialize_empty_tree``) and the
    # graft fallback (``services/hooks.py``). Application code MUST go
    # through CAS — exposing a non-CAS setter on ServerRepo invites
    # lost-update bugs (see mut-bug-checklist.md P3-4).

    def get_root_hash(self) -> str:
        return self.history.get_root_hash()

    # ── Per-Scope Head + Hash ──
    #
    # Same contract: only the CAS path (``cas_update_scope``) is exposed
    # for the scope hash. ``history.set_scope_hash`` exists for tests and
    # the legacy rollback fallback, and is intentionally not re-exported.

    def get_scope_head_commit_id(self, scope_path: str) -> str:
        return self.history.get_scope_head_commit_id(scope_path)

    def set_scope_head_commit_id(self, scope_path: str, cid: str) -> None:
        self.history.set_scope_head_commit_id(scope_path, cid)

    def get_scope_hash(self, scope_path: str) -> str:
        return self.history.get_scope_hash(scope_path)

    def get_all_scope_hashes(self) -> dict[str, str]:
        """Snapshot of every scope's current hash for this project.

        Returned as ``{scope_path: scope_hash}``. Used by the post-push
        graft (``services/hooks.py``) to rebuild ``mut_root_hash`` from
        DB state — the canonical source of truth for "where does each
        scope point right now" — instead of reading the previous root
        tree from S3 (a derived artifact). See ``mut-bug-checklist.md``
        P0-5 for the silent-overwrite incident this design closes.
        """
        return self.history.get_all_scope_hashes()

    def cas_update_scope(
        self,
        scope_path: str,
        old_hash: str,
        new_hash: str,
        head_commit_id: str = "",
    ) -> bool:
        """Atomic CAS on (scope_hash, head_commit_id).

        Piggy-backs the matching ``head_commit_id`` onto the same
        Postgres UPDATE so a losing CAS cannot later overwrite the
        winner's head pointer. ``head_commit_id`` is optional only
        for the filesystem interface parity — in practice the push
        handler always passes the fresh commit id it just minted.
        """
        return self.history.cas_update_scope_hash(
            scope_path, old_hash, new_hash,
            head_commit_id=head_commit_id,
        )

    def cas_update_root_hash(self, old_root: str, new_root: str) -> bool:
        """Atomic CAS on root_hash via Postgres RPC."""
        return self.history.cas_update_root_hash(old_root, new_root)

    # ── History ──

    def record_history(
        self, commit_id: str, who: str, message: str,
        scope_path: str, changes: list,
        conflicts: list | None = None,
        scope_hash: str = "",
        root_hash: str = "",
        created_at_iso: str = "",
    ) -> None:
        self.history.record(
            commit_id, who, message, scope_path, changes, conflicts,
            root_hash=root_hash, scope_hash=scope_hash,
            created_at_iso=created_at_iso,
        )

    def get_history_since(
        self, since_commit_id: str,
        scope_path: str | None = None, limit: int = 0,
    ) -> list[dict]:
        return self.history.get_since(since_commit_id, scope_path, limit)

    def get_history_entry(self, commit_id: str) -> dict | None:
        return self.history.get_entry(commit_id)

    # ── Audit (delegate) ──

    def record_audit(self, event_type: str, agent_id: str, detail: dict) -> None:
        self.audit.record(event_type, agent_id, detail)

    # ── Lock (no-op — CAS replaces locks) ──

    def acquire_lock(self, scope_id: str) -> bool:
        return True

    def release_lock(self, scope_id: str) -> None:
        pass

    # ── File operations (Merkle tree based) ──

    def list_scope_files(self, scope: dict) -> dict[str, bytes]:
        """Read the canonical files owned by this MUT scope.

        MUT protocol handlers compare and commit against ``scope_hash``.
        Reading from the materialized project ``root_hash`` here would leak
        grafted child-scope content into the root scope's working set. A
        later root push could then re-commit those child files into root, or
        a root delete could accidentally rewrite a snapshot that no longer
        matches the canonical scope boundary. Frontend reads still use the
        global root through ``MutTreeReader``; protocol reads stay scope-local.

        Bootstrap fallback: if a legacy project has no ``scope_hash`` yet,
        navigate from ``root_hash`` as a best-effort compatibility path.

        Cached on (project_id, scope_path, scope_hash). The cost we're
        avoiding is one ``read_tree`` per tree node plus one ``store.get``
        per blob — on a project with a 26 MB blob this was a 19-second
        round-trip, hit twice per push (once here, once by handle_push's
        ``_flatten_tree_to_bytes``). Cache hits return in microseconds.
        """
        scope_path = normalize_path(scope.get("path", ""))
        scope_hash = self.get_scope_hash(scope_path)

        if scope_hash:
            cache_key = (self._project_id, scope_path, scope_hash)
            with self._scope_files_cache_lock:
                cached = self._scope_files_cache.get(cache_key)
                if cached is not None:
                    self._scope_files_cache.move_to_end(cache_key)
                    return dict(cached)

        result = self._compute_scope_files(scope, scope_path, scope_hash)

        if scope_hash and result:
            self._cache_scope_files(scope_path, scope_hash, result)

        return result

    def _compute_scope_files(
        self, scope: dict, scope_path: str, scope_hash: str,
    ) -> dict[str, bytes]:
        """Walk the tree and download every reachable blob (slow path).

        Split out from ``list_scope_files`` so the cached fast-path
        is a one-line return at the top.
        """
        if scope_hash and self.store.exists(scope_hash):
            return self._files_from_tree(scope_hash, scope_path, scope)

        root_hash = self.get_root_hash()
        if root_hash:
            try:
                if scope_path:
                    subtree_hash = self._navigate_to_subtree(root_hash, scope_path)
                    if subtree_hash:
                        return self._files_from_tree(subtree_hash, scope_path, scope)
                else:
                    return self._files_from_tree(root_hash, scope_path, scope)
            except Exception as e:
                log_error(f"[ServerRepo] list_scope_files fallback from root_hash failed: {e}")

        return {}

    def _cache_scope_files(
        self, scope_path: str, scope_hash: str, files: dict[str, bytes],
    ) -> None:
        """Insert into the FIFO-bounded scope-files cache. Bytes are
        shared by reference — this is a dict-overhead cache, not a
        bytes-copying one."""
        cache_key = (self._project_id, scope_path, scope_hash)
        with self._scope_files_cache_lock:
            self._scope_files_cache[cache_key] = dict(files)
            self._scope_files_cache.move_to_end(cache_key)
            while len(self._scope_files_cache) > self._SCOPE_FILES_CACHE_MAX:
                self._scope_files_cache.popitem(last=False)

    def _files_from_tree(self, tree_hash: str, scope_path: str,
                         scope: dict) -> dict[str, bytes]:
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
        key = _scope_key(scope)
        self._pending_scope[key] = (scope.get("path", ""), files)

    def delete_scope_file(self, scope: dict, rel_path: str) -> None:
        pass

    def build_scope_tree(self, scope: dict) -> str:
        key = _scope_key(scope)

        if key in self._pending_scope:
            scope_path, files = self._pending_scope.pop(key)
            tree_hash = self._build_tree_from_files(files)
            self._last_scope_build = (scope_path, tree_hash)
            # We just built a tree from this exact ``files`` mapping
            # under hash ``tree_hash``. Any subsequent push that hits
            # the same scope_hash can return ``files`` directly from
            # the cache instead of re-walking the tree and
            # re-downloading every blob from S3. Saves the second of
            # the two slow passes per push.
            self._cache_scope_files(
                normalize_path(scope_path), tree_hash, files,
            )
            return tree_hash

        scope_path = normalize_path(scope.get("path", ""))
        scope_hash = self.get_scope_hash(scope_path)
        if scope_hash and self.store.exists(scope_hash):
            return scope_hash

        root_hash = self.get_root_hash()
        if root_hash:
            if scope_path:
                subtree_hash = self._navigate_to_subtree(root_hash, scope_path)
                if subtree_hash:
                    return subtree_hash
            else:
                return root_hash

        return self.store.put(json.dumps({}, sort_keys=True).encode())

    def build_full_tree(self) -> str:
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

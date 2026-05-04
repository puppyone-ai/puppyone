"""
MutEphemeralClient — in-process MUT protocol client.

Used by Agent, Sandbox, MCP, and Web UI to access the MUT tree.
Calls MUT handlers directly (no HTTP), ensuring all access goes
through the protocol with scope enforcement, conflict detection,
and audit logging.

Usage:
    client = MutEphemeralClient(repo_manager, project_id, auth_context)
    files = client.clone()           # {rel_path: bytes}
    client.push({"foo.md": b"new"}, deleted=["old.md"])
"""

from __future__ import annotations

import base64
import json
from datetime import UTC

from mut.core.protocol import PROTOCOL_VERSION
from mut.foundation.hash import hash_bytes as mut_hash
from mut.server.handlers import (
    handle_clone,
    handle_negotiate,
    handle_pull,
    handle_push,
)

from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.server_repo import PuppyOneServerRepo


class MutEphemeralClient:
    """Stateless MUT client that calls handlers in-process.

    Each instance represents one clone → modify → push cycle.
    Commit identity is a 16-hex hash (``head_commit_id``); the old
    integer ``version`` counter is gone.
    """

    def __init__(
        self,
        repo_manager: MutRepoManager,
        project_id: str,
        auth_context: dict,
    ):
        self._repo_manager = repo_manager
        self._project_id = project_id
        self._auth = auth_context

        self._head_commit_id: str = ""
        self._scope: dict = {}
        self._files: dict[str, bytes] = {}
        self._object_hashes: set[str] = set()
        # Populated by clone_lite() instead of clone(): {rel_path: blob_hash}.
        # When non-None it signals the "fast push" path — _build_snapshot
        # reuses these hashes for unchanged files instead of re-hashing
        # downloaded content. push() falls back to the legacy full-content
        # path when this is None.
        self._file_hashes: dict[str, str] | None = None

    @property
    def scope(self) -> dict:
        return self._scope

    @property
    def head_commit_id(self) -> str:
        return self._head_commit_id

    @property
    def files(self) -> dict[str, bytes]:
        return dict(self._files)

    def _get_server_repo(self) -> PuppyOneServerRepo:
        return self._repo_manager.get_server_repo(self._project_id)

    def _set_audit_agent(self, who: str) -> None:
        """Override the agent identity used for audit log entries on the
        next push/pull/clone.

        The cached host-client model needs this because the client is
        reused across requests but each request comes from a different
        authenticated user. ``record_audit`` reads ``auth["agent"]``, so
        we update it before each push (under the per-scope lock so two
        requests don't race on the field).
        """
        self._auth["agent"] = who or "puppyone-host"

    # ── Clone ────────────────────────────────────

    def clone(self) -> dict[str, bytes]:
        """Clone the scope subtree. Returns {rel_path: content}.

        Heavy: walks every reachable blob and downloads its bytes from
        S3, then re-uploads them as base64 across the in-process clone
        boundary. Use only when callers actually need the file content
        (move / trash / hard-delete need to relocate or read existing
        files). Pure-write ops (mkdir / write_file / bulk_write / delete
        by path) should use ``clone_lite`` instead — that builds a
        ``{path: blob_hash}`` map by walking the tree without ever
        touching blob bytes, which lets ``push`` reuse existing hashes
        for unchanged files and only ship the new blob bytes.
        """
        repo = self._get_server_repo()
        result = handle_clone(
            repo, self._auth, {"protocol_version": PROTOCOL_VERSION}
        )

        self._head_commit_id = result.get("head_commit_id", "")
        self._scope = {
            "path": result["scope"]["path"],
            "exclude": result["scope"].get("exclude", []),
            "mode": result["scope"].get("mode", "rw"),
        }

        self._files = {
            path: base64.b64decode(b64)
            for path, b64 in result.get("files", {}).items()
        }

        self._object_hashes = set(result.get("objects", {}).keys())
        self._file_hashes = None  # full-content path; lite map is unused

        return dict(self._files)

    def clone_lite(self) -> dict[str, str]:
        """Lightweight clone: fetch ``{rel_path: blob_hash}`` only.

        Walks the scope's tree concurrently — each level of tree nodes
        is fetched in parallel via a thread pool, so cost is bounded by
        ``tree_depth × per-S3-GET`` instead of ``tree_node_count ×
        per-S3-GET``. The default sequential ``tree_to_flat`` was the
        bottleneck on first-write (the user reported 42s on a moderate
        tree); parallel walk brings that down by an order of magnitude
        while still never loading blob payloads.

        Use this when you only need to push modifications on top of
        the existing tree (mkdir, write_file, bulk_write, path delete)
        — ``push`` will reuse the cloned hashes for unchanged paths
        and only include blob bytes for the entries actually being
        added or replaced.

        Sets ``self._file_hashes``; leaves ``self._files`` empty so any
        caller that mistakenly assumes full content fails loudly rather
        than silently operating on empty bytes.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        from mut.core.protocol import normalize_path
        from mut.core.tree import read_tree

        repo = self._get_server_repo()

        # Mirror handle_clone's auth/scope plumbing without the heavy fetch.
        scope = self._auth.get("_scope") or {}
        scope_path = normalize_path(scope.get("path", ""))
        excludes = [normalize_path(e) for e in scope.get("exclude", [])]

        scope_tree_hash = repo.build_scope_tree(scope)
        flat = self._parallel_tree_walk(repo.store, scope_tree_hash)

        file_hashes: dict[str, str] = {}
        for rel_path, blob_hash in flat.items():
            full_rel = f"{scope_path}/{rel_path}" if scope_path else rel_path
            if any(
                full_rel == ex or full_rel.startswith(ex + "/")
                for ex in excludes
            ):
                continue
            file_hashes[rel_path] = blob_hash

        self._head_commit_id = repo.get_scope_head_commit_id(scope_path)
        self._scope = {
            "path": scope.get("path", ""),
            "exclude": scope.get("exclude", []),
            "mode": scope.get("mode", "rw"),
        }
        self._files = {}
        self._file_hashes = file_hashes
        # No `objects` set — push's negotiate step queries the server for
        # which new objects are actually missing, so we don't need to
        # know what's already on the server up-front.
        self._object_hashes = set()

        return dict(file_hashes)

    @staticmethod
    def _parallel_tree_walk(
        store, root_hash: str, max_workers: int = 16,
    ) -> dict[str, str]:
        """Parallel BFS variant of ``mut.core.tree.tree_to_flat``.

        For each level of the tree, all ``read_tree`` (which is one S3
        GET per tree node, ignoring the LRU cache hits) calls run
        concurrently via a thread pool. Returns the same shape
        ``{rel_path: blob_hash}`` as ``tree_to_flat``.

        S3 latency to Supabase from non-US regions is ~150-300ms per
        call. With this many serial GETs, even a tree of ~100 nodes can
        push first-call clone past 30s. Parallelising at the level
        boundary collapses the wall-clock cost to ``levels × latency``,
        which is typically << 10 levels deep.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        from mut.core.tree import read_tree

        result: dict[str, str] = {}
        if not root_hash:
            return result

        pending: list[tuple[str, str]] = [(root_hash, "")]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            while pending:
                futures = {
                    executor.submit(read_tree, store, tree_hash): (tree_hash, prefix)
                    for tree_hash, prefix in pending
                }
                pending = []
                for fut in as_completed(futures):
                    _, prefix = futures[fut]
                    MutEphemeralClient._absorb_tree_entries(
                        fut.result(), prefix, result, pending,
                    )
        return result

    @staticmethod
    def _absorb_tree_entries(
        entries: dict,
        prefix: str,
        leaf_result: dict[str, str],
        sub_trees: list[tuple[str, str]],
    ) -> None:
        """Process one tree node's entries: blobs into ``leaf_result``,
        sub-trees into ``sub_trees`` for the next BFS level.

        Extracted from ``_parallel_tree_walk`` only to keep its cognitive
        complexity below the 15-branch lint threshold; the logic is
        otherwise unchanged.
        """
        for name, (typ, h) in entries.items():
            path = f"{prefix}{name}" if not prefix else f"{prefix}/{name}"
            if typ == "T":
                sub_trees.append((h, path))
            else:
                leaf_result[path] = h

    # ── Pull ─────────────────────────────────────

    def pull(self) -> dict[str, bytes]:
        """Pull latest changes since last known commit_id.

        Returns updated files or empty dict if up-to-date.
        """
        repo = self._get_server_repo()
        body = {
            "protocol_version": PROTOCOL_VERSION,
            "since_commit_id": self._head_commit_id,
            "have_hashes": list(self._object_hashes),
        }
        result = handle_pull(repo, self._auth, body)

        if result.get("status") == "up-to-date":
            return dict(self._files)

        self._head_commit_id = result.get("head_commit_id", self._head_commit_id)

        self._files = {
            path: base64.b64decode(b64)
            for path, b64 in result.get("files", {}).items()
        }

        for h in result.get("objects", {}):
            self._object_hashes.add(h)

        return dict(self._files)

    # ── Push ─────────────────────────────────────

    def push(
        self,
        modified: dict[str, bytes] | None = None,
        deleted: list[str] | None = None,
        message: str = "",
        who: str | None = None,
    ) -> dict:
        """Push changes back to the server.

        Args:
            modified: {rel_path: new_content} for created/updated files
            deleted: [rel_path, ...] for removed files
            message: commit message
            who: override agent identity

        Returns:
            Push result dict with ``status``, ``commit_id`` (16-hex hash),
            ``merged``, and ``conflicts``.
        """
        import time as _time

        from src.utils.logger import log_info

        modified = modified or {}
        deleted = deleted or []

        scope_path = self._auth.get("_scope", {}).get("path", "") or ""
        op_tag = f"[MutClient][push scope={scope_path!r}]"

        t0 = _time.monotonic()
        snapshot_root, new_objects, merged_files = self._prepare_snapshot(
            modified, deleted,
        )
        log_info(
            f"{op_tag} prepared snapshot "
            f"root={snapshot_root[:12] or '<empty>'} "
            f"new_objects={len(new_objects)} "
            f"base_commit={self._head_commit_id[:12] or '<empty>'} "
            f"in {int((_time.monotonic() - t0) * 1000)}ms",
        )

        repo = self._get_server_repo()
        t1 = _time.monotonic()
        body = self._build_push_body(
            repo, snapshot_root, new_objects, message, who,
        )
        server_changed_since_clone = self._server_head_changed(repo, scope_path)
        log_info(
            f"{op_tag} negotiated, shipping "
            f"{len(body.get('objects', {}))} objects in "
            f"{int((_time.monotonic() - t1) * 1000)}ms",
        )

        t2 = _time.monotonic()
        result = handle_push(repo, self._auth, body)
        log_info(
            f"{op_tag} handle_push returned "
            f"status={result.get('status', '?')} "
            f"commit={(result.get('commit_id') or '')[:12] or '<empty>'} "
            f"merged={result.get('merged', False)} "
            f"in {int((_time.monotonic() - t2) * 1000)}ms",
        )

        if result.get("status") == "ok":
            self._apply_push_result(
                result, modified, deleted, merged_files,
                server_changed_since_clone=server_changed_since_clone,
            )

        return result

    def _server_head_changed(self, repo: PuppyOneServerRepo, scope_path: str) -> bool:
        """Detect a stale cached host client before applying push results.

        The generic MUT handler reports ``merged=True`` only for conflict
        merges. A push can still be rebased over newer server state without
        conflicts; in that case the server returns an OK snapshot that includes
        merged files, and a cached client must refresh rather than applying
        only its local delta to an old ``_file_hashes`` map.
        """
        try:
            server_head = repo.get_scope_head_commit_id(scope_path or "")
        except Exception:
            return False
        return bool(server_head and server_head != self._head_commit_id)

    def _prepare_snapshot(
        self,
        modified: dict[str, bytes],
        deleted: list[str],
    ) -> tuple[str, dict[str, bytes], dict[str, bytes]]:
        """Build the new snapshot root + new objects to ship.

        Returns ``(snapshot_root, new_objects, merged_files)``.
        ``merged_files`` is only populated on the legacy full-content
        path; the fast path leaves it empty (its sole legitimate caller
        is `_do_push`, which discards the client right after push
        returns).
        """
        if self._file_hashes is not None:
            # Fast path: clone_lite() gave us {path: blob_hash} for the
            # existing tree. Reuse those hashes for unchanged files and
            # only ship blob bytes for paths actually being added /
            # replaced. Saves an N×blob-download every push.
            snapshot_root, new_objects = self._build_snapshot_lite(
                self._file_hashes, modified, deleted,
            )
            return snapshot_root, new_objects, {}

        merged_files = dict(self._files)
        for path, content in modified.items():
            merged_files[path] = content
        for path in deleted:
            merged_files.pop(path, None)
        snapshot_root, new_objects = self._build_snapshot(merged_files)
        return snapshot_root, new_objects, merged_files

    def _build_push_body(
        self,
        repo: PuppyOneServerRepo,
        snapshot_root: str,
        new_objects: dict[str, bytes],
        message: str,
        who: str | None,
    ) -> dict:
        """Negotiate which new objects the server is missing, then build
        the push request body."""
        if new_objects:
            neg_result = handle_negotiate(repo, self._auth, {
                "protocol_version": PROTOCOL_VERSION,
                "hashes": list(new_objects.keys()),
            })
            missing = set(neg_result.get("missing", []))
        else:
            missing = set()

        objects_b64 = {
            h: base64.b64encode(data).decode()
            for h, data in new_objects.items()
            if h in missing
        }
        return {
            "protocol_version": PROTOCOL_VERSION,
            "base_commit_id": self._head_commit_id,
            "snapshots": [{
                "id": 1,
                "root": snapshot_root,
                "message": message or "ephemeral push",
                "who": who or self._auth.get("agent", "unknown"),
                "time": _now_iso(),
            }],
            "objects": objects_b64,
        }

    def _apply_push_result(
        self,
        result: dict,
        modified: dict[str, bytes],
        deleted: list[str],
        merged_files: dict[str, bytes],
        *,
        server_changed_since_clone: bool = False,
    ) -> None:
        """Update cached client state after a successful push.

        Three cases:
          1. server merged with a concurrent commit → refresh from new
              head (lite walk if we're on the hash-only path; pull() for
              the legacy full-content path so existing-content readers
              see merged data).
          2. fast path, no merge → apply the same edits to ``_file_hashes``
             so the cached host client stays consistent for the next push.
          3. legacy path, no merge → swap in the locally-merged file dict.
        """
        new_cid = result.get("commit_id", "")
        if new_cid:
            self._head_commit_id = new_cid

        if (
            result.get("merged")
            or result.get("merged_changes")
            or server_changed_since_clone
        ):
            if self._file_hashes is not None:
                self.clone_lite()
            else:
                self.pull()
            return

        if self._file_hashes is not None:
            for path, content in modified.items():
                self._file_hashes[path] = _content_hash(content)
            for path in deleted:
                self._file_hashes.pop(path, None)
            return

        self._files = merged_files

    # ── Read helpers ──────────────────────────────

    def read_file(self, path: str) -> bytes | None:
        """Read a single file from the cloned state."""
        return self._files.get(path)

    def list_files(self) -> list[str]:
        """List all file paths in the scope."""
        return sorted(self._files.keys())

    def stat(self, path: str) -> dict | None:
        """Get basic info about a file."""
        if path not in self._files:
            return None
        content = self._files[path]
        return {
            "path": path,
            "size": len(content),
            "hash": _content_hash(content),
        }

    # ── Snapshot building ────────────────────────

    def _build_snapshot(
        self, files: dict[str, bytes]
    ) -> tuple[str, dict[str, bytes]]:
        """Build a Merkle tree snapshot from file dict.

        Returns (root_hash, {hash: raw_bytes} for new objects).
        """
        new_objects: dict[str, bytes] = {}

        nested: dict = {}
        for path, content in files.items():
            blob_hash = _content_hash(content)
            new_objects[blob_hash] = content

            parts = path.split("/")
            d = nested
            for p in parts[:-1]:
                d = d.setdefault(p, {})
            d[parts[-1]] = ("B", blob_hash)

        root_hash = self._build_tree_node(nested, new_objects)
        return root_hash, new_objects

    def _build_snapshot_lite(
        self,
        existing_hashes: dict[str, str],
        modified: dict[str, bytes],
        deleted: list[str],
    ) -> tuple[str, dict[str, bytes]]:
        """Build a Merkle tree snapshot from a hash-only base + a small
        modifications set.

        Counterpart to ``_build_snapshot`` for the ``clone_lite`` →
        ``push`` fast path. Reuses ``existing_hashes`` for unchanged
        files (no re-hashing, no blob bytes carried) and only loads new
        blob bytes into ``new_objects`` for entries actually being
        added or replaced. Tree-node bytes are produced on the fly the
        same way as ``_build_snapshot``.

        Returns ``(root_hash, {hash: raw_bytes})`` where ``raw_bytes``
        contains the new tree nodes plus the modified blobs only.
        """
        # Apply modifications + deletions to the existing path→hash map.
        merged_hashes: dict[str, str] = dict(existing_hashes)
        new_objects: dict[str, bytes] = {}
        for path, content in modified.items():
            blob_hash = _content_hash(content)
            new_objects[blob_hash] = content
            merged_hashes[path] = blob_hash
        for path in deleted:
            merged_hashes.pop(path, None)

        # Nest into a tree dict keyed on path components, leaves are
        # ("B", blob_hash) tuples — same shape as _build_snapshot uses.
        nested: dict = {}
        for path, blob_hash in merged_hashes.items():
            parts = path.split("/")
            d = nested
            for p in parts[:-1]:
                d = d.setdefault(p, {})
            d[parts[-1]] = ("B", blob_hash)

        root_hash = self._build_tree_node(nested, new_objects)
        return root_hash, new_objects

    def _build_tree_node(
        self, node: dict, new_objects: dict[str, bytes]
    ) -> str:
        entries: dict = {}
        for name, val in sorted(node.items()):
            if isinstance(val, tuple):
                entries[name] = list(val)
            else:
                sub_hash = self._build_tree_node(val, new_objects)
                entries[name] = ["T", sub_hash]

        tree_bytes = json.dumps(entries, sort_keys=True).encode()
        tree_hash = _content_hash(tree_bytes)
        new_objects[tree_hash] = tree_bytes
        return tree_hash


def _content_hash(data: bytes) -> str:
    """Truncated SHA-256 hash matching MUT ObjectStore."""
    return mut_hash(data)


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now(UTC).isoformat(timespec="seconds")

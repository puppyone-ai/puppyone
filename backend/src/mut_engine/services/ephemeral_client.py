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

    # ── Clone ────────────────────────────────────

    def clone(self) -> dict[str, bytes]:
        """Clone the scope subtree. Returns {rel_path: content}."""
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

        return dict(self._files)

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
        modified = modified or {}
        deleted = deleted or []

        merged_files = dict(self._files)
        for path, content in modified.items():
            merged_files[path] = content
        for path in deleted:
            merged_files.pop(path, None)

        snapshot_root, new_objects = self._build_snapshot(merged_files)

        repo = self._get_server_repo()

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

        body = {
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

        result = handle_push(repo, self._auth, body)

        if result.get("status") == "ok":
            new_cid = result.get("commit_id", "")
            if new_cid:
                self._head_commit_id = new_cid
            if result.get("merged"):
                self.pull()
            else:
                self._files = merged_files

        return result

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

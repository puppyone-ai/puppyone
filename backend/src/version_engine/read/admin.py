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
import heapq
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone

from src.utils.logger import log_error
from src.version_engine.domain.errors import ObjectNotFoundError, VersionEngineError
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.diff import diff_trees
from src.version_engine.write_engine.git_commit import is_git_object_id
from src.version_engine.write_engine.git_object_format import decode_commit, split_author_line
from src.version_engine.write_engine.tree import read_tree


_SCOPE_PROMOTE_TRAILER = "PuppyOne-Source: scope-promote"
_HISTORY_VISIBLE_FETCH_MULTIPLIER = 20
_HISTORY_VISIBLE_FETCH_FLOOR = 1000
_HISTORY_GRAPH_CACHE_MAX = 32
_history_graph_cache: OrderedDict[
    tuple[int, str, tuple[str, ...]],
    tuple[tuple[str, ...], dict[str, "_GraphCommit"]],
] = OrderedDict()
_history_graph_cache_lock = threading.Lock()


@dataclass(frozen=True)
class TopologicalHistoryPage:
    """One stable child-before-parent page from the project's Git DAG."""

    entries: list[dict]
    total: int
    next_cursor: str | None
    has_more: bool


@dataclass(frozen=True)
class _GraphCommit:
    commit_id: str
    parent_ids: tuple[str, ...]
    tree_id: str
    author: str
    message: str
    created_at: str | None
    timestamp: int


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

        Contract: linear ASC order (oldest first). Without an anchor, a
        positive limit returns the newest commits for history UIs. With
        ``since_commit_id``, it returns the first page immediately after the
        anchor so reconnect/catch-up callers cannot skip an oversized gap.

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

        if limit > 0 and not since_commit_id:
            # entries is ASC (oldest first) — keep the *tail* so callers
            # asking for "latest 50" see the most recent visible changes,
            # not technical projections or the oldest rows.
            entries = entries[-limit:]

        return entries

    async def get_topological_commit_history(
        self,
        project_id: str,
        ref_commit_ids: list[str],
        *,
        limit: int = 50,
        cursor: str = "",
    ) -> TopologicalHistoryPage:
        """Return a deterministic all-ref Git history page.

        The graph is derived from immutable commit objects reachable from the
        supplied refs.  The resulting order is child-before-parent and stable
        for a fixed ref snapshot.  Named-ref-only commits are intentionally
        included even when they have no transaction-history row.
        """

        repo = self._repos.get_repo(project_id)
        return await asyncio.to_thread(
            _build_topological_history_page,
            repo,
            project_id,
            ref_commit_ids,
            limit,
            cursor,
        )

    async def get_commit_parent_ids(
        self,
        project_id: str,
        commit_ids: list[str],
    ) -> dict[str, list[str]]:
        """Read parent ids for legacy linear-history rows in one worker hop."""

        repo = self._repos.get_repo(project_id)
        return await asyncio.to_thread(_read_parent_ids, repo, commit_ids)

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

        # Tolerant mode: an unreadable tree object (missing/corrupt) is logged
        # and treated as empty so the endpoint returns a best-effort diff
        # instead of an unhandled 500. ObjectNotFoundError carries http_status
        # 404; the HTTP layer maps VersionEngineError to it.
        try:
            return await asyncio.to_thread(
                diff_trees, repo.store, root1, root2, tolerant=True
            )
        except VersionEngineError:
            raise
        except Exception as exc:  # noqa: BLE001 — never leak a raw 500 from diff
            log_error(
                f"[compute_diff] {project_id} {from_commit_id}..{to_commit_id} failed: {exc}"
            )
            raise ObjectNotFoundError(
                f"diff unavailable for {from_commit_id}..{to_commit_id}: {exc}"
            ) from exc


def _build_topological_history_page(
    repo,
    project_id: str,
    ref_commit_ids: list[str],
    limit: int,
    cursor: str,
) -> TopologicalHistoryPage:
    roots = tuple(dict.fromkeys(
        commit_id for commit_id in ref_commit_ids if is_git_object_id(commit_id)
    ))
    if not roots:
        return TopologicalHistoryPage(entries=[], total=0, next_cursor=None, has_more=False)

    order, nodes = _get_history_graph(repo, project_id, roots)
    start = 0
    if cursor:
        try:
            start = order.index(cursor) + 1
        except ValueError as exc:
            raise ValueError("history cursor is not part of the current ref snapshot") from exc

    page_ids = list(order[start:start + max(1, limit)])
    end = start + len(page_ids)
    has_more = end < len(order)
    metadata = _load_history_metadata(repo.history, page_ids)
    entries = [
        _graph_commit_to_history_entry(nodes[commit_id], metadata.get(commit_id))
        for commit_id in page_ids
    ]
    return TopologicalHistoryPage(
        entries=entries,
        total=len(order),
        next_cursor=page_ids[-1] if has_more and page_ids else None,
        has_more=has_more,
    )


def _get_history_graph(
    repo,
    project_id: str,
    roots: tuple[str, ...],
) -> tuple[tuple[str, ...], dict[str, _GraphCommit]]:
    cache_key = (id(repo.store), project_id, roots)
    with _history_graph_cache_lock:
        cached = _history_graph_cache.get(cache_key)
        if cached is not None:
            _history_graph_cache.move_to_end(cache_key)
            return cached

    nodes, root_ranks = _read_reachable_graph(repo, roots)
    order = tuple(_topological_commit_order(nodes, root_ranks))
    cached = (order, nodes)
    with _history_graph_cache_lock:
        _history_graph_cache[cache_key] = cached
        _history_graph_cache.move_to_end(cache_key)
        while len(_history_graph_cache) > _HISTORY_GRAPH_CACHE_MAX:
            _history_graph_cache.popitem(last=False)
    return cached


def _read_reachable_graph(
    repo,
    roots: tuple[str, ...],
) -> tuple[dict[str, _GraphCommit], dict[str, int]]:
    nodes: dict[str, _GraphCommit] = {}
    root_ranks: dict[str, int] = {}
    stack = [(commit_id, rank) for rank, commit_id in reversed(list(enumerate(roots)))]

    while stack:
        commit_id, rank = stack.pop()
        previous_rank = root_ranks.get(commit_id)
        if previous_rank is not None and previous_rank <= rank:
            continue
        root_ranks[commit_id] = rank

        node = nodes.get(commit_id)
        if node is None:
            node = _read_graph_commit(repo, commit_id)
            if node is None:
                continue
            nodes[commit_id] = node
        for parent_id in reversed(node.parent_ids):
            stack.append((parent_id, rank))

    return nodes, root_ranks


def _read_graph_commit(repo, commit_id: str) -> _GraphCommit | None:
    if not is_git_object_id(commit_id):
        return None
    try:
        obj_type, content = repo.store.get_object(commit_id)
        if obj_type != "commit":
            return None
        info = decode_commit(content)
    except Exception as exc:  # noqa: BLE001 - one damaged ref must not hide healthy history
        log_error(f"[history-graph] cannot read commit {commit_id}: {exc}")
        return None

    parent_ids = tuple(dict.fromkeys(
        parent_id
        for parent_id in (info.get("parents") or [])
        if is_git_object_id(parent_id)
    ))
    timestamp, created_at = _git_identity_time(info.get("committer") or info.get("author") or "")
    author_identity, _author_time = split_author_line(info.get("author") or "")
    author = author_identity.rsplit("<", 1)[0].strip() or author_identity.strip() or "Git"
    message = (info.get("message") or "").splitlines()[0].strip() or "Update workspace"
    return _GraphCommit(
        commit_id=commit_id,
        parent_ids=parent_ids,
        tree_id=info.get("tree", "") if is_git_object_id(info.get("tree", "")) else "",
        author=author,
        message=message,
        created_at=created_at,
        timestamp=timestamp,
    )


def _git_identity_time(identity_line: str) -> tuple[int, str | None]:
    _identity, raw_time = split_author_line(identity_line)
    try:
        timestamp = int(raw_time.split(" ", 1)[0])
    except (TypeError, ValueError):
        return 0, None
    try:
        created_at = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
    except (OSError, OverflowError, ValueError):
        return timestamp, None
    return timestamp, created_at


def _topological_commit_order(
    nodes: dict[str, _GraphCommit],
    root_ranks: dict[str, int],
) -> list[str]:
    pending_children = dict.fromkeys(nodes, 0)
    for node in nodes.values():
        for parent_id in node.parent_ids:
            if parent_id in pending_children:
                pending_children[parent_id] += 1

    ready: list[tuple[int, int, str]] = []
    for commit_id, child_count in pending_children.items():
        if child_count == 0:
            node = nodes[commit_id]
            heapq.heappush(
                ready,
                (root_ranks.get(commit_id, len(root_ranks)), -node.timestamp, commit_id),
            )

    order: list[str] = []
    while ready:
        _rank, _timestamp, commit_id = heapq.heappop(ready)
        order.append(commit_id)
        for parent_id in nodes[commit_id].parent_ids:
            if parent_id not in pending_children:
                continue
            pending_children[parent_id] -= 1
            if pending_children[parent_id] == 0:
                parent = nodes[parent_id]
                heapq.heappush(
                    ready,
                    (
                        root_ranks.get(parent_id, len(root_ranks)),
                        -parent.timestamp,
                        parent_id,
                    ),
                )

    if len(order) != len(nodes):
        # A cycle cannot be produced by valid content-addressed Git commits,
        # but deterministic recovery keeps a damaged repository inspectable.
        remaining = sorted(set(nodes) - set(order), key=lambda commit_id: (
            root_ranks.get(commit_id, len(root_ranks)),
            -nodes[commit_id].timestamp,
            commit_id,
        ))
        order.extend(remaining)
    return order


def _load_history_metadata(history, commit_ids: list[str]) -> dict[str, dict]:
    try:
        batch_getter = getattr(history, "get_entries", None)
        if callable(batch_getter):
            rows = batch_getter(commit_ids)
        else:
            rows = [history.get_entry(commit_id) for commit_id in commit_ids]
    except Exception as exc:  # noqa: BLE001 - Git objects remain a valid read fallback
        log_error(f"[history-graph] history metadata lookup failed: {exc}")
        rows = []
    return {
        row.get("commit_id", ""): row
        for row in rows
        if row and row.get("commit_id")
    }


def _graph_commit_to_history_entry(node: _GraphCommit, metadata: dict | None) -> dict:
    metadata = metadata or {}
    return {
        "commit_id": node.commit_id,
        "parent_ids": list(node.parent_ids),
        "who": metadata.get("who") or node.author,
        "message": metadata.get("message") or node.message,
        "changes": metadata.get("changes") or [],
        "conflicts": metadata.get("conflicts") or [],
        "root_hash": metadata.get("root_hash") or node.tree_id,
        "scope_hash": metadata.get("scope_hash") or node.tree_id,
        "scope_path": metadata.get("scope_path") or "",
        "created_at": metadata.get("created_at") or node.created_at,
        "audit_detail": metadata.get("audit_detail"),
    }


def _read_parent_ids(repo, commit_ids: list[str]) -> dict[str, list[str]]:
    parents_by_commit: dict[str, list[str]] = {}
    for commit_id in dict.fromkeys(commit_ids):
        node = _read_graph_commit(repo, commit_id)
        parents_by_commit[commit_id] = list(node.parent_ids) if node else []
    return parents_by_commit


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

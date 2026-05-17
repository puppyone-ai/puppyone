"""Git commit object helpers used by the transaction engine."""

from __future__ import annotations

import re
import threading
from collections import OrderedDict
from datetime import datetime, timezone

from src.mut_engine.application.git_object_format import decode_commit, encode_commit

HEX_40 = re.compile(r"^[0-9a-f]{40}$")
_COMPAT_CACHE_MAX = 4096
_compat_cache: OrderedDict[tuple[str, str], str] = OrderedDict()
_compat_cache_lock = threading.Lock()


class GitCommitInvariantError(ValueError):
    """Raised when a Git-visible commit would violate native Git invariants."""


def format_git_time(created_at_iso: str) -> tuple[str, str]:
    """Convert ISO 8601 to Git's ``("<unix_seconds>", "<+HHMM>")`` pair."""

    try:
        dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ts = int(dt.timestamp())
    offset = dt.utcoffset()
    if offset is None:
        return str(ts), "+0000"
    secs = int(offset.total_seconds())
    sign = "+" if secs >= 0 else "-"
    secs = abs(secs)
    return str(ts), f"{sign}{secs // 3600:02d}{(secs % 3600) // 60:02d}"


def identity_for_git(who: str, *, domain: str = "puppyone") -> str:
    """Wrap a bare actor id in Git's ``Name <email>`` identity shape."""

    identity = (who or "anonymous").strip()
    if "<" in identity:
        return identity
    slug = identity.replace(" ", "-").lower() or "anonymous"
    return f"{identity} <{slug}@{domain}>"


def build_git_commit(
    repo,
    *,
    tree_sha: str,
    parent_sha: str,
    who: str,
    message: str,
    created_at_iso: str,
    trailers: dict | None = None,
    validate_parent_graph: bool = True,
) -> str:
    """Store a real Git commit object and return its SHA-1 object id.

    ``trailers`` lets callers (typically the transaction engine when it
    synthesizes a server-side commit) append immutable provenance lines
    to the commit message, e.g.::

        PuppyOne-Transaction: <id>
        PuppyOne-Source: git | mut | papi | web | agent | sync
        PuppyOne-Scope: <scope_path>
        PuppyOne-Original-Commit: <client_commit_id>

    Only stable, audit-safe facts belong here — mutable request metadata
    such as IP, user agent, or auth token stays in audit rows.
    """

    assert_git_tree(repo, tree_sha)
    if parent_sha and validate_parent_graph:
        assert_git_compatible_commit(repo, parent_sha)

    ts, tz = format_git_time(created_at_iso)
    identity = identity_for_git(who)
    final_message = compose_commit_message(message, trailers)
    commit_body = encode_commit(
        tree_sha1=tree_sha,
        parent_sha1=parent_sha or None,
        author=identity,
        author_time=f"{ts} {tz}",
        committer=identity,
        committer_time=f"{ts} {tz}",
        message=final_message,
    )
    commit_id = repo.store.put_commit(commit_body)
    _remember_git_compatibility(repo, commit_id, "")
    return commit_id


def compose_commit_message(message: str, trailers: dict | None) -> str:
    """Append a Git-style trailer block to ``message``.

    Trailers are written in a single block separated from the message
    body by exactly one blank line. Empty / falsy trailer values are
    skipped so the commit message stays clean.
    """

    body = (message or "(no message)").rstrip("\n")
    if not trailers:
        return body
    safe_trailers = [
        f"{key}: {value}"
        for key, value in trailers.items()
        if value not in (None, "")
    ]
    if not safe_trailers:
        return body
    # Avoid double-trailer when callers passed a message that already
    # contains the same trailer line.
    extra = [line for line in safe_trailers if line not in body]
    if not extra:
        return body
    return body + "\n\n" + "\n".join(extra)


def is_git_object_id(value: str) -> bool:
    return bool(HEX_40.match(value or ""))


def assert_git_tree(repo, tree_id: str) -> None:
    if not is_git_object_id(tree_id):
        raise GitCommitInvariantError(f"tree id is not a Git object id: {tree_id!r}")
    try:
        obj_type, _content = repo.store.get_object(tree_id)
    except Exception as exc:
        raise GitCommitInvariantError(f"tree object does not exist: {tree_id}") from exc
    if obj_type != "tree":
        raise GitCommitInvariantError(
            f"object {tree_id} is a {obj_type}, expected tree",
        )


def assert_git_compatible_commit(repo, commit_id: str) -> None:
    error = git_compatibility_error(repo, commit_id)
    if error:
        raise GitCommitInvariantError(error)


def is_git_compatible_commit(repo, commit_id: str) -> bool:
    return git_compatibility_error(repo, commit_id) == ""


def git_compatibility_error(repo, commit_id: str) -> str:
    """Return an error message if ``commit_id`` is not a native-Git-safe head."""

    if not commit_id:
        return ""
    cached = _cached_git_compatibility(repo, commit_id)
    if cached is not None:
        return cached
    error = _compute_git_compatibility_error(repo, commit_id)
    _remember_git_compatibility(repo, commit_id, error)
    return error


def _compute_git_compatibility_error(repo, commit_id: str) -> str:
    if not is_git_object_id(commit_id):
        return f"commit id is not a Git object id: {commit_id!r}"

    seen: set[str] = set()
    stack = [commit_id]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        if not is_git_object_id(current):
            return f"commit parent is not a Git object id: {current!r}"
        try:
            obj_type, content = repo.store.get_object(current)
        except Exception:
            return f"commit object does not exist: {current}"
        if obj_type != "commit":
            return f"object {current} is a {obj_type}, expected commit"
        try:
            info = decode_commit(content)
        except Exception as exc:
            return f"commit {current} cannot be decoded: {exc}"
        tree_id = info.get("tree", "")
        if not is_git_object_id(tree_id):
            return f"commit {current} has invalid tree id: {tree_id!r}"
        try:
            tree_type, _tree = repo.store.get_object(tree_id)
        except Exception:
            return f"commit {current} references missing tree {tree_id}"
        if tree_type != "tree":
            return f"commit {current} references {tree_type} {tree_id}, expected tree"
        for parent in info.get("parents") or []:
            if not is_git_object_id(parent):
                return f"commit {current} has invalid parent id: {parent!r}"
            stack.append(parent)
    return ""


def _repo_cache_key(repo, commit_id: str) -> tuple[str, str]:
    project_id = getattr(repo, "_project_id", None)
    if not project_id:
        project_id = str(id(getattr(repo, "store", repo)))
    return str(project_id), commit_id


def _cached_git_compatibility(repo, commit_id: str) -> str | None:
    key = _repo_cache_key(repo, commit_id)
    with _compat_cache_lock:
        cached = _compat_cache.get(key)
        if cached is None:
            return None
        _compat_cache.move_to_end(key)
        return cached


def _remember_git_compatibility(repo, commit_id: str, error: str) -> None:
    key = _repo_cache_key(repo, commit_id)
    with _compat_cache_lock:
        _compat_cache[key] = error
        _compat_cache.move_to_end(key)
        while len(_compat_cache) > _COMPAT_CACHE_MAX:
            _compat_cache.popitem(last=False)


def commit_tree_id(repo, commit_id: str) -> str:
    """Return the tree id referenced by a stored Git commit object."""

    obj_type, content = repo.store.get_object(commit_id)
    if obj_type != "commit":
        raise ValueError(f"object {commit_id} is a {obj_type}, expected commit")
    info = decode_commit(content)
    tree_id = info.get("tree", "")
    if not tree_id:
        raise ValueError(f"commit {commit_id} has no tree")
    return tree_id

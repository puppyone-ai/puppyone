"""Git-compatible commit projections for project and scope views."""

from __future__ import annotations

import re

from src.mut_engine.infrastructure.git_format import decode_commit
from src.mut_engine.infrastructure.paths import normalize_path

from src.mut_engine.application.git_commit import build_git_commit, commit_tree_id
from src.mut_engine.application.tree_objects import (
    build_tree_from_files,
    flatten_tree_to_bytes,
    is_path_excluded,
)

EMPTY_TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
HEX_40 = re.compile(r"^[0-9a-f]{40}$")


def git_view_head_commit(
    repo,
    scope_path: str,
    scope_excludes: list[str] | None = None,
) -> str:
    scope_norm = normalize_path(scope_path)
    excludes = [normalize_path(item) for item in (scope_excludes or [])]
    if scope_norm:
        head = repo.get_scope_head_commit_id(scope_norm) or ""
        if not head or not excludes:
            return git_compatible_head_commit(repo, head)
        filtered_tree = filtered_commit_tree(repo, head, scope_norm, excludes)
        if not filtered_tree:
            return git_compatible_head_commit(repo, head)
        try:
            if commit_tree_id(repo, head) == filtered_tree:
                return git_compatible_head_commit(repo, head)
        except Exception:
            pass
        return build_git_commit(
            repo,
            tree_sha=filtered_tree,
            parent_sha="",
            who="puppyone-scope-view",
            message="Puppyone scope view",
            created_at_iso="1970-01-01T00:00:00+00:00",
        )

    if not excludes and hasattr(repo, "get_latest_project_view_commit_id"):
        indexed = repo.get_latest_project_view_commit_id() or ""
        if indexed and repo.store.exists(indexed):
            return git_compatible_head_commit(repo, indexed)

    root_hash = ""
    try:
        root_hash = repo.get_root_hash() or ""
    except Exception:
        root_hash = ""
    if root_hash and excludes:
        files = flatten_tree_to_bytes(repo.store, root_hash)
        filtered = {
            path: content
            for path, content in files.items()
            if not is_path_excluded(path, excludes)
        }
        root_hash = build_tree_from_files(repo.store, filtered)

    root_scope_head = repo.get_scope_head_commit_id("") or ""
    project_head = repo.get_head_commit_id() if hasattr(repo, "get_head_commit_id") else ""
    candidate = root_scope_head or project_head
    if root_hash:
        if not candidate and root_hash == EMPTY_TREE_ID:
            return ""
        if candidate:
            try:
                if commit_tree_id(repo, candidate) == root_hash:
                    return git_compatible_head_commit(repo, candidate)
            except Exception:
                pass
        parent = ""
        if not excludes:
            parent = git_compatible_head_commit(repo, project_head or root_scope_head)
        return build_git_commit(
            repo,
            tree_sha=root_hash,
            parent_sha=parent,
            who="puppyone-project-view",
            message="Puppyone project view",
            created_at_iso="1970-01-01T00:00:00+00:00",
        )

    return git_compatible_head_commit(repo, candidate) if candidate else ""


def git_compatible_head_commit(repo, commit_id: str) -> str:
    """Return a Git-parseable projection of a stored commit ancestry.

    Some legacy/imported Puppyone histories contain commit parent values that
    are not valid Git object ids. Native Git refuses to clone such commits even
    if the current tree is readable. For Git transports, rewrite only the
    incompatible ancestry into deterministic projection commits while preserving
    tree content and commit metadata.
    """

    return _git_compatible_commit(repo, commit_id, {})


def _git_compatible_commit(repo, commit_id: str, memo: dict[str, str]) -> str:
    if not _is_git_object_id(commit_id):
        return ""
    cached = memo.get(commit_id)
    if cached is not None:
        return cached

    try:
        obj_type, body = repo.store.get_object(commit_id)
    except Exception:
        memo[commit_id] = ""
        return ""
    if obj_type != "commit":
        memo[commit_id] = ""
        return ""

    try:
        info = decode_commit(body)
    except Exception:
        memo[commit_id] = ""
        return ""

    tree_id = info.get("tree", "")
    if not _is_valid_tree(repo, tree_id):
        memo[commit_id] = ""
        return ""

    projected_parents: list[str] = []
    changed = False
    for parent in info.get("parents") or []:
        if not _is_git_object_id(parent):
            changed = True
            continue
        projected_parent = _git_compatible_commit(repo, parent, memo)
        if not projected_parent:
            changed = True
            continue
        projected_parents.append(projected_parent)
        if projected_parent != parent:
            changed = True

    if not changed:
        memo[commit_id] = commit_id
        return commit_id

    projected = repo.store.put_commit(_replace_commit_parents(body, projected_parents))
    memo[commit_id] = projected
    return projected


def _is_git_object_id(value: str) -> bool:
    return bool(HEX_40.match(value or ""))


def _is_valid_tree(repo, tree_id: str) -> bool:
    if not _is_git_object_id(tree_id):
        return False
    try:
        obj_type, _body = repo.store.get_object(tree_id)
    except Exception:
        return False
    return obj_type == "tree"


def _replace_commit_parents(body: bytes, parents: list[str]) -> bytes:
    head, sep, message = body.partition(b"\n\n")
    lines = head.split(b"\n")
    rewritten: list[bytes] = []
    inserted = False
    for line in lines:
        if line.startswith(b"parent "):
            continue
        rewritten.append(line)
        if not inserted and line.startswith(b"tree "):
            rewritten.extend(f"parent {parent}".encode("ascii") for parent in parents)
            inserted = True
    if not sep:
        message = b""
    return b"\n".join(rewritten) + b"\n\n" + message


def filtered_commit_tree(
    repo,
    commit_id: str,
    scope_path: str,
    excludes: list[str],
) -> str:
    tree_id = commit_tree_id(repo, commit_id)
    files = flatten_tree_to_bytes(repo.store, tree_id)
    filtered = {
        rel_path: content
        for rel_path, content in files.items()
        if not is_path_excluded(
            f"{scope_path}/{rel_path}" if scope_path else rel_path,
            excludes,
        )
    }
    return build_tree_from_files(repo.store, filtered)

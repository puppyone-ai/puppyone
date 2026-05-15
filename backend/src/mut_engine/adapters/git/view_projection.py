"""Git-compatible commit projections for project and scope views."""

from __future__ import annotations

from mut.core.protocol import normalize_path

from src.mut_engine.application.git_commit import build_git_commit, commit_tree_id
from src.mut_engine.application.tree_objects import (
    build_tree_from_files,
    flatten_tree_to_bytes,
    is_path_excluded,
)

EMPTY_TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


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
            return head
        filtered_tree = filtered_commit_tree(repo, head, scope_norm, excludes)
        if not filtered_tree:
            return head
        try:
            if commit_tree_id(repo, head) == filtered_tree:
                return head
        except Exception:
            pass
        return build_git_commit(
            repo,
            tree_sha=filtered_tree,
            parent_sha="",
            who="puppyone-scope-view",
            message="PuppyOne scope view",
            created_at_iso="1970-01-01T00:00:00+00:00",
        )

    if not excludes and hasattr(repo, "get_latest_project_view_commit_id"):
        indexed = repo.get_latest_project_view_commit_id() or ""
        if indexed and repo.store.exists(indexed):
            return indexed

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
                    return candidate
            except Exception:
                pass
        return build_git_commit(
            repo,
            tree_sha=root_hash,
            parent_sha="" if excludes else (project_head or root_scope_head),
            who="puppyone-project-view",
            message="PuppyOne project view",
            created_at_iso="1970-01-01T00:00:00+00:00",
        )

    return candidate or ""


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

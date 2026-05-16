"""Child-promotes-parent projection (07-version-engine-supplement.md §7.B).

When a child scope advances, its content is overlaid onto each ancestor
scope's tree, a synthetic ``scope-promote`` commit is built, and the
ancestor scope's head is bumped via the usual atomic publish RPC. The
operation is bounded to the child's subtree — it never locks unrelated
parent paths and never serializes sibling-scope writes.

Author attribution carries the original child commit's actor in the
``who`` field and stamps ``PuppyOne-Source: scope-promote`` into the
parent commit message so the projection commit is auditable.

This module deliberately stays small: it reuses the engine's existing
graft, build, and publish primitives rather than re-implementing them.
"""

from __future__ import annotations

import asyncio
from typing import Any

from src.mut_engine.application.git_commit import build_git_commit
from src.mut_engine.application.root_projection import graft_subtree
from src.mut_engine.application.tree_objects import flatten_tree_to_bytes
from src.mut_engine.application.path_utils import normalize_path
from src.utils.logger import log_info, log_warning


_PROMOTE_TRAILER_SOURCE = "scope-promote"


def ancestor_scope_paths(repo, scope_path: str) -> list[str]:
    """Return ancestor scope paths (nearest first), including the root scope.

    Falls back to a structural walk if the repo cannot enumerate scopes;
    that keeps tests with partial fakes working.
    """

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return []
    declared: set[str] = set()
    try:
        all_scopes = repo.get_all_scope_hashes()
        declared = {normalize_path(p) for p in all_scopes.keys()}
    except Exception:
        declared = set()
    ancestors: list[str] = []
    parts = scope_norm.split("/")
    for i in range(len(parts) - 1, 0, -1):
        ancestor = "/".join(parts[:i])
        if not declared or ancestor in declared:
            ancestors.append(ancestor)
    if not declared or "" in declared:
        ancestors.append("")
    return ancestors


def promote_to_parents(
    repo,
    *,
    project_id: str,
    child_scope_path: str,
    child_new_tree_hash: str,
    child_commit_actor: str,
    child_commit_id: str,
    created_at_iso: str,
) -> list[dict[str, Any]]:
    """Synthesize a scope-promote commit on each ancestor scope.

    Returns a list of ``{scope_path, new_commit_id, new_scope_hash}`` rows
    describing the parent scopes that advanced. Best-effort: a failure on
    one ancestor logs but does not break the others.
    """

    promotions: list[dict[str, Any]] = []
    child_norm = normalize_path(child_scope_path)
    if not child_norm or not child_new_tree_hash:
        return promotions

    for ancestor in ancestor_scope_paths(repo, child_norm):
        try:
            old_hash, current_head = _scope_head(repo, ancestor)
            # Splice child tree into parent tree at the relative offset.
            relative = (
                child_norm[len(ancestor):].lstrip("/")
                if ancestor
                else child_norm
            )
            if not relative:
                continue
            new_tree = graft_subtree(
                repo.store, old_hash, relative, child_new_tree_hash,
            ) if old_hash else _build_parent_skeleton(
                repo, relative, child_new_tree_hash,
            )
            if new_tree == old_hash:
                continue

            promote_message = (
                f"scope-promote {child_norm} -> {ancestor or '/'}\n\n"
                f"PuppyOne-Source: {_PROMOTE_TRAILER_SOURCE}\n"
                f"PuppyOne-Child-Commit: {child_commit_id}\n"
                f"PuppyOne-Child-Scope: {child_norm}\n"
            )
            new_commit = build_git_commit(
                repo,
                tree_sha=new_tree,
                parent_sha=current_head or "",
                who=child_commit_actor or "scope-promote",
                message=promote_message,
                created_at_iso=created_at_iso,
            )
            publish = getattr(repo, "publish_scope_update", None)
            if publish is None:
                log_warning(
                    f"[scope-promote] repo lacks publish_scope_update; "
                    f"skipping promotion to {ancestor!r}",
                )
                continue
            result = publish(
                scope_path=ancestor,
                old_scope_hash=old_hash,
                new_scope_hash=new_tree,
                commit_id=new_commit,
                who=child_commit_actor or "scope-promote",
                message=promote_message,
                changes=[{"path": child_norm, "action": "scope-promote"}],
                conflicts=None,
                created_at_iso=created_at_iso,
                audit_event_type="scope_promote",
                audit_agent_id=child_commit_actor or "system",
                audit_detail={
                    "child_scope": child_norm,
                    "child_commit_id": child_commit_id,
                    "source": _PROMOTE_TRAILER_SOURCE,
                },
                source_channel="agent",
                policy="scope_promote",
                base_commit_id=current_head,
                client_commit_id="",
                proposed_tree_id=new_tree,
                intent_type="operation",
            )
            published = result[0] if isinstance(result, tuple) else bool(result)
            if published:
                promotions.append({
                    "scope_path": ancestor,
                    "new_commit_id": new_commit,
                    "new_scope_hash": new_tree,
                })
                log_info(
                    f"[scope-promote] {child_norm} -> {ancestor or '/'} "
                    f"new_commit={new_commit[:12]}",
                )
        except Exception as exc:
            log_warning(
                f"[scope-promote] failed for ancestor {ancestor!r}: {exc}",
            )
    return promotions


async def promote_to_parents_async(
    repo,
    *,
    project_id: str,
    child_scope_path: str,
    child_new_tree_hash: str,
    child_commit_actor: str,
    child_commit_id: str,
    created_at_iso: str,
) -> list[dict[str, Any]]:
    return await asyncio.to_thread(
        promote_to_parents,
        repo,
        project_id=project_id,
        child_scope_path=child_scope_path,
        child_new_tree_hash=child_new_tree_hash,
        child_commit_actor=child_commit_actor,
        child_commit_id=child_commit_id,
        created_at_iso=created_at_iso,
    )


def _scope_head(repo, scope_path: str) -> tuple[str, str]:
    get_state = getattr(repo, "get_scope_state", None)
    if callable(get_state):
        scope_hash, head_commit_id = get_state(scope_path)
        return scope_hash or "", head_commit_id or ""
    return (
        repo.get_scope_hash(scope_path) or "",
        repo.get_scope_head_commit_id(scope_path) or "",
    )


def _build_parent_skeleton(repo, relative: str, child_tree_hash: str) -> str:
    """Build a minimal parent tree containing only the child's subtree.

    Used when the ancestor scope has no head yet (first scope-promote
    after a fresh project). Subsequent promotions then graft into this
    skeleton normally.
    """

    from src.mut_engine.application.git_object_format import encode_tree

    empty = repo.store.put_tree(encode_tree([]))
    return graft_subtree(repo.store, empty, relative, child_tree_hash)

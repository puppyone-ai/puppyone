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

from src.version_engine.write_engine.git_commit import (
    build_git_commit,
    shallow_git_parent_or_empty,
)
from src.version_engine.derived.projection import graft_subtree
from src.version_engine.write_engine.tree_objects import flatten_tree_to_bytes
from src.version_engine.write_engine.path_utils import normalize_path
from src.utils.logger import log_info, log_warning


_PROMOTE_TRAILER_SOURCE = "scope-promote"


def ancestor_scope_paths(repo, scope_path: str) -> list[str]:
    """Return ancestor scope paths (nearest first), including the root scope.

    Scope membership comes from ``repo_scopes`` (declarations), NOT from
    runtime scope state. A scope that exists in the
    project's geometry but has never received a commit must still
    participate in ancestor walks — otherwise a child's first commit
    silently promotes past the intended parent scope into ``""``,
    leaving the parent's tree empty forever.

    Falls back to a structural walk (no filtering) if the repo cannot
    enumerate scopes — keeps tests with partial fakes working.
    """

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return []
    declared: set[str] = set()
    try:
        get_paths = getattr(repo, "get_declared_scope_paths", None)
        if callable(get_paths):
            declared = {normalize_path(p) for p in get_paths()}
        else:
            # Test-double fallback: only scopes with state rows.
            declared = {normalize_path(p) for p in repo.get_all_scope_hashes().keys()}
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

    # Resolve child's previous tree once for all ancestors so the
    # graft can three-way-merge against it instead of treating
    # previously-projected content as "parent_scope_wins".
    child_prev_tree_hash = _resolve_child_prev_tree(repo, child_commit_id)

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
            # V1 spec §7: parent_scope_wins resolves cross-scope same-path
            # overlaps. When parent's authoritative tree has a different
            # value at a path that the child also writes, the parent's
            # content stays. We can't enforce this at child commit time
            # alone (separate CAS streams) — the graft is where parent +
            # child trees meet, so we apply the override here.
            new_tree = _graft_with_parent_wins(
                repo, old_hash, relative, child_new_tree_hash,
                child_prev_tree_hash=child_prev_tree_hash,
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
            new_commit, cordon_used = _build_promote_commit(
                repo,
                ancestor=ancestor,
                tree_sha=new_tree,
                parent_sha=current_head or "",
                who=child_commit_actor or "scope-promote",
                message=promote_message,
                created_at_iso=created_at_iso,
            )
            # When ancestry is cordoned (parent_sha dropped), don't tell
            # publish_scope_update that we still chain off current_head —
            # the new commit is an orphan, so the CAS precondition has to
            # match. We still pass current_head as the *scope* base for
            # the optimistic update of runtime scope state itself.
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
                cordon_note = "  [cordon: non-git ancestry dropped]" if cordon_used else ""
                log_info(
                    f"[scope-promote] {child_norm} -> {ancestor or '/'} "
                    f"new_commit={new_commit[:12]}{cordon_note}",
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


def _build_promote_commit(
    repo,
    *,
    ancestor: str,
    tree_sha: str,
    parent_sha: str,
    who: str,
    message: str,
    created_at_iso: str,
) -> tuple[str, bool]:
    """Build a Git commit for a scope-promote with request-path-safe ancestry.

    Returns ``(commit_id, cordon_used)``.

    Product writes and scope-promote projections must not recursively walk the
    whole parent graph. Deep Git repair belongs at Git view/transport
    boundaries; this path only needs a shallow-safe parent for a durable,
    auditable projection commit.
    """

    safe_parent = shallow_git_parent_or_empty(repo, parent_sha)
    cordon_used = bool(parent_sha and not safe_parent)
    if cordon_used:
        log_warning(
            f"[scope-promote] parent of {ancestor or '/'} is not shallow "
            "Git-clean; promoting as orphan boundary commit",
        )
        message = message + (
            f"PuppyOne-Cordon: non-git-ancestry\n"
            "PuppyOne-Cordon-Reason: parent-not-shallow-git-clean\n"
        )
    return (
        build_git_commit(
            repo,
            tree_sha=tree_sha,
            parent_sha=safe_parent,
            who=who,
            message=message,
            created_at_iso=created_at_iso,
            validate_parent_graph=False,
        ),
        cordon_used,
    )


def promote_to_one_parent(
    repo,
    *,
    project_id: str,
    parent_scope_path: str,
    child_scope_path: str,
    child_new_tree_hash: str,
    child_commit_actor: str,
    child_commit_id: str,
    created_at_iso: str,
    trailer_extra: str = "",
) -> dict[str, Any] | None:
    """Promote ``child`` into a SPECIFIC ``parent`` (single hop).

    Used by the "re-graft after parent commit" path so we can refresh
    the parent's view of one child without re-firing the full ancestor
    walk (which would also touch the global root and any intermediate
    scopes, wasting work).

    Same parent_scope_wins semantics as :func:`promote_to_parents`:
    where the parent has a different value at the same path, the
    parent's content stays.

    Returns the new promote entry (``{scope_path, new_commit_id,
    new_scope_hash}``) on success, ``None`` if there was nothing to do
    or the publish failed.
    """

    _ = project_id  # kept for symmetry with promote_to_parents
    parent_norm = normalize_path(parent_scope_path)
    child_norm = normalize_path(child_scope_path)
    if not child_norm or not child_new_tree_hash:
        return None
    if parent_norm and not child_norm.startswith(parent_norm + "/"):
        return None
    relative = (
        child_norm[len(parent_norm):].lstrip("/")
        if parent_norm
        else child_norm
    )
    if not relative:
        return None

    try:
        old_hash, current_head = _scope_head(repo, parent_norm)
        child_prev_tree_hash = _resolve_child_prev_tree(repo, child_commit_id)
        new_tree = _graft_with_parent_wins(
            repo, old_hash, relative, child_new_tree_hash,
            child_prev_tree_hash=child_prev_tree_hash,
        ) if old_hash else _build_parent_skeleton(
            repo, relative, child_new_tree_hash,
        )
        if new_tree == old_hash:
            return None

        promote_message = (
            f"scope-promote {child_norm} -> {parent_norm or '/'}\n\n"
            f"PuppyOne-Source: {_PROMOTE_TRAILER_SOURCE}\n"
            f"PuppyOne-Child-Commit: {child_commit_id}\n"
            f"PuppyOne-Child-Scope: {child_norm}\n"
            + trailer_extra
        )
        new_commit, cordon_used = _build_promote_commit(
            repo,
            ancestor=parent_norm,
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
                f"skipping one-hop promote to {parent_norm!r}",
            )
            return None
        result = publish(
            scope_path=parent_norm,
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
                "regraft": bool(trailer_extra),
            },
            source_channel="agent",
            policy="scope_promote",
            base_commit_id=current_head,
            client_commit_id="",
            proposed_tree_id=new_tree,
            intent_type="operation",
        )
        published = result[0] if isinstance(result, tuple) else bool(result)
        if not published:
            return None
        cordon_note = "  [cordon: non-git ancestry dropped]" if cordon_used else ""
        regraft_note = "  [re-graft]" if trailer_extra else ""
        log_info(
            f"[scope-promote] {child_norm} -> {parent_norm or '/'} "
            f"new_commit={new_commit[:12]}{cordon_note}{regraft_note}",
        )
        return {
            "scope_path": parent_norm,
            "new_commit_id": new_commit,
            "new_scope_hash": new_tree,
        }
    except Exception as exc:
        log_warning(
            f"[scope-promote] one-hop promote {child_norm!r} -> "
            f"{parent_norm or '/'!r} failed: {exc}",
        )
        return None


def _resolve_child_prev_tree(repo, child_commit_id: str) -> str:
    """Return the tree hash of ``child_commit_id``'s first Git parent.

    Used as the base for the parent_scope_wins three-way merge: it tells
    us what the child scope's content was BEFORE this commit, so we can
    distinguish "parent has authoritative content" (parent != base
    AND parent != child_new) from "parent's tree is just the previously-
    grafted projection of child's old content" (parent == base).

    Returns ``""`` when the commit has no Git-format parent (first
    commit on the scope, or cordoned commit) — callers fall back
    to two-way semantics where every parent-vs-child difference is
    treated as a parent override.
    """

    if not child_commit_id:
        return ""
    try:
        obj_type, content = repo.store.get_object(child_commit_id)
        if obj_type != "commit":
            return ""
        from src.version_engine.write_engine.git_object_format import decode_commit
        info = decode_commit(content)
        parents = info.get("parents") or []
        if not parents:
            return ""
        parent_id = parents[0]
        if not parent_id:
            return ""
        parent_obj_type, parent_body = repo.store.get_object(parent_id)
        if parent_obj_type != "commit":
            return ""
        parent_info = decode_commit(parent_body)
        return parent_info.get("tree", "") or ""
    except Exception:
        return ""


def _graft_with_parent_wins(
    repo,
    parent_root_hash: str,
    mount_path: str,
    child_tree_hash: str,
    *,
    child_prev_tree_hash: str = "",
) -> str:
    """Graft ``child_tree`` into ``parent_root`` at ``mount_path`` with
    parent_scope_wins enforcement (V1 spec §7).

    Uses a three-way merge against ``child_prev_tree_hash`` to tell the
    difference between:
      * parent's authoritative content (a direct parent-scope write
        that touched a child-territory path) → parent wins
      * parent's projected content (left over from a previous graft of
        the same child scope, ``parent_at_mount[path] == child_prev``)
        → child's update propagates normally

    Without the previous-tree base, every child update would be
    rejected by parent_scope_wins because the parent's subtree always
    looks "different" from the child's new tree (it's still showing
    the OLD child content from the last graft). The base lets us split
    those two situations.

    Per-path semantics, where
      ``base`` = ``child_prev_tree`` at ``rel``,
      ``ours`` = ``parent_root`` at ``mount_path/rel``,
      ``theirs`` = ``child_tree`` at ``rel``:
      * ours == theirs                 → no change
      * ours == base                   → take theirs (child update flows)
      * theirs == base                 → keep ours (parent edit stays;
                                          shouldn't happen — child's
                                          incoming side never matches a
                                          stale projection — but harmless)
      * else                           → **parent wins** (drop child's
                                          value, leave parent unchanged)
      * parent has NO content (None)   → write child's value
      * parent has content child lacks → keep (never delete parent's
                                          authoritative entries)
    """

    from src.version_engine.write_engine.tree_objects import flatten_tree_to_bytes
    from src.version_engine.adapters.product.tree_patch import splice_batch

    parent_at_mount = _read_subtree_files(
        repo.store, parent_root_hash, mount_path,
    )
    child_files = flatten_tree_to_bytes(repo.store, child_tree_hash)
    child_prev: dict[str, bytes] = (
        flatten_tree_to_bytes(repo.store, child_prev_tree_hash)
        if child_prev_tree_hash
        else {}
    )

    paths_to_put: dict[str, bytes] = {}
    for rel, child_content in child_files.items():
        parent_content = parent_at_mount.get(rel)
        if parent_content is None:
            # Parent has nothing here (deleted or never had it) — child
            # re-grafts unconditionally so child-owned paths survive
            # parent's delete/rename of the mount range.
            paths_to_put[rel] = child_content
            continue
        if parent_content == child_content:
            # Already in sync.
            continue
        base_content = child_prev.get(rel)
        if base_content is not None and parent_content == base_content:
            # Parent's content is just the previous projection of child —
            # not an authoritative parent edit. Child's new value wins.
            paths_to_put[rel] = child_content
            continue
        # Otherwise parent has authoritative content at this path
        # (different from both base and incoming). parent_scope_wins.
        continue

    if not paths_to_put:
        return parent_root_hash

    ops = [
        ("put", (f"{mount_path}/{rel}" if mount_path else rel), content)
        for rel, content in paths_to_put.items()
    ]
    new_root, _ = splice_batch(repo.store, parent_root_hash, ops)
    return new_root


def _read_subtree_files(store, root_hash: str, mount_path: str) -> dict[str, bytes]:
    """Return ``{rel_path: bytes}`` for every file under ``mount_path``
    in ``root_hash``. Empty dict if the subtree doesn't exist.
    """

    from src.version_engine.write_engine import tree as tree_mod
    from src.version_engine.write_engine.tree_objects import flatten_tree_to_bytes

    parts = [p for p in mount_path.strip("/").split("/") if p]
    current = root_hash
    for part in parts:
        try:
            entries = tree_mod.read_tree(store, current)
        except Exception:
            return {}
        typ, child = entries.get(part, (None, None))
        if typ != "T":
            return {}
        current = child
    try:
        return flatten_tree_to_bytes(store, current)
    except Exception:
        return {}


def _build_parent_skeleton(repo, relative: str, child_tree_hash: str) -> str:
    """Build a minimal parent tree containing only the child's subtree.

    Used when the ancestor scope has no head yet (first scope-promote
    after a fresh project). Subsequent promotions then graft into this
    skeleton normally.
    """

    from src.version_engine.write_engine.git_object_format import encode_tree

    empty = repo.store.put_tree(encode_tree([]))
    return graft_subtree(repo.store, empty, relative, child_tree_hash)

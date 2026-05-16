"""Compatibility handlers for the legacy MUT HTTP wire shape.

These handlers are deliberately local to PuppyOne. They preserve the old wire
contract for clone/pull/negotiate and for in-process compatibility tests, while
production write paths can route through the Git-native transaction engine.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

from src.mut_engine.adapters.mut.protocol import (
    CloneResponse,
    NegotiateRequest,
    NegotiateResponse,
    PullCommitRequest,
    PullRequest,
    PullResponse,
    PushRequest,
    PushResponse,
    RollbackRequest,
    RollbackResponse,
    ScopeInfo,
    ScopesResponse,
    require_supported_protocol,
)
from src.mut_engine.application import tree as tree_mod
from src.mut_engine.application.errors import LockError, ObjectNotFoundError, PermissionDenied
from src.mut_engine.application.git_object_format import encode_commit
from src.mut_engine.application.merge import merge_file_sets
from src.mut_engine.application.object_store import ObjectStore
from src.mut_engine.application.path_utils import normalize_path
from src.mut_engine.application.scope import check_path_permission


MAX_CLONE_HISTORY = 200
MAX_PULL_HISTORY = 200
MAX_CAS_RETRIES = 3


def handle_clone(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    scope = auth["_scope"]

    files_raw = repo.list_scope_files(scope)
    files_b64 = {
        path: base64.b64encode(data).decode()
        for path, data in files_raw.items()
    }

    scope_tree_hash = repo.build_scope_tree(scope)
    scope_hashes = tree_mod.collect_reachable_hashes(repo.store, scope_tree_hash)
    objects_b64 = {
        h: base64.b64encode(repo.store.get_loose(h)).decode()
        for h in scope_hashes
    }

    head_commit_id = repo.get_scope_head_commit_id(scope["path"])
    if head_commit_id and repo.store.exists(head_commit_id):
        objects_b64[head_commit_id] = base64.b64encode(
            repo.store.get_loose(head_commit_id)
        ).decode()

    history = repo.get_history_since(
        "",
        scope_path=scope["path"],
        limit=MAX_CLONE_HISTORY,
    )
    repo.record_audit(
        "clone",
        auth["agent"],
        {
            "scope": scope["path"],
            "files": len(files_raw),
            "commit_id": head_commit_id,
        },
    )

    return CloneResponse(
        project=repo.get_project_name(),
        files=files_b64,
        objects=objects_b64,
        history=history,
        head_commit_id=head_commit_id,
        scope=ScopeInfo(
            path=scope["path"],
            exclude=scope.get("exclude", []),
            mode=scope.get("mode", "rw"),
        ),
    ).to_dict()


def handle_push(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    scope = auth["_scope"]
    if scope.get("mode", "r") == "r":
        raise PermissionDenied("scope is read-only")

    req = PushRequest.from_dict(body)
    _store_incoming_objects(repo.store, req.objects)
    if not req.snapshots:
        return PushResponse(
            status="ok",
            commit_id=repo.get_scope_head_commit_id(scope["path"]),
        ).to_dict()

    their_root_hash = req.snapshots[-1]["root"]
    their_files = _flatten_tree_to_bytes(repo.store, their_root_hash)
    scope_prefix = normalize_path(scope["path"])

    rejected = _validate_scope_paths(scope, scope_prefix, their_files)
    if rejected:
        repo.record_audit(
            "push_rejected",
            auth["agent"],
            {"scope": scope["path"], "rejected_paths": rejected},
        )
        raise PermissionDenied(f"paths outside scope: {rejected[:5]}")

    for attempt in range(MAX_CAS_RETRIES + 1):
        result = _push_cas_attempt(
            repo,
            scope,
            auth,
            req,
            their_files,
            scope_prefix,
            attempt,
        )
        if result is not None:
            return result

    repo.record_audit(
        "push_error",
        auth["agent"],
        {"scope": scope["path"], "error": "CAS failed after max retries"},
    )
    raise LockError(
        f"concurrent push conflict after {MAX_CAS_RETRIES} retries, try again"
    )


def handle_negotiate(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    req = NegotiateRequest.from_dict(body)
    scope = auth.get("_scope") or {}

    missing = [h for h in req.hashes if not repo.store.exists(h)]
    scope_path = scope.get("path", "")
    server_head = (
        repo.get_scope_head_commit_id(scope_path)
        if scope_path
        else ""
    ) or repo.get_head_commit_id()

    recognized = True
    if req.remote_head:
        recognized = repo.get_history_entry(req.remote_head) is not None

    return NegotiateResponse(
        missing=missing,
        server_head_commit_id=server_head,
        remote_head_recognized=recognized,
    ).to_dict()


def handle_scopes(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    scope = auth["_scope"]
    owned = ScopeInfo(
        id=scope.get("id", ""),
        path=scope.get("path", "/"),
        exclude=list(scope.get("exclude", [])),
        mode=scope.get("mode", "rw"),
    )

    owned_norm = normalize_path(scope.get("path", ""))
    descendants: list[ScopeInfo] = []
    for candidate in repo.scopes.list_all():
        if candidate.get("id") == owned.id:
            continue
        scope_path = normalize_path(candidate.get("path", ""))
        if owned_norm and not (
            scope_path == owned_norm or scope_path.startswith(owned_norm + "/")
        ):
            continue
        descendants.append(
            ScopeInfo(
                id=candidate.get("id", ""),
                path=candidate.get("path", "/"),
                exclude=list(candidate.get("exclude", [])),
                mode="?",
            )
        )
    descendants.sort(key=lambda item: item.path)
    return ScopesResponse(owned=owned, descendants=descendants).to_dict()


def handle_pull(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    scope = auth["_scope"]
    req = PullRequest.from_dict(body)
    head_commit_id = repo.get_scope_head_commit_id(scope["path"])

    if req.since_commit_id and req.since_commit_id == head_commit_id:
        return PullResponse(
            status="up-to-date",
            head_commit_id=head_commit_id,
        ).to_dict()

    files_raw = repo.list_scope_files(scope)
    files_b64 = {
        path: base64.b64encode(data).decode()
        for path, data in files_raw.items()
    }

    scope_tree_hash = repo.build_scope_tree(scope)
    scope_hashes = tree_mod.collect_reachable_hashes(repo.store, scope_tree_hash)
    have_hashes = set(req.have_hashes)
    objects_b64 = {
        h: base64.b64encode(repo.store.get_loose(h)).decode()
        for h in scope_hashes
        if h not in have_hashes
    }
    if head_commit_id and head_commit_id not in have_hashes and repo.store.exists(head_commit_id):
        objects_b64[head_commit_id] = base64.b64encode(
            repo.store.get_loose(head_commit_id)
        ).decode()

    history = repo.get_history_since(
        req.since_commit_id,
        scope_path=scope["path"],
        limit=MAX_PULL_HISTORY,
    )
    repo.record_audit(
        "pull",
        auth["agent"],
        {
            "scope": scope["path"],
            "since_commit_id": req.since_commit_id,
            "commit_id": head_commit_id,
        },
    )

    return PullResponse(
        status="updated",
        head_commit_id=head_commit_id,
        files=files_b64,
        objects=objects_b64,
        history=history,
    ).to_dict()


def handle_pull_commit(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    scope = auth["_scope"]
    req = PullCommitRequest.from_dict(body)
    target_commit_id = req.commit_id

    if not target_commit_id:
        raise ValueError("commit_id is required")

    entry = repo.get_history_entry(target_commit_id)
    if not entry:
        raise ValueError(f"commit {target_commit_id} not found")

    subtree_hash = _resolve_scope_tree_hash(repo, entry, scope["path"])
    if subtree_hash is None:
        raise ObjectNotFoundError(f"no tree data for commit {target_commit_id}")

    files_b64: dict[str, str] = {}
    objects_b64: dict[str, str] = {}
    if subtree_hash:
        flat = tree_mod.tree_to_flat(repo.store, subtree_hash)
        for path, h in flat.items():
            files_b64[path] = base64.b64encode(repo.store.get(h)).decode()
        reachable = tree_mod.collect_reachable_hashes(repo.store, subtree_hash)
        objects_b64 = {
            h: base64.b64encode(repo.store.get_loose(h)).decode()
            for h in reachable
        }

    repo.record_audit(
        "pull_commit",
        auth["agent"],
        {"scope": scope["path"], "commit_id": target_commit_id},
    )
    return {
        "status": "ok",
        "commit_id": target_commit_id,
        "files": files_b64,
        "objects": objects_b64,
    }


handle_pull_version = handle_pull_commit


def handle_rollback(repo, auth: dict, body: dict) -> dict:
    require_supported_protocol(body)
    scope = auth["_scope"]
    if scope.get("mode", "r") == "r":
        raise PermissionDenied("scope is read-only")

    req = RollbackRequest.from_dict(body)
    target_commit_id = req.target_commit_id
    current_head = repo.get_scope_head_commit_id(scope["path"])

    if not target_commit_id:
        raise ValueError("target_commit_id is required")
    if target_commit_id == current_head:
        return RollbackResponse(
            status="already-at-commit",
            new_commit_id=current_head,
            target_commit_id=target_commit_id,
        ).to_dict()

    target_entry = repo.get_history_entry(target_commit_id)
    if not target_entry:
        raise ValueError(f"commit {target_commit_id} not found")

    scope_prefix = normalize_path(scope["path"])
    subtree_hash = _resolve_scope_tree_hash(repo, target_entry, scope["path"])
    if subtree_hash is None:
        raise ObjectNotFoundError(f"no tree data for commit {target_commit_id}")

    target_files = _flatten_tree_to_bytes(repo.store, subtree_hash)
    for attempt in range(MAX_CAS_RETRIES + 1):
        result = _rollback_cas_attempt(
            repo,
            scope,
            auth,
            target_commit_id,
            target_files,
            scope_prefix,
            attempt,
        )
        if result is not None:
            return result

    repo.record_audit(
        "rollback_error",
        auth["agent"],
        {
            "scope": scope["path"],
            "target_commit_id": target_commit_id,
            "error": "CAS failed after max retries",
        },
    )
    raise LockError(
        f"concurrent rollback conflict after {MAX_CAS_RETRIES} retries, try again"
    )


def _push_cas_attempt(
    repo,
    scope: dict,
    auth: dict,
    req: PushRequest,
    their_files: dict,
    scope_prefix: str,
    attempt: int,
) -> dict | None:
    old_scope_hash = repo.get_scope_hash(scope["path"])
    our_files = repo.list_scope_files(scope)
    current_head_commit = repo.get_scope_head_commit_id(scope["path"])

    merged_files, merge_conflicts = _resolve_conflicts(
        repo,
        scope,
        req.base_commit_id,
        current_head_commit,
        our_files,
        their_files,
    )

    if merge_conflicts:
        repo.record_audit(
            "merge_conflict",
            auth["agent"],
            {
                "scope": scope["path"],
                "base_commit_id": req.base_commit_id,
                "server_commit_id": current_head_commit,
                "attempt": attempt,
                "conflicts": [
                    {
                        "path": conflict.path,
                        "strategy": conflict.strategy,
                        "detail": conflict.detail,
                        "kept": conflict.kept,
                        "lost_content": conflict.lost_content,
                        "lost_hash": conflict.lost_hash,
                    }
                    for conflict in merge_conflicts
                ],
            },
        )

    _apply_merged_files(repo, scope, our_files, merged_files)
    new_scope_hash = repo.build_scope_tree(scope)
    created_at_iso = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    new_commit_id = _make_commit(
        repo,
        tree_sha=new_scope_hash,
        parent_sha=current_head_commit,
        who=auth["agent"],
        message=req.snapshots[-1].get("message", "") if req.snapshots else "",
        created_at_iso=created_at_iso,
    )

    if not repo.cas_update_scope(
        scope["path"],
        old_scope_hash,
        new_scope_hash,
        head_commit_id=new_commit_id,
    ):
        return None

    changes = _compute_changeset(scope_prefix, our_files, merged_files)
    merged_changes = _compute_merged_changes(
        our_files,
        merged_files,
        their_files,
        scope_prefix,
    )
    repo.record_history(
        new_commit_id,
        auth["agent"],
        req.snapshots[-1].get("message", ""),
        scope["path"],
        changes,
        conflicts=merge_conflicts,
        scope_hash=new_scope_hash,
        created_at_iso=created_at_iso,
    )
    repo.set_head_commit_id(new_commit_id)
    repo.record_audit(
        "push",
        auth["agent"],
        {
            "scope": scope["path"],
            "snapshots": len(req.snapshots),
            "commit_id": new_commit_id,
            "scope_hash": new_scope_hash,
            "merged": bool(merge_conflicts),
            "conflict_count": len(merge_conflicts),
            "cas_attempts": attempt + 1,
        },
    )

    try:
        commit_loose_b64 = base64.b64encode(repo.store.get_loose(new_commit_id)).decode()
    except Exception:
        commit_loose_b64 = ""

    return PushResponse(
        status="ok",
        commit_id=new_commit_id,
        pushed=len(req.snapshots),
        root=new_scope_hash,
        merged=bool(merge_conflicts),
        conflicts=len(merge_conflicts),
        merged_changes=merged_changes,
        commit_object=commit_loose_b64,
    ).to_dict()


def _rollback_cas_attempt(
    repo,
    scope: dict,
    auth: dict,
    target_commit_id: str,
    target_files: dict,
    scope_prefix: str,
    attempt: int,
) -> dict | None:
    old_scope_hash = repo.get_scope_hash(scope["path"])
    current_files = repo.list_scope_files(scope)
    changes = _compute_changeset(scope_prefix, current_files, target_files)

    _apply_merged_files(repo, scope, current_files, target_files)
    new_scope_hash = repo.build_scope_tree(scope)
    created_at_iso = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    parent_sha = repo.get_scope_head_commit_id(scope["path"])
    new_commit_id = _make_commit(
        repo,
        tree_sha=new_scope_hash,
        parent_sha=parent_sha,
        who=auth["agent"],
        message=f"rollback to {target_commit_id}",
        created_at_iso=created_at_iso,
    )

    if not repo.cas_update_scope(
        scope["path"],
        old_scope_hash,
        new_scope_hash,
        head_commit_id=new_commit_id,
    ):
        return None

    repo.record_history(
        new_commit_id,
        auth["agent"],
        f"rollback to #{target_commit_id}",
        scope["path"],
        changes,
        scope_hash=new_scope_hash,
        created_at_iso=created_at_iso,
    )
    repo.set_head_commit_id(new_commit_id)
    repo.record_audit(
        "rollback",
        auth["agent"],
        {
            "scope": scope["path"],
            "target_commit_id": target_commit_id,
            "new_commit_id": new_commit_id,
            "scope_hash": new_scope_hash,
            "cas_attempts": attempt + 1,
        },
    )

    return RollbackResponse(
        status="rolled-back",
        new_commit_id=new_commit_id,
        target_commit_id=target_commit_id,
        root=new_scope_hash,
        changes=changes,
    ).to_dict()


def _make_commit(
    repo,
    tree_sha: str,
    parent_sha: str,
    who: str,
    message: str,
    created_at_iso: str,
) -> str:
    try:
        dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ts = int(dt.timestamp())
    offset = dt.utcoffset()
    if offset is None:
        timezone_text = "+0000"
    else:
        secs = int(offset.total_seconds())
        sign = "+" if secs >= 0 else "-"
        secs = abs(secs)
        timezone_text = f"{sign}{secs // 3600:02d}{(secs % 3600) // 60:02d}"

    identity = who or "anonymous"
    if "<" not in identity:
        slug = identity.replace(" ", "-").lower() or "anonymous"
        identity = f"{identity} <{slug}@puppyone>"
    commit_body = encode_commit(
        tree_sha1=tree_sha,
        parent_sha1=parent_sha or None,
        author=identity,
        author_time=f"{ts} {timezone_text}",
        committer=identity,
        committer_time=f"{ts} {timezone_text}",
        message=message or "(no message)",
    )
    return repo.store.put_commit(commit_body)


def _store_incoming_objects(store: ObjectStore, objects_b64: dict) -> None:
    for object_id, b64data in (objects_b64 or {}).items():
        store.put_loose(object_id, base64.b64decode(b64data))


def _validate_scope_paths(scope: dict, scope_prefix: str, files: dict) -> list[str]:
    rejected: list[str] = []
    for rel_path in files:
        full_path = f"{scope_prefix}/{rel_path}" if scope_prefix else rel_path
        if not check_path_permission(scope, full_path, "write"):
            rejected.append(full_path)
    return rejected


def _resolve_conflicts(
    repo,
    scope: dict,
    base_commit_id: str,
    current_head_commit: str,
    our_files: dict,
    their_files: dict,
):
    if base_commit_id == current_head_commit:
        return their_files, []
    base_files = _get_base_files(repo, scope, base_commit_id) if base_commit_id else {}
    return merge_file_sets(base_files, our_files, their_files)


def _apply_merged_files(repo, scope: dict, old_scope_files: dict, merged_files: dict) -> None:
    for old_path in old_scope_files:
        if old_path not in merged_files:
            repo.delete_scope_file(scope, old_path)
    repo.write_scope_files(scope, merged_files)


def _compute_changeset(scope_prefix: str, old_files: dict, merged_files: dict) -> list[dict]:
    changes: list[dict] = []
    for rel_path, new_data in merged_files.items():
        full_path = f"{scope_prefix}/{rel_path}" if scope_prefix else rel_path
        if rel_path not in old_files:
            changes.append({"path": full_path, "action": "add"})
        elif old_files[rel_path] != new_data:
            changes.append({"path": full_path, "action": "update"})
    for old_path in old_files:
        if old_path not in merged_files:
            full_path = f"{scope_prefix}/{old_path}" if scope_prefix else old_path
            changes.append({"path": full_path, "action": "delete"})
    return changes


def _compute_merged_changes(
    our_files: dict,
    merged_files: dict,
    their_files: dict,
    scope_prefix: str,
) -> list[dict]:
    merged_changes: list[dict] = []
    for rel_path, content in merged_files.items():
        full_path = f"{scope_prefix}/{rel_path}" if scope_prefix else rel_path
        if rel_path not in their_files and rel_path in our_files:
            merged_changes.append({"path": full_path, "action": "merged_from_server"})
        elif rel_path in their_files and rel_path in our_files:
            if content != their_files[rel_path] and content != our_files.get(rel_path):
                merged_changes.append({"path": full_path, "action": "content_merged"})
    return merged_changes


def _flatten_tree_to_bytes(store, tree_hash: str) -> dict[str, bytes]:
    flat_hashes = tree_mod.tree_to_flat(store, tree_hash)
    return {path: store.get(h) for path, h in flat_hashes.items()}


def _resolve_scope_tree_hash(repo, entry: dict, scope_path: str) -> str | None:
    scope_hash = entry.get("scope_hash", "")
    if scope_hash and repo.store.exists(scope_hash):
        return scope_hash
    root = entry.get("root", "") or entry.get("root_hash", "")
    if root and repo.store.exists(root):
        parts = normalize_path(scope_path).split("/") if normalize_path(scope_path) else []
        return _navigate_tree(repo.store, root, parts)
    return None


def _navigate_tree(store, tree_hash: str, parts: list[str]) -> str | None:
    if not parts:
        return tree_hash
    entries = tree_mod.read_tree(store, tree_hash)
    child = entries.get(parts[0])
    if child is None:
        return None
    typ, object_id = child
    if typ != "T":
        return None
    return _navigate_tree(store, object_id, parts[1:])


def _get_base_files(repo, scope: dict, base_commit_id: str) -> dict[str, bytes]:
    entry = repo.get_history_entry(base_commit_id)
    if not entry:
        return {}
    try:
        scope_hash = entry.get("scope_hash", "")
        if scope_hash and repo.store.exists(scope_hash):
            return _flatten_tree_to_bytes(repo.store, scope_hash)

        root = entry.get("root", "") or entry.get("root_hash", "")
        if root and repo.store.exists(root):
            scope_prefix = normalize_path(scope["path"])
            parts = scope_prefix.split("/") if scope_prefix else []
            subtree_hash = _navigate_tree(repo.store, root, parts)
            if subtree_hash:
                return _flatten_tree_to_bytes(repo.store, subtree_hash)
    except (KeyError, json.JSONDecodeError, ObjectNotFoundError):
        return {}
    return {}

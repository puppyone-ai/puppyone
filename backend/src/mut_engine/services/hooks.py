"""
Post-commit hooks — maintain PuppyOne access_points table consistency after MUT writes.

These hooks update the access_points table when files are deleted or moved
in the MUT tree, ensuring access point paths and scope paths stay consistent.

Best-effort: failures are logged, not propagated to the caller.

Also provides `push_and_finalize` — the canonical async helper that ensures
every push (regardless of call site) triggers the post-push hook.
"""

from __future__ import annotations

import asyncio

from src.utils.logger import log_error, log_info, log_warning


async def push_and_finalize(
    client,
    project_id: str,
    *,
    repo_manager=None,
    modified: dict[str, bytes] | None = None,
    deleted: list[str] | None = None,
    message: str = "",
    who: str | None = None,
) -> dict:
    """Push changes via MutEphemeralClient and run the post-push hook.

    This is the canonical way to push from any async context (agent,
    sandbox, connector). Using this instead of bare client.push()
    guarantees root_hash is grafted after every successful write.
    """
    result = await asyncio.to_thread(
        client.push,
        modified=modified,
        deleted=deleted,
        message=message,
        who=who,
    )

    if result.get("status") == "ok":
        if repo_manager is None:
            from src.mut_engine.dependencies import get_repo_manager_standalone
            repo_manager = get_repo_manager_standalone()
        try:
            await asyncio.to_thread(
                run_post_push_hook, project_id, repo_manager, result,
            )
        except Exception as e:
            log_warning(f"[PostCommit] hook failed after push: {e}")

    return result


_SUCCESS_STATUSES = frozenset({"ok", "rolled-back"})


def run_post_push_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
) -> None:
    """Inspect a push/rollback result and trigger relevant post-commit hooks.

    Called by protocol_router and access_point after a successful MUT
    push or rollback.  Accepts both formats:
      - push:     {"status": "ok",         "commit_id": "…", "root": "..."}
      - rollback: {"status": "rolled-back","new_commit_id": "…", "root": "..."}

    1. Grafts scope tree into the global root hash so tree_reader can see it
    2. Extracts deleted paths from the commit entry and runs post_commit_delete
    """
    status = push_result.get("status", "")
    if status not in _SUCCESS_STATUSES:
        return

    commit_id = push_result.get("commit_id") or push_result.get("new_commit_id") or ""
    if not commit_id:
        return

    result_for_graft = {**push_result, "commit_id": commit_id}

    try:
        repo = repo_manager.get_repo(project_id)

        _update_global_root(repo, result_for_graft)

        entry = repo.history.get_entry(commit_id)
        if not entry:
            return

        changes = entry.get("changes", [])
        if isinstance(changes, str):
            import json
            changes = json.loads(changes)

        deleted_paths = [
            c["path"] for c in changes
            if c.get("action") == "delete" or c.get("op") == "deleted"
        ]

        if deleted_paths:
            post_commit_delete(project_id, deleted_paths)

    except Exception as e:
        log_error(f"[PostCommit] post-push hook failed for project {project_id}: {e}")


def _update_global_root(repo, push_result: dict) -> None:
    """Graft the pushed scope tree into the global root hash with CAS protection.

    Uses conflict-aware grafting: if another scope modified the same subtree
    concurrently, performs a three-way merge instead of blind replacement.
    """
    from mut.server.graft import graft_or_merge_subtree

    scope_hash = push_result.get("root", "")
    if not scope_hash:
        return

    commit_id = push_result["commit_id"]
    entry = repo.history.get_entry(commit_id)
    if not entry:
        log_error(f"[PostCommit] No history entry for commit {commit_id}")
        return

    scope_path = (entry.get("scope_path") or "").strip("/")
    old_scope_hash = _get_previous_scope_hash(repo, commit_id, scope_path)

    MAX_GRAFT_RETRIES = 5
    for attempt in range(MAX_GRAFT_RETRIES):
        try:
            # get_root_hash / cas_update_root_hash may not exist on older
            # mutai PyPI releases (<0.1.7). Fall back to history-based lookup.
            if hasattr(repo, "get_root_hash"):
                db_root = repo.get_root_hash() or ""
            else:
                db_root = repo.history.get_root_hash() if hasattr(repo.history, "get_root_hash") else ""

            if db_root:
                graft_base = db_root
            else:
                import json
                graft_base = repo.store.put(json.dumps({}, sort_keys=True).encode())

            new_root = graft_or_merge_subtree(
                repo.store, graft_base, scope_path, old_scope_hash, scope_hash,
            )

            if hasattr(repo, "cas_update_root_hash"):
                success = repo.cas_update_root_hash(db_root, new_root)
            else:
                # Fallback: direct set (no CAS protection, but better than failing)
                repo.history.set_root_hash(new_root)
                success = True

            if success:
                log_info(f"[PostCommit] Updated global root: scope='{scope_path}' hash={new_root[:16]} (attempt {attempt + 1})")
                return

            log_info(f"[PostCommit] Graft CAS retry {attempt + 1} for scope='{scope_path}'")

        except Exception as e:
            log_warning(f"[PostCommit] Graft attempt {attempt + 1} failed (will retry): {e}")
            continue

    log_error(f"[PostCommit] Graft failed after {MAX_GRAFT_RETRIES} retries for scope='{scope_path}'")


def _get_previous_scope_hash(repo, current_commit_id: str, scope_path: str) -> str:
    """Get the scope hash from the commit BEFORE the current one.

    Used for conflict detection in graft: if the subtree has changed
    from this hash, another scope modified files in our path.
    """
    try:
        return repo.history.get_previous_scope_hash(scope_path, current_commit_id)
    except Exception as e:
        log_warning(f"[PostCommit] Failed to get previous scope hash: {e}")
        return ""


def post_commit_delete(project_id: str, deleted_paths: list[str]) -> None:
    """After deleting paths from MUT tree, clean up dangling access points.

    Nullifies path on access points that referenced deleted paths.
    Also updates scope.path if it falls under a deleted subtree.
    """
    if not deleted_paths:
        return
    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client
        resp = (
            client.table("access_points")
            .select("id, path, config")
            .eq("project_id", project_id)
            .execute()
        )
        for row in resp.data or []:
            node_path = row.get("path") or ""
            conn_id = row["id"]

            if node_path and _path_matches_any(node_path, deleted_paths):
                client.table("access_points").update(
                    {"path": None}
                ).eq("id", conn_id).execute()
                log_info(f"[PostCommit] Cleared dangling path on access point {conn_id}")

            config = row.get("config") or {}
            scope = config.get("scope") or {}
            scope_path = scope.get("path", "")
            if scope_path and _path_matches_any(scope_path, deleted_paths):
                config = dict(config)
                config["scope"] = {**scope, "path": "", "_orphaned_from": scope_path}
                client.table("access_points").update(
                    {"config": config}
                ).eq("id", conn_id).execute()
                log_warning(f"[PostCommit] Orphaned scope path on access point {conn_id}")

    except Exception as e:
        log_error(f"[PostCommit] delete hook failed: {e}")


def post_commit_move(project_id: str, old_prefix: str, new_prefix: str) -> None:
    """After moving/renaming paths in MUT tree, update access point references."""
    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client
        resp = (
            client.table("access_points")
            .select("id, path, config")
            .eq("project_id", project_id)
            .execute()
        )
        for row in resp.data or []:
            updates = _build_move_updates(row, old_prefix, new_prefix)
            if updates:
                client.table("access_points").update(updates).eq("id", row["id"]).execute()
                log_info(f"[PostCommit] Updated access point {row['id']} after move")

    except Exception as e:
        log_error(f"[PostCommit] move hook failed: {e}")


def _build_move_updates(row: dict, old_prefix: str, new_prefix: str) -> dict:
    """Build update dict for a single access point row after a path move."""
    updates: dict = {}

    node_path = row.get("path") or ""
    if node_path:
        new_node_path = _rewrite_path(node_path, old_prefix, new_prefix)
        if new_node_path != node_path:
            updates["path"] = new_node_path

    config = row.get("config") or {}
    scope = config.get("scope") or {}
    scope_path = scope.get("path", "")
    if scope_path:
        new_scope_path = _rewrite_path(scope_path, old_prefix, new_prefix)
        if new_scope_path != scope_path:
            updates["config"] = {**config, "scope": {**scope, "path": new_scope_path}}

    return updates


def _path_matches_any(path: str, deleted_paths: list[str]) -> bool:
    """Check if path equals or is a child of any deleted path."""
    normalized = path.strip("/")
    for dp in deleted_paths:
        dp_norm = dp.strip("/")
        if normalized == dp_norm or normalized.startswith(dp_norm + "/"):
            return True
    return False


def _rewrite_path(path: str, old_prefix: str, new_prefix: str) -> str:
    """Replace old_prefix with new_prefix in path."""
    old_norm = old_prefix.rstrip("/")
    new_norm = new_prefix.rstrip("/")
    if path == old_norm:
        return new_norm
    if path.startswith(old_norm + "/"):
        return new_norm + path[len(old_norm):]
    return path

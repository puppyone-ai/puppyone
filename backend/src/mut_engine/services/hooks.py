"""
Post-commit hooks — maintain PuppyOne connections table consistency after MUT writes.

These hooks update the connections table when files are deleted or moved
in the MUT tree, ensuring connection paths and scope paths stay consistent.

Best-effort: failures are logged, not propagated to the caller.
"""

from __future__ import annotations

from src.utils.logger import log_error, log_info, log_warning


def run_post_push_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
) -> None:
    """Inspect a push result and trigger relevant post-commit hooks.

    Called by protocol_router and access_point after a successful MUT push.
    Extracts deleted paths from the commit entry and runs post_commit_delete.
    """
    version = push_result.get("version")
    if not version or push_result.get("status") != "ok":
        return

    try:
        repo = repo_manager.get_repo(project_id)
        entry = repo.history.get_entry(version)
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


def post_commit_delete(project_id: str, deleted_paths: list[str]) -> None:
    """After deleting paths from MUT tree, clean up dangling connections.

    Nullifies path on connections that referenced deleted paths.
    Also updates scope.path if it falls under a deleted subtree.
    """
    if not deleted_paths:
        return
    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client
        resp = (
            client.table("connections")
            .select("id, path, config")
            .eq("project_id", project_id)
            .execute()
        )
        for row in resp.data or []:
            node_path = row.get("path") or ""
            conn_id = row["id"]

            if node_path and _path_matches_any(node_path, deleted_paths):
                client.table("connections").update(
                    {"path": None}
                ).eq("id", conn_id).execute()
                log_info(f"[PostCommit] Cleared dangling path on connection {conn_id}")

            config = row.get("config") or {}
            scope = config.get("scope") or {}
            scope_path = scope.get("path", "")
            if scope_path and _path_matches_any(scope_path, deleted_paths):
                config = dict(config)
                config["scope"] = {**scope, "path": "", "_orphaned_from": scope_path}
                client.table("connections").update(
                    {"config": config}
                ).eq("id", conn_id).execute()
                log_warning(f"[PostCommit] Orphaned scope path on connection {conn_id}")

    except Exception as e:
        log_error(f"[PostCommit] delete hook failed: {e}")


def post_commit_move(project_id: str, old_prefix: str, new_prefix: str) -> None:
    """After moving/renaming paths in MUT tree, update connections references."""
    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client
        resp = (
            client.table("connections")
            .select("id, path, config")
            .eq("project_id", project_id)
            .execute()
        )
        for row in resp.data or []:
            updates = _build_move_updates(row, old_prefix, new_prefix)
            if updates:
                client.table("connections").update(updates).eq("id", row["id"]).execute()
                log_info(f"[PostCommit] Updated connection {row['id']} after move")

    except Exception as e:
        log_error(f"[PostCommit] move hook failed: {e}")


def _build_move_updates(row: dict, old_prefix: str, new_prefix: str) -> dict:
    """Build update dict for a single connection row after a path move."""
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

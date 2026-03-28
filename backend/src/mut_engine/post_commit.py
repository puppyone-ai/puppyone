"""
Post-commit hooks — actions triggered after every MUT write operation.

All hooks are best-effort (failures logged, not propagated to the caller).
The commit itself has already succeeded at this point.

Hooks:
  1. search_index: upsert/delete Turbopuffer chunks for changed files
  2. mount_consistency: update connections.path for moved/deleted files
  3. scope_consistency: update scope paths when directories are renamed
  4. websocket_notify: push real-time updates to connected frontends

Usage:
  await run_post_commit_hooks(project_id, version, changes, who)
"""

from __future__ import annotations

from src.utils.logger import log_info, log_error


def run_post_commit_hooks(
    project_id: str,
    version: int,
    changes: list[dict],
    who: str,
) -> None:
    """Run all post-commit hooks. Best-effort — errors are logged, not raised."""
    if not changes:
        return

    deleted = _filter_changes(changes, ("delete", "deleted"))
    added_or_modified = _filter_changes(changes, ("add", "update", "added", "modified"))

    for hook_name, hook_fn in [
        ("search_index", lambda: _hook_search_index(project_id, added_or_modified, deleted)),
        ("mount_consistency", lambda: _hook_mount_consistency(project_id, deleted)),
        ("scope_consistency", lambda: _hook_scope_consistency(project_id, changes)),
        ("websocket_notify", lambda: _hook_websocket_notify(project_id, version, changes, who)),
    ]:
        try:
            hook_fn()
        except Exception as e:
            log_error(f"[PostCommit] {hook_name} hook failed: {e}")


def _filter_changes(changes: list[dict], actions: tuple) -> list[str]:
    """Extract paths matching given action/op values."""
    return [
        c["path"] for c in changes
        if c.get("action") in actions or c.get("op") in actions
    ]


# ── Hook 1: Search Index ─────────────────────────────────────

def _hook_search_index(
    project_id: str,
    modified_paths: list[str],
    deleted_paths: list[str],
) -> None:
    """Upsert/delete Turbopuffer search index chunks for changed files."""
    if not modified_paths and not deleted_paths:
        return

    try:
        from src.infra.search.service import SearchService
        from src.infra.search.dependencies import get_search_service

        search_svc = get_search_service()

        for path in deleted_paths:
            try:
                search_svc.delete_by_path(project_id=project_id, path=path)
                log_info(f"[PostCommit] search: deleted index for {path}")
            except Exception as e:
                log_error(f"[PostCommit] search: delete failed for {path}: {e}")

        for path in modified_paths:
            try:
                search_svc.index_by_path(project_id=project_id, path=path)
                log_info(f"[PostCommit] search: indexed {path}")
            except Exception as e:
                log_error(f"[PostCommit] search: index failed for {path}: {e}")

    except ImportError:
        pass  # Search module not available in this deployment


# ── Hook 2: Mount Point Consistency ──────────────────────────

def _hook_mount_consistency(
    project_id: str,
    deleted_paths: list[str],
) -> None:
    """Update connections.path for moved/deleted files."""
    if not deleted_paths:
        return

    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client

        for path in deleted_paths:
            resp = (
                client.table("connections")
                .select("id, path, config")
                .eq("project_id", project_id)
                .eq("path", path)
                .execute()
            )
            for conn in (resp.data or []):
                _orphan_connection(client, conn, path)
    except Exception as e:
        log_error(f"[PostCommit] mount_consistency error: {e}")


def _orphan_connection(client, conn: dict, path: str) -> None:
    """Mark a connection's scope as orphaned after its path was deleted."""
    config = conn.get("config") or {}
    scope = config.get("scope") if isinstance(config.get("scope"), dict) else {}
    scope["_orphaned_from"] = path
    config["scope"] = scope
    client.table("connections").update(
        {"config": config}
    ).eq("id", conn["id"]).execute()
    log_info(f"[PostCommit] mount: orphaned connection {conn['id']} (was: {path})")


# ── Hook 3: Scope Consistency ────────────────────────────────

def _hook_scope_consistency(
    project_id: str,
    changes: list[dict],
) -> None:
    """Update scope paths when directories are renamed."""
    renames = _detect_renames(changes)
    if not renames:
        return

    try:
        from src.infra.supabase.client import SupabaseClient
        from src.mut_engine.backends.supabase_scope import SupabaseScopeBackend
        from mut.server.scope_manager import ScopeManager

        backend = SupabaseScopeBackend(SupabaseClient(), project_id)
        manager = ScopeManager(backend)

        for old_path, new_path in renames:
            _update_scopes_for_rename(manager, old_path, new_path)
    except Exception as e:
        log_error(f"[PostCommit] scope_consistency error: {e}")


def _detect_renames(changes: list[dict]) -> list[tuple[str, str]]:
    """Detect rename patterns: delete + add of same-name file in different dirs."""
    deleted = _filter_changes(changes, ("delete", "deleted"))
    added = _filter_changes(changes, ("add", "added"))
    if not deleted or not added:
        return []

    added_by_name: dict[str, str] = {}
    for path in added:
        name = path.rsplit("/", 1)[-1] if "/" in path else path
        added_by_name.setdefault(name, path)

    renames = []
    for old_path in deleted:
        name = old_path.rsplit("/", 1)[-1] if "/" in old_path else old_path
        new_path = added_by_name.get(name)
        if new_path and new_path != old_path:
            renames.append((old_path, new_path))
    return renames


def _update_scopes_for_rename(manager, old_path: str, new_path: str) -> None:
    """Update scopes affected by a path rename."""
    old_dir = old_path.rsplit("/", 1)[0] if "/" in old_path else ""
    new_dir = new_path.rsplit("/", 1)[0] if "/" in new_path else ""

    if old_dir == new_dir:
        return

    for scope in manager.find_by_path_prefix(old_dir):
        scope_path = scope.get("path", "")
        if scope_path.startswith(old_dir):
            updated_path = new_dir + scope_path[len(old_dir):]
            manager.update_path(scope["id"], updated_path)
            log_info(f"[PostCommit] scope: {scope['id']} path {scope_path} -> {updated_path}")


# ── Hook 4: WebSocket Notification ───────────────────────────

def _hook_websocket_notify(
    project_id: str,
    version: int,
    changes: list[dict],
    who: str,
) -> None:
    """Push real-time update notification to connected frontends.

    Uses PuppyOne's WebSocket broadcast infrastructure if available.
    Falls back to logging when WS is not configured.
    """
    changed_files = [c.get("path", "") for c in changes]

    try:
        from src.utils.websocket_manager import broadcast_project_update
        broadcast_project_update(
            project_id=project_id,
            event="mut_commit",
            data={
                "version": version,
                "who": who,
                "changed_files": changed_files[:50],  # cap for payload size
                "total_changes": len(changed_files),
            },
        )
    except ImportError:
        # WebSocket manager not available — log only
        log_info(
            f"[PostCommit] ws: project={project_id} v={version} "
            f"by={who} files={len(changed_files)}"
        )

"""
Post-commit hooks — keep ``repo_scopes`` consistent with tree mutations.

When files/folders are deleted or moved in a PuppyOne project, scopes
that referenced those paths need to follow the change (rename) or get
surfaced as orphaned (delete). Both hooks are best-effort: failures
log and don't propagate.

Also provides ``push_and_finalize`` — the canonical async helper that
ensures every push (regardless of call site) triggers the post-push
hook.
"""

from __future__ import annotations

import asyncio
import threading

from src.mut_engine.application.root_projection import (
    rebuild_project_root_after_commit,
)
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
    *,
    raise_errors: bool = False,
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
        repo = repo_manager.get_server_repo(project_id)

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
        scope_path = (entry.get("scope_path") or "").strip("/")
        if scope_path:
            deleted_paths = [
                f"{scope_path}/{p.strip('/')}" if p.strip("/") else scope_path
                for p in deleted_paths
            ]

        if deleted_paths:
            post_commit_delete(project_id, deleted_paths)

        # Child-promotes-parent (07-version-engine-supplement.md §7.B).
        # The promote step is best-effort: each ancestor's CAS happens
        # independently, so a stale ancestor head triggers a retry but
        # cannot block the just-landed child commit.
        _promote_to_ancestor_scopes(repo, project_id, entry, scope_path)

        # Refresh the materialised fs_path_index so the next
        # `puppyone fs find` / `stat` query sees the new files (H1).
        # Best-effort: a Supabase blip degrades fs queries to live S3
        # walks, not a write failure.
        _refresh_fs_path_index(repo, project_id, entry, commit_id, scope_path)

        # Fan out commit_update over WebSocket to subscribed clients.
        # Best-effort: a notification failure must not block the
        # commit. We schedule on the running loop if there is one;
        # otherwise (sync-only context) we fire-and-forget via a
        # short-lived loop so producers never wait on listeners.
        _broadcast_commit_update(project_id, entry, changes)

    except Exception as e:
        log_error(f"[PostCommit] post-push hook failed for project {project_id}: {e}")
        if raise_errors:
            raise


def _refresh_fs_path_index(
    repo, project_id: str, entry: dict, commit_id: str, scope_path: str,
) -> None:
    """Update the materialised fs_path_index for the just-landed commit.

    Diffs against the previous head of the same scope so we only touch
    rows that actually changed; on first-ever scope write the "previous"
    is empty and every file becomes an insert.
    """

    try:
        from src.mut_engine.services.fs_path_index import (
            refresh_fs_path_index_for_commit,
        )
    except Exception as exc:
        log_warning(f"[PostCommit] fs_path_index import failed: {exc}")
        return

    parents = entry.get("parents") or []
    previous_commit_id = ""
    if isinstance(parents, list) and parents:
        previous_commit_id = parents[0]
    elif entry.get("parent_commit_id"):
        previous_commit_id = entry["parent_commit_id"]

    try:
        refresh_fs_path_index_for_commit(
            repo,
            project_id=project_id,
            commit_id=commit_id,
            scope_path=scope_path,
            previous_commit_id=previous_commit_id,
            actor=entry.get("who", "") or "",
        )
    except Exception as exc:
        log_warning(f"[PostCommit] fs_path_index refresh failed: {exc}")


def _promote_to_ancestor_scopes(repo, project_id: str, entry: dict, scope_path: str) -> None:
    """Run scope-promote projections for the child commit's ancestor scopes.

    No-op for root-scope commits and for commits whose own message already
    carries the ``scope-promote`` trailer (so the projection does not
    recurse into itself when the parent scope is itself a child of a
    further ancestor).
    """

    if not scope_path:
        return
    message = entry.get("message", "") or ""
    if "PuppyOne-Source: scope-promote" in message:
        return
    new_tree_hash = entry.get("scope_hash") or ""
    new_commit_id = entry.get("commit_id") or ""
    if not new_tree_hash or not new_commit_id:
        return

    try:
        from src.mut_engine.application.parent_scope_promote import promote_to_parents
        promote_to_parents(
            repo,
            project_id=project_id,
            child_scope_path=scope_path,
            child_new_tree_hash=new_tree_hash,
            child_commit_actor=entry.get("who", "") or "",
            child_commit_id=new_commit_id,
            created_at_iso=entry.get("created_at", "") or "",
        )
    except Exception as exc:
        log_warning(f"[PostCommit] scope-promote failed: {exc}")


def schedule_post_push_hook(project_id: str, repo_manager, push_result: dict) -> None:
    """Run post-commit projection work off the user request path.

    The accepted scope commit/head/history/audit have already been published
    atomically. Project-root grafts and Git project-view commits are derived
    projections, so AP-FS and Git pushes should not wait on their S3/DB round
    trips. The durable outbox remains the repair path if this best-effort
    background execution fails or the process exits before it completes.
    """

    commit_id = push_result.get("commit_id") or push_result.get("new_commit_id") or ""
    if not commit_id:
        return

    def _run() -> None:
        try:
            run_post_push_hook(
                project_id,
                repo_manager,
                push_result,
                raise_errors=True,
            )
            try:
                from src.mut_engine.services.version_outbox import (
                    complete_version_outbox_for_commit,
                )

                complete_version_outbox_for_commit(project_id, commit_id)
            except Exception as exc:
                log_warning(
                    f"[PostCommit] could not complete outbox for "
                    f"{commit_id[:12]}: {exc}",
                )
        except Exception as exc:
            log_error(
                f"[PostCommit] async projection failed for project "
                f"{project_id} commit={commit_id[:12]}: {exc}",
            )

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(asyncio.to_thread(_run))
    except RuntimeError:
        thread = threading.Thread(
            target=_run,
            name=f"post-commit-{commit_id[:12]}",
            daemon=True,
        )
        thread.start()


def _broadcast_commit_update(project_id: str, entry: dict, changes: list[dict]) -> None:
    """Fire a ``commit_update`` event for connected WebSocket listeners.

    The actual fanout is asynchronous; we just schedule it and return.
    Errors are logged at warning level — the push is already durable
    in the DB, so a flaky listener stream must not propagate up.
    """
    try:
        from src.mut_engine.server.notifications import NotificationManager
        manager = NotificationManager.get()
        coro = manager.broadcast_commit_update(
            project_id=project_id,
            scope_path=(entry.get("scope_path") or ""),
            commit_id=entry.get("commit_id", ""),
            pushed_by=entry.get("who", ""),
            message=entry.get("message", ""),
            scope_hash=entry.get("scope_hash", ""),
            changes=changes,
        )
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(coro)
        except RuntimeError:
            # Sync caller (e.g. ARQ worker) — run to completion in a
            # transient loop so the broadcast actually happens.
            asyncio.run(coro)
    except Exception as e:
        log_warning(f"[PostCommit] broadcast_commit_update failed: {e}")


def _update_global_root(repo, push_result: dict) -> None:
    """Delegate to application/root_projection.

    The graft + CAS retry algorithm and the project-view index update both
    live in application/root_projection now (per
    docs/architecture/07-version-engine-supplement.md §4: graft is an
    application-layer primitive, not a service-layer one). This wrapper
    is kept only because run_post_push_hook and the version-outbox
    worker still call it by name.
    """

    rebuild_project_root_after_commit(repo, push_result)



def post_commit_delete(project_id: str, deleted_paths: list[str]) -> None:
    """After deleting paths from the tree, surface any ``repo_scopes`` rows
    whose path is now orphaned. Best-effort: failures log and don't
    propagate.
    """
    if not deleted_paths:
        return
    _post_commit_delete_repo_scopes(project_id, deleted_paths)


def _post_commit_delete_repo_scopes(
    project_id: str, deleted_paths: list[str],
) -> None:
    """New: log scopes whose path falls under a deleted subtree.

    We deliberately DON'T auto-rewrite repo_scopes.path (the column is
    constrained UNIQUE(project_id, path) — silently moving a scope to ''
    would conflict with the auto-created root scope).

    Connector rows attached to the orphaned scope keep their FK; the user
    sees the orphaned scope in /scopes and decides what to do. Logging
    here gives ops a forensics trail."""
    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client
        resp = (
            client.table("repo_scopes")
            .select("id, path, is_root")
            .eq("project_id", project_id)
            .execute()
        )
        for row in resp.data or []:
            if row.get("is_root"):
                continue   # root scope (path='') is always valid; nothing to do
            scope_path = row.get("path") or ""
            if scope_path and _path_matches_any(scope_path, deleted_paths):
                log_warning(
                    f"[PostCommit] repo_scope {row['id']} path={scope_path!r} "
                    f"is now orphaned (parent folder was deleted). Surface in "
                    f"/scopes UI for user to delete or re-target."
                )
    except Exception as e:
        log_error(f"[PostCommit] delete hook (repo_scopes) failed: {e}")


def post_commit_move(project_id: str, old_prefix: str, new_prefix: str) -> None:
    """After moving/renaming paths in the tree, rewrite ``repo_scopes.path``
    so scopes that lived under ``old_prefix`` follow the move.
    """
    _post_commit_move_repo_scopes(project_id, old_prefix, new_prefix)


def _post_commit_move_repo_scopes(
    project_id: str, old_prefix: str, new_prefix: str,
) -> None:
    """New: rewrite repo_scopes.path on folder rename. The column is a
    real index — much cleaner than the JSONB rewrite for access_points."""
    try:
        from src.infra.supabase.client import SupabaseClient
        client = SupabaseClient().client
        resp = (
            client.table("repo_scopes")
            .select("id, path, is_root")
            .eq("project_id", project_id)
            .execute()
        )
        for row in resp.data or []:
            if row.get("is_root"):
                continue   # root scope path is always '' — never rewritten
            old_path = row.get("path") or ""
            if not old_path:
                continue
            new_path = _rewrite_path(old_path, old_prefix, new_prefix)
            if new_path == old_path:
                continue
            try:
                client.table("repo_scopes").update(
                    {"path": new_path}
                ).eq("id", row["id"]).execute()
                log_info(
                    f"[PostCommit] repo_scope {row['id']} path "
                    f"{old_path!r} → {new_path!r}"
                )
            except Exception as e:
                # The UNIQUE(project_id, path) constraint can fire if a
                # different scope already lives at the new path. Log and
                # leave the orphan for the user to resolve via UI.
                log_warning(
                    f"[PostCommit] repo_scope {row['id']} path rewrite "
                    f"{old_path!r} → {new_path!r} rejected (likely UNIQUE "
                    f"conflict with existing scope): {e}"
                )
    except Exception as e:
        log_error(f"[PostCommit] move hook (repo_scopes) failed: {e}")


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

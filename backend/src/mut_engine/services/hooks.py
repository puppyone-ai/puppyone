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
import threading

from src.mut_engine.application.root_projection import (
    build_root_from_scope_state,
    graft_subtree,
)
from src.mut_engine.application.git_commit import build_git_commit, commit_tree_id
from src.mut_engine.application.git_object_format import decode_tree
from src.mut_engine.application.path_utils import normalize_path
from src.mut_engine.adapters.git.view_projection import git_compatible_head_commit
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


def run_post_project_update_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
    *,
    raise_errors: bool = False,
) -> None:
    """Finalize a product-root transaction.

    Product API writes already CAS-updated ``projects.mut_root_hash``.
    The hook therefore does not rebuild the project root from child
    scopes. Instead it derives child-scope refs from the accepted root
    so scoped Git/AP clients see the new product state without creating
    extra user-visible commits.
    """

    status = push_result.get("status", "")
    if status not in _SUCCESS_STATUSES:
        return

    commit_id = push_result.get("commit_id") or push_result.get("new_commit_id") or ""
    root_hash = push_result.get("root", "")
    if not commit_id or not root_hash:
        return

    try:
        repo = repo_manager.get_server_repo(project_id)
        entry = repo.history.get_entry(commit_id)
        if not entry:
            return

        _sync_child_scope_refs_from_project_root(
            repo=repo,
            project_root_hash=root_hash,
            source_commit_id=commit_id,
            created_at_iso=entry.get("created_at") or entry.get("time") or "",
        )

        try:
            _record_project_view_index(
                repo=repo,
                entry=entry,
                scope_path="",
                scope_hash=root_hash,
                project_root_hash=root_hash,
                source_commit_id=commit_id,
            )
        except Exception as exc:
            log_warning(
                f"[PostCommit] project-root version index update failed "
                f"for commit {commit_id[:12]}: {exc}",
            )

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

        _broadcast_commit_update(project_id, entry, changes)

    except Exception as e:
        log_error(
            f"[PostCommit] project-root hook failed for project {project_id}: {e}"
        )
        if raise_errors:
            raise


def schedule_post_push_hook(project_id: str, repo_manager, push_result: dict) -> None:
    """Run post-commit projection work off the user request path.

    The accepted scope commit/head/history/audit have already been published
    atomically. Project-root grafts and Git project-view commits are derived
    projections, so AP-FS and Git pushes should not wait on their S3/DB round
    trips. The durable outbox remains the repair path if this best-effort
    background execution fails or the process exits before it completes.
    """

    _schedule_post_commit_hook(
        project_id,
        repo_manager,
        push_result,
        run_post_push_hook,
        label="scope projection",
    )


def schedule_post_project_update_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
) -> None:
    """Run product-root derived work off the user request path."""

    _schedule_post_commit_hook(
        project_id,
        repo_manager,
        push_result,
        run_post_project_update_hook,
        label="project-root projection",
    )


def _schedule_post_commit_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
    hook_fn,
    *,
    label: str,
) -> None:
    commit_id = push_result.get("commit_id") or push_result.get("new_commit_id") or ""
    if not commit_id:
        return

    def _run() -> None:
        try:
            hook_fn(
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
                f"[PostCommit] async {label} failed for project "
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
    """Rebuild ``projects.mut_root_hash`` from DB-authoritative scope state.

    Architecture: "DB-Authoritative Registry + Materialized Root"
    (see ``docs/design/mut-scope-concurrency.md`` and
    ``mut-bug-checklist.md`` P0-5).

    Why we don't read the previous root tree from S3:
        The old graft path read ``projects.mut_root_hash`` → fetched the
        corresponding tree from S3 → spliced in the pushed scope → wrote
        a new root tree → CAS. That made S3 *both* the SoT and the input
        for deriving the next SoT. Any silent partial read inside the
        graft (e.g. ``_safe_flatten`` returning ``{}`` on a transient S3
        error) produced a structurally valid but data-losing root which
        CAS happily accepted.

    What we do instead:
        ``mut_scope_state`` is already the SoT for "where does each
        scope point right now". We:
          1. SELECT every scope's current hash from DB (cheap, ~1 ms).
          2. Patch in the freshly pushed scope's hash.
          3. Start from the root scope's tree (which carries any
             non-scope files like a top-level README.md) or an empty
             tree if root scope has never been pushed.
          4. Overlay each non-root scope by path-length order so
             parents land before children.
          5. CAS-update ``projects.mut_root_hash``.

    Concurrent pushes are naturally idempotent: any attempt that reads
    the latest DB snapshot produces the same new root, so CAS retries
    converge on the canonical state.

    Failure mode: any S3 read/write raises; the retry loop handles
    transients, then ``log_error`` flags persistent issues. We do NOT
    silently fall back to an empty/partial tree — that's the entire
    bug class we're closing.
    """
    scope_hash = push_result.get("root", "")
    if not scope_hash:
        return

    commit_id = push_result["commit_id"]
    entry = repo.history.get_entry(commit_id)
    if not entry:
        log_error(f"[PostCommit] No history entry for commit {commit_id}")
        return

    scope_path = (entry.get("scope_path") or "").strip("/")

    MAX_GRAFT_RETRIES = 5
    for attempt in range(MAX_GRAFT_RETRIES):
        try:
            # After a CAS failure the DB holds a newer root_hash than our
            # cached copy. Clear the in-process cache so the next
            # get_root_hash() reads the current DB value as the CAS pre-image
            # instead of looping with the same stale value forever.
            if attempt > 0:
                history = getattr(repo, 'history', None) or repo
                if hasattr(history, '_root_hash_cache'):
                    del history._root_hash_cache

            # Some test doubles expose only the history backend methods.
            # Fall back to history-based lookup for that compatibility path.
            if hasattr(repo, "get_root_hash"):
                db_root = repo.get_root_hash() or ""
            else:
                db_root = repo.history.get_root_hash() if hasattr(repo.history, "get_root_hash") else ""

            new_root = _build_root_from_scope_state(
                repo, scope_path, scope_hash,
            )

            if hasattr(repo, "cas_update_root_hash"):
                success = repo.cas_update_root_hash(db_root, new_root)
            else:
                # Fallback: direct set (no CAS protection, but better than failing)
                repo.history.set_root_hash(new_root)
                success = True

            if success:
                try:
                    _record_project_view_index(
                        repo=repo,
                        entry=entry,
                        scope_path=scope_path,
                        scope_hash=scope_hash,
                        project_root_hash=new_root,
                        source_commit_id=commit_id,
                    )
                except Exception as exc:
                    log_warning(
                        f"[PostCommit] project-view Git index update failed "
                        f"for commit {commit_id[:12]}: {exc}",
                    )
                log_info(
                    f"[PostCommit] Rebuilt global root from DB state: "
                    f"scope='{scope_path}' root={new_root[:16]} "
                    f"(attempt {attempt + 1})"
                )
                return

            log_info(
                f"[PostCommit] Root CAS lost — retrying "
                f"(attempt {attempt + 1}, scope='{scope_path}')"
            )

        except Exception as e:
            log_warning(
                f"[PostCommit] Graft attempt {attempt + 1} failed "
                f"(will retry): {e}"
            )
            continue

    log_error(
        f"[PostCommit] Graft failed after {MAX_GRAFT_RETRIES} retries "
        f"for scope='{scope_path}' — root_hash may lag behind scope state. "
        f"Investigate S3 / DB connectivity."
    )


def _record_project_view_index(
    *,
    repo,
    entry: dict,
    scope_path: str,
    scope_hash: str,
    project_root_hash: str,
    source_commit_id: str,
) -> None:
    """Persist the Git-visible project history graft for one scope commit."""

    if not hasattr(repo, "record_version_index"):
        return
    try:
        source_tree = commit_tree_id(repo, source_commit_id)
    except Exception:
        source_tree = ""

    if source_tree == project_root_hash:
        project_view_commit_id = source_commit_id
    else:
        parent = ""
        if hasattr(repo, "get_latest_project_view_commit_id"):
            parent = repo.get_latest_project_view_commit_id() or ""
        parent = git_compatible_head_commit(repo, parent) if parent else ""
        created_at = entry.get("created_at") or entry.get("time") or ""
        project_view_commit_id = build_git_commit(
            repo,
            tree_sha=project_root_hash,
            parent_sha=parent,
            who="puppyone-project-view",
            message=f"Puppyone project view for {source_commit_id}",
            created_at_iso=created_at,
            validate_parent_graph=False,
        )

    repo.record_version_index(
        scope_path=scope_path,
        source_commit_id=source_commit_id,
        source_scope_hash=scope_hash,
        project_root_hash=project_root_hash,
        project_view_commit_id=project_view_commit_id,
    )


def _sync_child_scope_refs_from_project_root(
    *,
    repo,
    project_root_hash: str,
    source_commit_id: str,
    created_at_iso: str,
) -> None:
    """Derive scoped access-point refs from an accepted project root."""

    scopes = []
    try:
        scopes = repo.scopes.list_all()
    except Exception as exc:
        log_warning(f"[PostCommit] could not list repo scopes for root sync: {exc}")
        return

    for scope in scopes:
        scope_path = normalize_path(scope.get("path", ""))
        if not scope_path:
            continue

        subtree_hash = _tree_hash_at_path(repo.store, project_root_hash, scope_path)
        current_hash, current_head = ("", "")
        try:
            current_hash, current_head = repo.get_scope_state(scope_path)
        except Exception:
            try:
                current_hash = repo.get_scope_hash(scope_path)
                current_head = repo.get_scope_head_commit_id(scope_path)
            except Exception:
                pass

        if not subtree_hash:
            if current_hash or current_head:
                _set_scope_state(repo, scope_path, "", "")
                log_info(
                    f"[PostCommit] cleared child scope {scope_path!r} after "
                    f"project-root commit {source_commit_id[:12]}"
                )
            continue

        if current_hash == subtree_hash:
            continue

        parent = ""
        if current_head:
            try:
                parent = git_compatible_head_commit(repo, current_head)
            except Exception:
                parent = ""
        scope_commit_id = build_git_commit(
            repo,
            tree_sha=subtree_hash,
            parent_sha=parent,
            who="puppyone-scope-view",
            message=f"Puppyone scope view for {source_commit_id}",
            created_at_iso=created_at_iso,
            validate_parent_graph=False,
        )
        _set_scope_state(repo, scope_path, subtree_hash, scope_commit_id)
        log_info(
            f"[PostCommit] synced child scope {scope_path!r} from "
            f"project-root commit {source_commit_id[:12]}"
        )


def _set_scope_state(repo, scope_path: str, scope_hash: str, head_commit_id: str) -> None:
    history = getattr(repo, "history", repo)
    history.set_scope_hash(scope_path, scope_hash)
    history.set_scope_head_commit_id(scope_path, head_commit_id)


def _tree_hash_at_path(store, root_hash: str, path: str) -> str:
    if not root_hash:
        return ""
    current = root_hash
    for part in [p for p in normalize_path(path).split("/") if p]:
        try:
            obj_type, body = store.get_object(current)
        except Exception:
            return ""
        if obj_type != "tree":
            return ""
        match = next((entry for entry in decode_tree(body) if entry.name == part), None)
        if match is None or not match.is_dir:
            return ""
        current = match.sha1_hex
    return current


def _build_root_from_scope_state(
    repo,
    just_pushed_scope: str,
    just_pushed_hash: str,
) -> str:
    """Build a complete root tree from DB scope state + the just-pushed hash.

    Steps:
        1. Read all ``(scope_path → scope_hash)`` from
           ``mut_scope_state`` (DB SoT).
        2. Overwrite the just-pushed scope's entry with the accepted
           transaction result. The publish boundary has already written it;
           the explicit override exists so retries see a consistent input
           even if a sibling's CAS races between our SELECT and our build.
        3. Use the root scope's tree as the base — it carries any
           non-scope files (e.g. a top-level README.md). If root scope
           has never been pushed, start from the empty git tree.
        4. Overlay each non-root scope using :func:`_graft_subtree` (a
           local reimplementation; ``mut.server.graft`` was removed in
           the feat/git-format-storage refactor since the upstream
           server no longer needs scope-grafting). Sort by path depth
           so parents are grafted before children.

    Raises on S3 read/write failure (no silent fallback). Callers
    decide whether to retry.
    """
    return build_root_from_scope_state(repo, just_pushed_scope, just_pushed_hash)


# ── Local graft helpers (replaces removed mut.server.graft) ───────

def _graft_subtree(store, old_root_hash: str,
                   scope_path: str, new_subtree_hash: str) -> str:
    """Replace the subtree at *scope_path* under *old_root_hash* with
    *new_subtree_hash*, recomputing parent trees upward.

    Pure git tree manipulation against the new ObjectStore API
    (``put_tree`` / ``get_object`` / ``encode_tree`` / ``decode_tree``).
    Mirrors the removed ``mut/server/graft.py`` implementation but with
    no PuppyOne-specific logic so it stays trivially reviewable.
    """
    return graft_subtree(store, old_root_hash, scope_path, new_subtree_hash)


def post_commit_delete(project_id: str, deleted_paths: list[str]) -> None:
    """After deleting paths from MUT tree, clean up dangling access points
    AND repo_scopes (the new home for scope geometry).

    Both legacy access_points rows and new repo_scopes rows are visited;
    each table's cleanup is independently best-effort so a failure on
    one doesn't skip the other. Once access_points is dropped post-data-
    migration, the legacy block runs and finds nothing — no-op.
    """
    if not deleted_paths:
        return
    _post_commit_delete_legacy_access_points(project_id, deleted_paths)
    _post_commit_delete_repo_scopes(project_id, deleted_paths)


def _post_commit_delete_legacy_access_points(
    project_id: str, deleted_paths: list[str],
) -> None:
    """Legacy: nullify path / orphan scope on access_points rows."""
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
        log_error(f"[PostCommit] delete hook (access_points) failed: {e}")


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
    """After moving/renaming paths in MUT tree, update access point AND
    repo_scopes references.

    Both updates are best-effort + independent."""
    _post_commit_move_legacy_access_points(project_id, old_prefix, new_prefix)
    _post_commit_move_repo_scopes(project_id, old_prefix, new_prefix)


def _post_commit_move_legacy_access_points(
    project_id: str, old_prefix: str, new_prefix: str,
) -> None:
    """Legacy: rewrite access_points.path / config.scope.path on rename."""
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
        log_error(f"[PostCommit] move hook (access_points) failed: {e}")


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

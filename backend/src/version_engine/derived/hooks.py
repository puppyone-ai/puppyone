"""
Post-commit hooks — keep ``repo_scopes`` consistent with tree mutations.

When files/folders are deleted or moved in a PuppyOne project, scopes
that referenced those paths need to follow the change (rename) or get
surfaced as orphaned (delete). Both hooks are best-effort: failures
log and don't propagate.

Also provides ``push_and_finalize`` for in-process agent/sandbox working
copies that need a clone/edit/write-back lifecycle.
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from contextvars import Context
import threading

from src.version_engine.derived.projection import (
    record_project_view_index_for_commit,
    rebuild_project_root_after_commit,
)
from src.version_engine.write_engine.git_commit import (
    build_git_commit,
    shallow_git_parent_or_empty,
)
from src.version_engine.write_engine.git_object_format import decode_commit, decode_tree
from src.version_engine.write_engine.path_utils import normalize_path
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
    """Push changes via InProcessVersionClient and run the post-push hook.

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
            from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container
            repo_manager = build_worker_version_engine_container().repo_manager
        try:
            await asyncio.to_thread(
                run_post_push_hook, project_id, repo_manager, result,
            )
        except Exception as e:
            log_warning(f"[PostCommit] hook failed after push: {e}")

    return result


_SUCCESS_STATUSES = frozenset({"ok", "rolled-back"})
_SCOPE_SYNC_RETRIES = 5
_PROJECTION_LOCK_REGISTRY: dict[tuple[str, str], threading.RLock] = {}
_PROJECTION_LOCK_REGISTRY_LOCK = threading.Lock()


@contextmanager
def _projection_locks(project_id: str, scope_paths: set[str]):
    """Order derived root/scope projection updates inside one process."""

    normalized = {
        normalize_path(scope_path)
        for scope_path in scope_paths
    }
    if not normalized:
        normalized = {""}
    ordered = sorted(normalized, key=lambda p: (p.count("/"), p))
    locks = [_projection_lock_for(project_id, scope_path) for scope_path in ordered]
    for lock in locks:
        lock.acquire()
    try:
        yield
    finally:
        for lock in reversed(locks):
            lock.release()


def _projection_lock_for(project_id: str, scope_path: str) -> threading.RLock:
    key = (project_id, normalize_path(scope_path))
    with _PROJECTION_LOCK_REGISTRY_LOCK:
        lock = _PROJECTION_LOCK_REGISTRY.get(key)
        if lock is None:
            lock = threading.RLock()
            _PROJECTION_LOCK_REGISTRY[key] = lock
        return lock


def run_post_push_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
    *,
    raise_errors: bool = False,
) -> None:
    """Inspect a push/rollback result and trigger relevant post-commit hooks.

    Called by in-process write-back helpers after a successful publish.
    Accepts both formats:
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

        with _projection_locks(project_id, {"", scope_path}):
            _update_global_root(repo, result_for_graft)

            if deleted_paths:
                post_commit_delete(project_id, deleted_paths)

            # Child-promotes-parent (07-version-engine-supplement.md §7.B).
            # The promote step is best-effort: each ancestor's CAS happens
            # independently, so a stale ancestor head triggers a retry but
            # cannot block the just-landed child commit.
            _promote_to_ancestor_scopes(repo, project_id, entry, scope_path)

            # Parent-commit triggers child re-graft: when a non-promote
            # commit lands on a scope that has declared children, re-apply
            # each child's current tree on top of the parent's new tree.
            # Without this, a parent edit (delete / rename / overwrite) at
            # a child-territory path would persist in the parent's view
            # until the child happens to commit again. V1 spec §7 says
            # child-owned paths re-surface via graft; this is what makes
            # that actually happen.
            _regraft_children_into_committed_scope(
                repo, project_id, entry, scope_path,
            )

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
        from src.version_engine.derived.path_index import (
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


def _regraft_children_into_committed_scope(
    repo, project_id: str, entry: dict, scope_path: str,
) -> None:
    """After a non-promote commit on ``scope_path``, re-graft each
    declared child scope (immediate descendants only) back into the
    committed scope's view. Bounded so it never triggers itself:

      * scope-promote commits skip via the message-trailer check
      * each child re-graft is a one-hop call into ``promote_to_parents``
        for THIS scope only — the descendant's own ancestors above us
        are skipped via ``ancestor_filter``.
    """

    message = entry.get("message", "") or ""
    if "PuppyOne-Source: scope-promote" in message:
        return

    try:
        from src.version_engine.derived.parent_scope_promote import (
            promote_to_one_parent,
        )
        from src.version_engine.write_engine.path_utils import normalize_path
    except Exception as exc:
        log_warning(f"[PostCommit] re-graft import failed: {exc}")
        return

    parent_norm = normalize_path(scope_path)
    try:
        declared = repo.get_declared_scope_paths()
    except Exception:
        return

    # Immediate children: declared scopes whose first ancestor under
    # ``declared`` is ``parent_norm``. We compare against the declared
    # set so an intermediate non-declared path doesn't accidentally
    # block recognition (e.g. ``foo/bar/leaf`` with only ``foo`` and
    # ``foo/bar/leaf`` declared is still an "immediate" child of foo).
    children: list[str] = []
    for d in declared:
        d_norm = normalize_path(d)
        if not d_norm:
            continue
        if parent_norm and not d_norm.startswith(parent_norm + "/"):
            continue
        if parent_norm == d_norm:
            continue
        # Walk up from d to see if parent_norm is the nearest declared
        # ancestor.
        nearest = ""
        parts = d_norm.split("/")
        for i in range(len(parts) - 1, 0, -1):
            anc = "/".join(parts[:i])
            if anc in declared and anc != d_norm:
                nearest = anc
                break
        if nearest == parent_norm:
            children.append(d_norm)

    if not children:
        return

    actor = f"system:regraft-after-{entry.get('who') or 'commit'}"
    created_at_iso = entry.get("created_at", "") or ""

    for child in children:
        try:
            scope_hash, head_commit = repo.get_scope_state(child)
        except Exception:
            continue
        if not scope_hash or not head_commit:
            continue
        try:
            promote_to_one_parent(
                repo,
                project_id=project_id,
                parent_scope_path=parent_norm,
                child_scope_path=child,
                child_new_tree_hash=scope_hash,
                child_commit_actor=actor,
                child_commit_id=head_commit,
                created_at_iso=created_at_iso,
                trailer_extra="PuppyOne-Regraft: post-parent-commit\n",
            )
        except Exception as exc:
            log_warning(
                f"[PostCommit] re-graft of child {child!r} into "
                f"{parent_norm or '/'} failed: {exc}",
            )


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
        from src.version_engine.derived.parent_scope_promote import promote_to_parents
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


def run_post_project_update_hook(
    project_id: str,
    repo_manager,
    push_result: dict,
    *,
    raise_errors: bool = False,
) -> None:
    """Finalize a product-root transaction.

    Product API writes already CAS-updated the materialized project root.
    The hook therefore does not rebuild the project root from child
    scopes. Instead it derives child-scope refs from the accepted root
    so scoped Git/AP clients see the new product state without creating
    extra user-visible commits.
    """

    try:
        repo, entry, commit_id, root_hash, changes = _project_root_hook_context(
            project_id, repo_manager, push_result,
        )
        if not entry:
            return

        run_project_root_visibility_barrier(
            project_id, repo_manager, push_result, raise_errors=raise_errors,
        )

        try:
            record_project_view_index_for_commit(
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


def run_project_root_visibility_barrier(
    project_id: str,
    repo_manager,
    push_result: dict,
    *,
    raise_errors: bool = False,
) -> None:
    """Synchronously expose a product-root commit to affected scope remotes.

    This is the small read-your-write barrier kept on the request path until
    project-root publish can atomically update affected scope refs inside the
    SQL transaction. Heavy/repairable derived work stays in
    ``run_post_project_update_hook`` and the durable outbox path.
    """

    try:
        repo, entry, commit_id, root_hash, changes = _project_root_hook_context(
            project_id, repo_manager, push_result,
        )
        if not entry:
            return
        changed_paths = [
            normalize_path(c.get("path", ""))
            for c in changes
            if isinstance(c, dict) and c.get("path")
        ]
        affected_scopes = _project_root_affected_scopes(repo, changed_paths)
        with _projection_locks(
            project_id,
            {
                "",
                *{
                    normalize_path(scope.get("path", ""))
                    for scope in affected_scopes
                    if normalize_path(scope.get("path", ""))
                },
            },
        ):
            current_project_root = _current_project_root_hash(repo)
            stale_project_root = False
            if (
                current_project_root
                and root_hash
                and current_project_root != root_hash
            ):
                stale_project_root = True
                log_info(
                    f"[PostCommit] applying stale project-root delta "
                    f"for commit {commit_id[:12]}"
                )
            _sync_child_scope_refs_from_project_root(
                repo=repo,
                previous_project_root_hash=(
                    push_result.get("old_root", "")
                    or _previous_project_root_hash(repo, entry)
                ),
                project_root_hash=root_hash,
                source_commit_id=commit_id,
                created_at_iso=entry.get("created_at") or entry.get("time") or "",
                changed_paths=changed_paths,
                scopes=affected_scopes,
                stale_project_root=stale_project_root,
            )
    except Exception as e:
        log_error(
            f"[PostCommit] project-root visibility barrier failed "
            f"for project {project_id}: {e}"
        )
        if raise_errors:
            raise


def _project_root_hook_context(project_id: str, repo_manager, push_result: dict):
    status = push_result.get("status", "")
    if status not in _SUCCESS_STATUSES:
        return None, None, "", "", []

    commit_id = push_result.get("commit_id") or push_result.get("new_commit_id") or ""
    root_hash = push_result.get("root", "")
    if not commit_id or not root_hash:
        return None, None, "", "", []

    repo = repo_manager.get_server_repo(project_id)
    entry = repo.history.get_entry(commit_id)
    if not entry:
        return repo, None, commit_id, root_hash, []

    changes = entry.get("changes", [])
    if isinstance(changes, str):
        import json
        changes = json.loads(changes)
    return repo, entry, commit_id, root_hash, changes


def _project_root_affected_scope_paths(repo, changed_paths: list[str]) -> set[str]:
    return {
        normalize_path(scope.get("path", ""))
        for scope in _project_root_affected_scopes(repo, changed_paths)
        if normalize_path(scope.get("path", ""))
    }


def _project_root_affected_scopes(repo, changed_paths: list[str]) -> list[dict]:
    try:
        scopes = repo.scopes.list_all()
    except Exception:
        return []
    affected: list[dict] = []
    for scope in scopes:
        scope_path = normalize_path(scope.get("path", ""))
        if not scope_path:
            continue
        if changed_paths and not _scope_intersects_paths(scope_path, changed_paths):
            continue
        affected.append(scope)
    return affected


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
                from src.version_engine.derived.outbox import (
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
        loop.create_task(asyncio.to_thread(_run), context=Context())
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
        from src.version_engine.derived.notifications import NotificationManager
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


def _sync_child_scope_refs_from_project_root(
    *,
    repo,
    previous_project_root_hash: str = "",
    project_root_hash: str,
    source_commit_id: str,
    created_at_iso: str,
    changed_paths: list[str] | None = None,
    scopes: list[dict] | None = None,
    stale_project_root: bool = False,
) -> None:
    """Derive scoped access-point refs from an accepted project root."""

    if scopes is None:
        try:
            scopes = repo.scopes.list_all()
        except Exception as exc:
            log_warning(f"[PostCommit] could not list repo scopes for root sync: {exc}")
            return

    for scope in scopes:
        scope_path = normalize_path(scope.get("path", ""))
        if not scope_path:
            continue
        if changed_paths is not None and not _scope_intersects_paths(
            scope_path,
            changed_paths,
        ):
            continue

        for attempt in range(_SCOPE_SYNC_RETRIES):
            current_hash, current_head = _scope_state(repo, scope_path)
            target_hash = _merge_project_root_delta_into_child_scope(
                repo=repo,
                scope_path=scope_path,
                previous_project_root_hash=previous_project_root_hash,
                project_root_hash=project_root_hash,
                current_scope_hash=current_hash,
                changed_paths=changed_paths or [],
                stale_project_root=stale_project_root,
            )

            if current_hash == target_hash:
                break

            if not target_hash:
                if _cas_or_set_scope_state(repo, scope_path, current_hash, "", ""):
                    log_info(
                        f"[PostCommit] cleared child scope {scope_path!r} after "
                        f"project-root commit {source_commit_id[:12]}"
                    )
                    break
            else:
                parent = shallow_git_parent_or_empty(repo, current_head) if current_head else ""
                scope_commit_id = build_git_commit(
                    repo,
                    tree_sha=target_hash,
                    parent_sha=parent,
                    who="puppyone-scope-view",
                    message=f"Puppyone scope view for {source_commit_id}",
                    created_at_iso=created_at_iso,
                    validate_parent_graph=False,
                )
                if _cas_or_set_scope_state(
                    repo, scope_path, current_hash, target_hash, scope_commit_id,
                ):
                    log_info(
                        f"[PostCommit] synced child scope {scope_path!r} from "
                        f"project-root commit {source_commit_id[:12]}"
                    )
                    break

            if attempt == _SCOPE_SYNC_RETRIES - 1:
                log_warning(
                    f"[PostCommit] skipped stale child-scope sync for "
                    f"{scope_path!r} from project-root commit "
                    f"{source_commit_id[:12]}"
                )


def _scope_state(repo, scope_path: str) -> tuple[str, str]:
    try:
        return repo.get_scope_state(scope_path)
    except Exception:
        pass
    try:
        return (
            repo.get_scope_hash(scope_path),
            repo.get_scope_head_commit_id(scope_path),
        )
    except Exception:
        return "", ""


def _current_project_root_hash(repo) -> str:
    try:
        return repo.get_root_hash() or ""
    except Exception:
        pass
    try:
        return repo.history.get_root_hash() or ""
    except Exception:
        return ""


def _previous_project_root_hash(repo, entry: dict) -> str:
    commit_id = entry.get("commit_id") or ""
    if not commit_id:
        return ""
    try:
        obj_type, body = repo.store.get_object(commit_id)
        if obj_type != "commit":
            return ""
        info = decode_commit(body)
        parents = info.get("parents") or []
        if not parents:
            return ""
        parent_type, parent_body = repo.store.get_object(parents[0])
        if parent_type != "commit":
            return ""
        parent_info = decode_commit(parent_body)
        return parent_info.get("tree", "") or ""
    except Exception:
        return ""


def _merge_project_root_delta_into_child_scope(
    *,
    repo,
    scope_path: str,
    previous_project_root_hash: str,
    project_root_hash: str,
    current_scope_hash: str,
    changed_paths: list[str],
    stale_project_root: bool = False,
) -> str:
    """Apply the project-root delta to one child scope without losing child edits.

    Product/root writes are parent-authoritative: when root and a child scope
    touch the same relative path, the root version wins. Independent child
    paths are preserved so concurrent Git pushes and frontend saves converge
    instead of clobbering each other.
    """

    new_subtree_hash = _tree_hash_at_path(repo.store, project_root_hash, scope_path)
    if (
        not stale_project_root
        and _project_root_replaces_scope(scope_path, changed_paths)
    ):
        return new_subtree_hash

    from src.version_engine.write_engine.tree_objects import (
        build_tree_from_files,
        flatten_tree_to_bytes,
    )

    old_subtree_hash = _tree_hash_at_path(
        repo.store,
        previous_project_root_hash,
        scope_path,
    ) if previous_project_root_hash else ""
    old_files = flatten_tree_to_bytes(repo.store, old_subtree_hash)
    new_files = flatten_tree_to_bytes(repo.store, new_subtree_hash)
    current_files = flatten_tree_to_bytes(repo.store, current_scope_hash)

    merged_files = dict(current_files)
    for rel_path in set(old_files) | set(new_files):
        before = old_files.get(rel_path)
        after = new_files.get(rel_path)
        if before == after:
            continue
        if stale_project_root and current_files.get(rel_path) != before:
            continue
        if after is None:
            merged_files.pop(rel_path, None)
        else:
            merged_files[rel_path] = after

    return build_tree_from_files(repo.store, merged_files) if merged_files else ""


def _set_scope_state(repo, scope_path: str, scope_hash: str, head_commit_id: str) -> None:
    history = getattr(repo, "history", repo)
    history.set_scope_hash(scope_path, scope_hash)
    history.set_scope_head_commit_id(scope_path, head_commit_id)


def _cas_or_set_scope_state(
    repo,
    scope_path: str,
    old_scope_hash: str,
    new_scope_hash: str,
    head_commit_id: str,
) -> bool:
    """CAS child-scope projection writes when the repo supports it.

    Project-root commits derive child scope refs as a projection. A stale
    projection must never overwrite a newer scoped Git/AP head, so production
    repositories use the same scope CAS primitive as user writes. Tiny test
    doubles that predate the CAS facade fall back to direct assignment.
    """

    cas = getattr(repo, "cas_update_scope", None)
    if callable(cas):
        updated = bool(cas(
            scope_path,
            old_scope_hash or "",
            new_scope_hash or "",
            head_commit_id or "",
        ))
        if updated and not new_scope_hash and not head_commit_id:
            try:
                repo.set_scope_head_commit_id(scope_path, "")
            except Exception:
                pass
        return updated
    _set_scope_state(repo, scope_path, new_scope_hash, head_commit_id)
    return True


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


def _scope_intersects_paths(scope_path: str, changed_paths: list[str]) -> bool:
    """Return true when a root-level change can affect a child scope."""

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return True
    for changed in changed_paths:
        changed_norm = normalize_path(changed)
        if not changed_norm:
            return True
        if changed_norm == scope_norm:
            return True
        if changed_norm.startswith(scope_norm + "/"):
            return True
        if scope_norm.startswith(changed_norm + "/"):
            return True
    return False


def _project_root_replaces_scope(scope_path: str, changed_paths: list[str]) -> bool:
    """Return true when the root operation replaced/deleted the scope boundary."""

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return True
    for changed in changed_paths:
        changed_norm = normalize_path(changed)
        if not changed_norm:
            return True
        if changed_norm == scope_norm:
            return True
        if scope_norm.startswith(changed_norm + "/"):
            return True
    return False


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
    """Rewrite repo_scopes.path on folder rename."""
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

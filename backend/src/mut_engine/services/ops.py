"""
MutOps — Unified entry point for MUT tree operations.

All channels (Web UI / Agent / Sandbox / MCP / Datasource / Ingest / Table / Seed)
operate on the MUT tree through this class. Channels do not directly touch
MutEphemeralClient or MutTreeReader.

Write operations: clone → modify → push (via MutEphemeralClient)
Read operations: direct Merkle tree reads (via MutTreeReader)

Usage:
    ops = MutOps(repo_manager)
    result = await ops.write_file("proj_1", "readme.md", b"# Hi", who="user:123")
    content = ops.read_file("proj_1", "readme.md")
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.validation import validate_path
from src.mut_engine.services.ephemeral_client import MutEphemeralClient
from src.mut_engine.services.tree_reader import MutEntry, MutTreeReader


@dataclass
class WriteResult:
    commit_id: str = ""
    status: str = "ok"
    merged: bool = False
    conflicts: int = 0
    paths: list[str] = field(default_factory=list)


class MutOps:
    """Unified entry point for MUT tree operations."""

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager
        self._reader = MutTreeReader(repo_manager)

    # ══════════════════════════════════════════════
    # Write operations (async — all go through clone → push)
    # ══════════════════════════════════════════════

    async def write_file(
        self,
        project_id: str,
        path: str,
        content: bytes,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Write a single file.

        When ``scope`` is empty, routes the write to the narrowest
        existing MUT scope that contains ``path``. This is critical
        for cross-scope visibility: a file written into the root
        scope at a path that belongs to a sub-scope gets shadowed
        by the sub-scope's tree during graft (``graft_subtree``
        replaces the root tree's subtree wholesale), so the file
        becomes invisible to the read path even though the commit
        landed. Routing to the narrowest scope makes the write the
        canonical source for that subtree, so graft preserves it.
        """
        path = validate_path(path)
        target_scope, rel_path = self._resolve_write_target(
            project_id, path, scope,
        )
        return await self._do_push(
            project_id, who, target_scope,
            modified={rel_path: content},
            message=message or f"write {path}",
        )

    async def delete(
        self,
        project_id: str,
        paths: list[str],
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Delete one or more files.

        Each path is independently routed to the narrowest scope
        that contains it. Mixing paths from different scopes in a
        single call requires per-scope grouping, so this batches
        by scope and pushes each group separately. The result
        reports the FIRST commit; in practice all paths usually
        share one scope and there's only one push.
        """
        clean = [validate_path(p) for p in paths]
        if scope:
            return await self._do_push(
                project_id, who, scope,
                deleted=clean,
                message=message or f"delete {len(clean)} files",
            )

        groups = self._group_paths_by_scope(project_id, clean)
        first_result: WriteResult | None = None
        for target_scope, rel_paths in groups.items():
            r = await self._do_push(
                project_id, who, target_scope,
                deleted=rel_paths,
                message=message or f"delete {len(rel_paths)} files",
            )
            first_result = first_result or r
        return first_result or WriteResult(paths=clean)

    async def mkdir(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Create a directory (writes a .keep placeholder).

        Same scope-routing logic as ``write_file``: a ``mkdir`` at a
        path that lives inside a sub-scope must target THAT scope,
        otherwise the .keep marker writes into root and graft hides
        it under the sub-scope's tree.
        """
        path = validate_path(path)
        keep_full = f"{path}/.keep"
        target_scope, rel_keep = self._resolve_write_target(
            project_id, keep_full, scope,
        )
        return await self._do_push(
            project_id, who, target_scope,
            modified={rel_keep: b""},
            message=message or f"mkdir {path}",
        )

    async def move(
        self,
        project_id: str,
        old_path: str,
        new_path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Move / rename a file or folder."""
        old_path = validate_path(old_path)
        new_path = validate_path(new_path)

        client = self._make_client(project_id, who, scope)
        files = await asyncio.to_thread(client.clone)

        modified: dict[str, bytes] = {}
        deleted: list[str] = []

        entry = self._reader.stat(project_id, old_path)
        if not entry:
            raise FileNotFoundError(f"Path not found: {old_path}")

        if entry.type == "folder":
            prefix = old_path + "/"
            for p, content in files.items():
                if p == old_path or p.startswith(prefix):
                    suffix = p[len(old_path):]
                    modified[new_path + suffix] = content
                    deleted.append(p)
        else:
            content = files.get(old_path)
            if content is None:
                raise FileNotFoundError(f"File not found: {old_path}")
            modified[new_path] = content
            deleted.append(old_path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=message or f"move {old_path} → {new_path}",
        )
        await asyncio.to_thread(self._run_post_push_hook, project_id, result)
        try:
            from src.mut_engine.services.hooks import post_commit_move
            post_commit_move(project_id, old_path, new_path)
        except Exception as e:
            from src.utils.logger import log_error
            log_error(f"[MutOps] post-commit move hook failed for project={project_id}: {e}")
        return self._to_result(result, list(modified.keys()) + deleted)

    async def bulk_write(
        self,
        project_id: str,
        files: dict[str, bytes],
        who: str,
        scope: str = "",
        deleted: list[str] | None = None,
        message: str = "",
    ) -> WriteResult:
        """Batch write + optional batch delete.

        When ``scope`` is empty, paths are grouped by the narrowest
        scope that contains each one and pushed per scope. See
        ``write_file`` for the why — writes to a sub-scope path via
        the root scope are silently shadowed during graft, so
        they're invisible to the read path even though they
        committed.
        """
        clean = {validate_path(k): v for k, v in files.items()}
        clean_del = [validate_path(p) for p in (deleted or [])]
        if scope:
            return await self._do_push(
                project_id, who, scope,
                modified=clean,
                deleted=clean_del,
                message=message or f"bulk write {len(clean)} files",
            )

        write_groups = self._group_paths_by_scope(project_id, list(clean.keys()))
        del_groups = self._group_paths_by_scope(project_id, clean_del)
        all_scopes = set(write_groups.keys()) | set(del_groups.keys())
        first_result: WriteResult | None = None
        for target_scope in all_scopes:
            mods = {
                rel: clean[self._join_scope_path(target_scope, rel)]
                for rel in write_groups.get(target_scope, [])
            }
            dels = del_groups.get(target_scope, [])
            r = await self._do_push(
                project_id, who, target_scope,
                modified=mods,
                deleted=dels,
                message=message or f"bulk write {len(mods)} files",
            )
            first_result = first_result or r
        return first_result or WriteResult(paths=list(clean.keys()) + clean_del)

    async def trash(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Soft-delete: move to .trash/{basename}_{timestamp}."""
        path = validate_path(path)
        basename = path.rsplit("/", 1)[-1] if "/" in path else path
        scope_path, rel_path = self._select_write_scope(project_id, path)
        trash_rel_path = f".trash/{basename}_{int(time.time())}"
        trash_path = self._join_scope_path(scope_path, trash_rel_path)

        client = self._make_client(project_id, who, scope_path or scope)
        files = await asyncio.to_thread(client.clone)

        modified: dict[str, bytes] = {}
        deleted: list[str] = []

        entry = self._reader.stat(project_id, path)
        if entry and entry.type == "folder":
            prefix = rel_path + "/"
            for p, content in files.items():
                if p == rel_path or p.startswith(prefix):
                    suffix = p[len(rel_path):]
                    modified[trash_rel_path + suffix] = content
                    deleted.append(p)
        else:
            content = files.get(rel_path)
            if content is None:
                raise FileNotFoundError(f"Path not found: {path}")
            modified[trash_rel_path] = content
            deleted.append(rel_path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=message or f"trash {basename}",
        )
        await asyncio.to_thread(self._run_post_push_hook, project_id, result)
        return self._to_result(result, [path, trash_path])

    async def restore(
        self,
        project_id: str,
        trash_path: str,
        original_path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Restore from .trash back to original path."""
        trash_path = validate_path(trash_path)
        original_path = validate_path(original_path)

        client = self._make_client(project_id, who, scope)
        files = await asyncio.to_thread(client.clone)

        modified: dict[str, bytes] = {}
        deleted: list[str] = []

        entry = self._reader.stat(project_id, trash_path)
        if entry and entry.type == "folder":
            prefix = trash_path + "/"
            for p, content in files.items():
                if p == trash_path or p.startswith(prefix):
                    suffix = p[len(trash_path):]
                    modified[original_path + suffix] = content
                    deleted.append(p)
        else:
            content = files.get(trash_path)
            if content is None:
                raise FileNotFoundError(f"Trash item not found: {trash_path}")
            modified[original_path] = content
            deleted.append(trash_path)

        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=message or f"restore {original_path}",
        )
        await asyncio.to_thread(self._run_post_push_hook, project_id, result)
        return self._to_result(result, [original_path, trash_path])

    async def permanent_delete(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Hard-delete a file or folder (no trash)."""
        path = validate_path(path)
        scope_path, rel_path = self._select_write_scope(project_id, path)

        client = self._make_client(project_id, who, scope_path or scope)
        files = await asyncio.to_thread(client.clone)

        deleted: list[str] = []
        entry = self._reader.stat(project_id, path)
        if entry and entry.type == "folder":
            prefix = rel_path + "/"
            for p in files:
                if p == rel_path or p.startswith(prefix):
                    deleted.append(p)
        else:
            deleted.append(rel_path)

        result = await asyncio.to_thread(
            client.push,
            deleted=deleted,
            message=message or f"delete {path}",
        )
        await asyncio.to_thread(self._run_post_push_hook, project_id, result)
        return self._to_result(
            result,
            [self._join_scope_path(scope_path, p) for p in deleted],
        )

    # ══════════════════════════════════════════════
    # Read operations (sync — direct Merkle tree reads)
    # ══════════════════════════════════════════════

    def read_file(self, project_id: str, path: str) -> bytes:
        return self._reader.read_file(project_id, path.strip("/"))

    def list_dir(self, project_id: str, path: str = "") -> list[MutEntry]:
        return self._reader.list_dir(project_id, path.strip("/"))

    def list_tree(
        self, project_id: str, path: str = "", max_depth: int = -1
    ) -> list[MutEntry]:
        return self._reader.list_tree(project_id, path.strip("/"), max_depth=max_depth)

    def stat(self, project_id: str, path: str) -> MutEntry | None:
        return self._reader.stat(project_id, path.strip("/"))

    def get_head_commit_id(self, project_id: str) -> str:
        return self._reader.get_head_commit_id(project_id)

    def get_root_hash(self, project_id: str) -> str:
        return self._reader.get_root_hash(project_id)

    # ══════════════════════════════════════════════
    # Internal helpers
    # ══════════════════════════════════════════════

    def _make_client(
        self, project_id: str, who: str, scope: str = ""
    ) -> MutEphemeralClient:
        auth = {
            "agent": who,
            "_scope": {
                "id": who,
                "path": scope,
                "exclude": [],
                "mode": "rw",
            },
        }
        return MutEphemeralClient(self._repos, project_id, auth)

    def _select_write_scope(self, project_id: str, path: str) -> tuple[str, str]:
        """Pick the narrowest existing MUT scope that contains ``path``.

        Web UI operations pass project-root paths.  If a folder belongs to a
        narrower access point scope, pushing against that scope avoids cloning
        and rebuilding the whole project root for every write/delete, AND —
        critically — keeps the write visible after graft.

        ``graft_subtree`` builds ``mut_root_hash`` by overlaying every
        sub-scope's tree at its declared path on top of the root scope's
        tree. A write into the root scope at a path that belongs to a
        sub-scope is wholesale REPLACED by the sub-scope's tree during
        that overlay — the commit lands but the read path never sees it.
        Writing into the narrowest scope that contains the path makes
        that scope the canonical source for the subtree, so graft
        preserves the write.
        """
        clean = validate_path(path)
        try:
            repo = self._repos.get_server_repo(project_id)
            scopes = [
                (scope_path or "").strip("/")
                for scope_path in repo.get_all_scope_hashes().keys()
            ]
        except Exception:
            scopes = []

        candidates = [
            scope_path
            for scope_path in scopes
            if scope_path and clean.startswith(scope_path + "/")
        ]
        scope_path = max(candidates, key=len) if candidates else ""
        if not scope_path:
            return "", clean
        return scope_path, clean[len(scope_path) + 1:]

    def _resolve_write_target(
        self, project_id: str, path: str, explicit_scope: str,
    ) -> tuple[str, str]:
        """Decide ``(scope, rel_path)`` for a single write/mkdir.

        If the caller supplied an explicit scope (rare — only the
        legacy access-point flows do), trust it: assume ``path`` is
        already relative to that scope. Otherwise auto-route to the
        narrowest scope.
        """
        if explicit_scope:
            return explicit_scope, path
        return self._select_write_scope(project_id, path)

    def _group_paths_by_scope(
        self, project_id: str, paths: list[str],
    ) -> dict[str, list[str]]:
        """Bucket project-root paths into ``{scope_path: [rel_path, ...]}``.

        Used by batch ops (``delete``, ``bulk_write``) so each scope's
        push only carries the paths that belong to it. Empty ``scope_path``
        means root scope — paths that no narrower scope claims end up
        there.
        """
        if not paths:
            return {}
        groups: dict[str, list[str]] = {}
        for p in paths:
            scope_path, rel_path = self._select_write_scope(project_id, p)
            groups.setdefault(scope_path, []).append(rel_path)
        return groups

    @staticmethod
    def _join_scope_path(scope_path: str, rel_path: str) -> str:
        scope = (scope_path or "").strip("/")
        rel = (rel_path or "").strip("/")
        if not scope:
            return rel
        if not rel:
            return scope
        return f"{scope}/{rel}"

    async def _do_push(
        self,
        project_id: str,
        who: str,
        scope: str,
        modified: dict[str, bytes] | None = None,
        deleted: list[str] | None = None,
        message: str = "",
    ) -> WriteResult:
        # Reuse the cached process-wide host client for this scope. The
        # first access to each (project_id, scope) clones once via
        # clone_lite (tree structure only, no blob content download);
        # subsequent pushes — including this one — go straight to push
        # without touching S3 for tree reads. Mirrors how `git push`
        # reuses the same `.git` working dir between commits.
        #
        # Per-scope lock serialises concurrent pushes so two requests
        # don't race on the snapshot rebuild. Audit identity is set
        # under the lock so each push records the calling user, not
        # whoever triggered the first clone.
        from src.utils.logger import log_error

        op_label = self._op_label(message, modified, deleted)
        self._log_push_start(op_label, project_id, who, scope, modified, deleted)

        handle = self._repos.get_host_client(project_id, scope or "", who)
        repo_for_diag, pre = self._snapshot_persisted_state(
            project_id, scope, op_label,
        )

        push_started_ms = int(time.time() * 1000)

        def _push_under_lock() -> dict:
            with handle.lock:
                handle.client._set_audit_agent(who)
                return handle.client.push(
                    modified=modified,
                    deleted=deleted,
                    message=message,
                    who=who,
                )

        try:
            result = await asyncio.to_thread(_push_under_lock)
        except Exception as e:
            log_error(
                f"[MutOps][{op_label}] FAILED project={project_id} "
                f"scope={scope!r}: {e}",
            )
            raise

        push_elapsed_ms = int(time.time() * 1000) - push_started_ms
        self._log_push_result(op_label, result, push_elapsed_ms)
        self._verify_scope_state_changed(
            op_label, repo_for_diag, scope, pre, modified, deleted,
        )

        await asyncio.to_thread(self._run_post_push_hook, project_id, result)
        self._verify_root_changed(
            op_label, repo_for_diag, pre, modified, deleted,
        )

        all_paths = list((modified or {}).keys()) + (deleted or [])
        return self._to_result(result, all_paths)

    @staticmethod
    def _op_label(message: str, modified, deleted) -> str:
        if message.startswith("mkdir "):
            return "mkdir"
        if modified:
            return "write"
        if deleted:
            return "delete"
        return "push"

    def _log_push_start(
        self, op_label: str, project_id: str, who: str, scope: str,
        modified, deleted,
    ) -> None:
        from src.utils.logger import log_info
        paths_summary = list((modified or {}).keys()) + (deleted or [])
        log_info(
            f"[MutOps][{op_label}] start "
            f"project={project_id} scope={scope!r} "
            f"who={who} paths={paths_summary[:5]}",
        )
        # Probe the host-client cache BEFORE get_host_client populates
        # it via clone_lite — otherwise the log always reports "hot".
        cache_key = (project_id, scope or "")
        cache_hot_before = cache_key in self._repos._host_clients
        log_info(
            f"[MutOps][{op_label}] host-client cache="
            f"{'hot' if cache_hot_before else 'cold'}",
        )

    def _snapshot_persisted_state(
        self, project_id: str, scope: str, op_label: str,
    ) -> tuple[object, dict[str, str]]:
        """Read scope_hash / scope_head / root_hash from DB before push.

        Returns (server_repo_for_reuse, {pre_scope_hash, pre_scope_head,
        pre_root_hash}) so the post-push verification can diff. Failure
        to read is logged but non-fatal — the push itself still runs.
        """
        from src.utils.logger import log_error, log_info
        try:
            repo = self._repos.get_server_repo(project_id)
            pre = {
                "scope_hash": repo.get_scope_hash(scope or "") or "",
                "scope_head": repo.get_scope_head_commit_id(scope or "") or "",
                "root_hash": repo.get_root_hash() or "",
            }
            log_info(
                f"[MutOps][{op_label}] pre-push state "
                f"scope_hash={pre['scope_hash'][:12] or '<empty>'} "
                f"scope_head={pre['scope_head'][:12] or '<empty>'} "
                f"root_hash={pre['root_hash'][:12] or '<empty>'}",
            )
            return repo, pre
        except Exception as e:
            log_error(f"[MutOps][{op_label}] pre-push state read failed: {e}")
            return None, {"scope_hash": "", "scope_head": "", "root_hash": ""}

    @staticmethod
    def _log_push_result(op_label: str, result: dict, elapsed_ms: int) -> None:
        from src.utils.logger import log_error, log_info
        commit_id = result.get("commit_id", "")
        merged = result.get("merged", False)
        status = result.get("status", "?")
        new_root_from_push = result.get("root", "")
        log_info(
            f"[MutOps][{op_label}] push returned "
            f"status={status} commit={commit_id[:12] or '<empty>'} "
            f"merged={merged} "
            f"new_scope_hash={new_root_from_push[:12] or '<empty>'} "
            f"elapsed={elapsed_ms}ms",
        )
        if status != "ok" or not commit_id:
            log_error(
                f"[MutOps][{op_label}] push did NOT persist "
                f"(status={status}, commit_id={commit_id!r}). "
                f"raw result keys={list(result.keys())}",
            )

    @staticmethod
    def _verify_scope_state_changed(
        op_label: str, repo, scope: str, pre: dict[str, str],
        modified, deleted,
    ) -> None:
        from src.utils.logger import log_error, log_info
        if repo is None:
            return
        try:
            post_hash = repo.get_scope_hash(scope or "") or ""
            post_head = repo.get_scope_head_commit_id(scope or "") or ""
            changed = (
                post_hash != pre["scope_hash"]
                or post_head != pre["scope_head"]
            )
            log_info(
                f"[MutOps][{op_label}] post-push scope_state "
                f"scope_hash={post_hash[:12] or '<empty>'} "
                f"scope_head={post_head[:12] or '<empty>'} "
                f"changed={changed}",
            )
            if not changed and (modified or deleted):
                log_error(
                    f"[MutOps][{op_label}] scope_state DID NOT change "
                    f"despite push. CAS never landed — investigate "
                    f"cas_update_scope_state RPC or merge logic.",
                )
        except Exception as e:
            log_error(
                f"[MutOps][{op_label}] post-push scope_state read failed: {e}",
            )

    @staticmethod
    def _verify_root_changed(
        op_label: str, repo, pre: dict[str, str], modified, deleted,
    ) -> None:
        from src.utils.logger import log_error, log_info
        if repo is None:
            return
        try:
            post_root = repo.get_root_hash() or ""
            changed = post_root != pre["root_hash"]
            log_info(
                f"[MutOps][{op_label}] graft-hook done "
                f"root_hash={post_root[:12] or '<empty>'} "
                f"changed={changed}",
            )
            if not changed and (modified or deleted):
                log_error(
                    f"[MutOps][{op_label}] mut_root_hash DID NOT change. "
                    f"Read path will return stale tree — graft CAS likely failed.",
                )
        except Exception as e:
            log_error(f"[MutOps][{op_label}] post-graft root read failed: {e}")

    def push_and_finalize(self, project_id: str, push_result: dict) -> dict:
        """Run post-push hooks after any push. All push callers must use this."""
        from src.mut_engine.services.hooks import run_post_push_hook
        repo_manager = self._repos
        run_post_push_hook(project_id, repo_manager, push_result)
        return push_result

    def _run_post_push_hook(self, project_id: str, push_result: dict) -> None:
        """Best-effort post-push hook to maintain access_points table consistency.

        Failures here used to be silently swallowed (``except: pass``), which
        meant grafting failures — root_hash drifting away from scope_hash —
        were invisible. Now we log at ERROR with a stack trace so the
        consistency drift can be diagnosed from logs alone. We still don't
        re-raise because the commit itself already succeeded; the hook is a
        best-effort secondary index update.
        """
        try:
            from src.mut_engine.services.hooks import run_post_push_hook
            run_post_push_hook(project_id, self._repos, push_result)
        except Exception as e:
            import traceback

            from src.utils.logger import log_error
            commit_id = push_result.get("commit_id") or push_result.get("new_commit_id")
            log_error(
                f"[MutOps] post-push hook failed for project={project_id} "
                f"commit={commit_id} "
                f"scope={push_result.get('scope_path', '?')} "
                f"status={push_result.get('status', '?')} "
                f"error={type(e).__name__}: {e}\n{traceback.format_exc()}"
            )

    @staticmethod
    def _to_result(raw: dict, paths: list[str] | None = None) -> WriteResult:
        return WriteResult(
            commit_id=raw.get("commit_id") or raw.get("new_commit_id") or "",
            status=raw.get("status", "ok"),
            merged=raw.get("merged", False),
            conflicts=raw.get("conflicts", 0),
            paths=paths or [],
        )

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
        """Write a single file."""
        path = validate_path(path)
        return await self._do_push(
            project_id, who, scope,
            modified={path: content},
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
        """Delete one or more files."""
        paths = [validate_path(p) for p in paths]
        return await self._do_push(
            project_id, who, scope,
            deleted=paths,
            message=message or f"delete {len(paths)} files",
        )

    async def mkdir(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Create a directory (writes a .keep placeholder)."""
        path = validate_path(path)
        keep = f"{path}/.keep"
        return await self._do_push(
            project_id, who, scope,
            modified={keep: b""},
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
        self._run_post_push_hook(project_id, result)
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
        """Batch write + optional batch delete in a single push."""
        clean = {validate_path(k): v for k, v in files.items()}
        clean_del = [validate_path(p) for p in (deleted or [])]
        return await self._do_push(
            project_id, who, scope,
            modified=clean,
            deleted=clean_del,
            message=message or f"bulk write {len(clean)} files",
        )

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
        self._run_post_push_hook(project_id, result)
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
        self._run_post_push_hook(project_id, result)
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
        self._run_post_push_hook(project_id, result)
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
        and rebuilding the whole project root for every write/delete.
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
        client = self._make_client(project_id, who, scope)
        await asyncio.to_thread(client.clone)
        result = await asyncio.to_thread(
            client.push,
            modified=modified,
            deleted=deleted,
            message=message,
            who=who,
        )
        self._run_post_push_hook(project_id, result)
        all_paths = list((modified or {}).keys()) + (deleted or [])
        return self._to_result(result, all_paths)

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

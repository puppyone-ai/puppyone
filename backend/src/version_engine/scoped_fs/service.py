"""Scoped filesystem command implementation."""

from __future__ import annotations

import fnmatch
import json
import re
from typing import Any

from src.version_engine.adapters.product.commands import VersionWriteCommandService
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.read.tree_reader import VersionEntry, detect_type
from src.version_engine.write_engine.errors import ConcurrentMutationError
from src.version_engine.write_engine.path_utils import normalize_path

from .context import ScopedFsContext
from .errors import ScopedFsError, ScopedFsNotFound, ScopedFsPermissionDenied
from .registry import FS_TOOL_BY_NAME
from .policy import default_mcp_fs_allowed_tools


_DEFAULT_TREE_LIMIT = 5000
_MAX_TREE_LIMIT = 50000
_DEFAULT_GREP_LIMIT = 1000
_MAX_GREP_LIMIT = 20000
_DEFAULT_GREP_MAX_FILES = 5000
_MAX_GREP_MAX_FILES = 50000
_DEFAULT_GREP_MAX_BYTES = 16 * 1024 * 1024
_MAX_GREP_MAX_BYTES = 256 * 1024 * 1024


SEMANTICS = {
    "summary": "PuppyOne FS is a scoped cloud filesystem backed by Version Engine commits.",
    "guarantees": [
        "Commands are constrained to the MCP endpoint scope and excluded paths.",
        "Mutations are committed to Version Engine history and audit logs.",
        "Write and delete tools are only exposed for writable MCP endpoint scopes.",
    ],
    "differences": [
        "POSIX inode/device/link ownership semantics are not modeled.",
        "Timestamps are derived from Version Engine history when available.",
        "Recursive reads expose complete/truncated metadata and should use limits.",
    ],
    "commands": [
        "fs_ls, fs_tree, fs_find, fs_grep, fs_cat, fs_head, fs_tail, fs_stat",
        "fs_write, fs_mkdir, fs_touch, fs_cp, fs_mv, fs_rmdir, fs_rm",
    ],
}


class ScopedFsService:
    def __init__(
        self,
        ops: ProductOperationAdapter,
        commands: VersionWriteCommandService,
    ):
        self.ops = ops
        self.commands = commands

    async def call(
        self,
        ctx: ScopedFsContext,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if name not in FS_TOOL_BY_NAME:
            raise ScopedFsError("UNKNOWN_TOOL", f"Unknown filesystem tool: {name}")
        spec = FS_TOOL_BY_NAME[name]
        if spec.access in {"write", "delete"} and not ctx.writable:
            raise ScopedFsPermissionDenied(f"Tool {name} requires a writable MCP endpoint scope")
        allowed_tools = ctx.allowed_tools
        if allowed_tools is None:
            allowed_tools = default_mcp_fs_allowed_tools(writable=ctx.writable)
        if name not in allowed_tools:
            raise ScopedFsPermissionDenied(f"Tool {name} is disabled for this MCP endpoint")

        args = arguments or {}
        method_name = name[3:] if name.startswith("fs_") else name
        method = getattr(self, method_name)
        return await method(ctx, **args)

    async def semantics(self, ctx: ScopedFsContext) -> dict[str, Any]:
        return {
            "fs_semantics": SEMANTICS,
            "scope": self._scope_payload(ctx),
        }

    async def ls(
        self,
        ctx: ScopedFsContext,
        path: str = "",
        include_hidden: bool = False,
        include_size: bool = False,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path)
        target = self._stat(ctx, rel, include_size=include_size)
        if target is None and rel:
            raise ScopedFsNotFound(f"Path not found: {rel}")
        if target and target.type != "folder":
            entries = [target]
        else:
            entries = self._filter_entries(
                ctx,
                self.ops.list_dir_in_scope(ctx.project_id, ctx.scope_path, rel, include_size=include_size),
                include_hidden=include_hidden,
            )
        return {
            "path": rel,
            "scope": self._scope_payload(ctx),
            "target_type": target.type if target else "folder",
            "entries": [self._entry_payload(entry) for entry in entries],
            "head_commit_id": self._head(ctx),
        }

    async def tree(
        self,
        ctx: ScopedFsContext,
        path: str = "",
        max_depth: int = -1,
        limit: int = _DEFAULT_TREE_LIMIT,
        include_hidden: bool = False,
        include_size: bool = False,
        directories_only: bool = False,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path)
        safe_limit = self._bounded_int(limit, _DEFAULT_TREE_LIMIT, _MAX_TREE_LIMIT)
        target = self._stat(ctx, rel, include_size=include_size)
        if target is None and rel:
            raise ScopedFsNotFound(f"Path not found: {rel}")
        if target and target.type != "folder":
            raw_entries = [] if directories_only else [target]
            truncated = False
        else:
            raw_entries = self.ops.list_tree_in_scope(
                ctx.project_id,
                ctx.scope_path,
                rel,
                max_depth=max_depth,
                include_size=include_size,
                max_entries=safe_limit + 1,
            )
            raw_entries = self._filter_entries(ctx, raw_entries, include_hidden=include_hidden)
            if directories_only:
                raw_entries = [entry for entry in raw_entries if entry.type == "folder"]
            truncated = len(raw_entries) > safe_limit
            if truncated:
                raw_entries = raw_entries[:safe_limit]
        entries = [self._entry_payload(entry) for entry in raw_entries]
        return {
            "path": rel,
            "scope": self._scope_payload(ctx),
            "target_type": target.type if target else "folder",
            "limit": safe_limit,
            "returned_count": len(entries),
            "complete": not truncated,
            "truncated": truncated,
            "truncation_reason": "entry_limit_exceeded" if truncated else "",
            "entries": entries,
            "head_commit_id": self._head(ctx),
        }

    async def find(
        self,
        ctx: ScopedFsContext,
        path: str = "",
        name: str = "",
        path_glob: str = "",
        type: str = "any",
        max_depth: int = -1,
        limit: int = _DEFAULT_TREE_LIMIT,
        include_hidden: bool = True,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path)
        safe_limit = self._bounded_int(limit, _DEFAULT_TREE_LIMIT, _MAX_TREE_LIMIT)
        target = self._stat(ctx, rel, include_size=False)
        if target is None and rel:
            raise ScopedFsNotFound(f"Path not found: {rel}")
        entries = []
        if target:
            entries.append(target)
        if not target or target.type == "folder":
            entries.extend(self.ops.list_tree_in_scope(
                ctx.project_id,
                ctx.scope_path,
                rel,
                max_depth=max_depth,
                include_size=False,
                max_entries=safe_limit + 1,
            ))
        entries = self._filter_entries(ctx, entries, include_hidden=include_hidden)
        entries = [entry for entry in entries if self._matches_find(entry, name, path_glob, type)]
        truncated = len(entries) > safe_limit
        if truncated:
            entries = entries[:safe_limit]
        return {
            "path": rel,
            "scope": self._scope_payload(ctx),
            "limit": safe_limit,
            "returned_count": len(entries),
            "complete": not truncated,
            "truncated": truncated,
            "entries": [self._entry_payload(entry) for entry in entries],
            "head_commit_id": self._head(ctx),
        }

    async def grep(
        self,
        ctx: ScopedFsContext,
        pattern: str,
        path: str = "",
        regex: bool = True,
        ignore_case: bool = False,
        limit: int = _DEFAULT_GREP_LIMIT,
        max_files: int = _DEFAULT_GREP_MAX_FILES,
        max_bytes: int = _DEFAULT_GREP_MAX_BYTES,
        before_context: int = 0,
        after_context: int = 0,
    ) -> dict[str, Any]:
        if not pattern:
            raise ScopedFsError("INVALID_ARGUMENT", "pattern is required")
        rel = self._clean_path(ctx, path)
        safe_limit = self._bounded_int(limit, _DEFAULT_GREP_LIMIT, _MAX_GREP_LIMIT)
        safe_max_files = self._bounded_int(max_files, _DEFAULT_GREP_MAX_FILES, _MAX_GREP_MAX_FILES)
        safe_max_bytes = self._bounded_int(max_bytes, _DEFAULT_GREP_MAX_BYTES, _MAX_GREP_MAX_BYTES)
        target = self._stat(ctx, rel, include_size=True)
        if target is None and rel:
            raise ScopedFsNotFound(f"Path not found: {rel}")
        candidates = [target] if target and target.type != "folder" else self.ops.list_tree_in_scope(
            ctx.project_id,
            ctx.scope_path,
            rel,
            max_depth=-1,
            include_size=True,
            max_entries=safe_max_files + 1,
        )
        # Same exclusion gate the listing tools apply — without it grep would
        # read line content out of files the endpoint's `exclude` hides.
        candidates = self._filter_entries(ctx, candidates, include_hidden=True)
        files = [entry for entry in candidates if entry and entry.type != "folder"]
        truncated_files = len(files) > safe_max_files
        files = files[:safe_max_files]
        flags = re.IGNORECASE if ignore_case else 0
        compiled = re.compile(pattern if regex else re.escape(pattern), flags)
        matches: list[dict[str, Any]] = []
        scanned_files = 0
        scanned_bytes = 0
        skipped: list[dict[str, Any]] = []
        for entry in files:
            if len(matches) >= safe_limit:
                break
            if entry.size_bytes and entry.size_bytes > safe_max_bytes:
                skipped.append({"path": entry.path, "reason": "file_too_large"})
                continue
            try:
                # entry.path is scope-absolute; the read API wants scope-relative.
                content = self.ops.read_file_in_scope(
                    ctx.project_id, ctx.scope_path, self._rel_path(ctx, entry.path),
                )
            except Exception as exc:
                skipped.append({"path": entry.path, "reason": str(exc)})
                continue
            scanned_files += 1
            scanned_bytes += len(content)
            if scanned_bytes > safe_max_bytes:
                skipped.append({"path": entry.path, "reason": "byte_limit_exceeded"})
                break
            text = content.decode("utf-8", errors="replace")
            lines = text.splitlines()
            for index, line in enumerate(lines):
                if len(matches) >= safe_limit:
                    break
                match = compiled.search(line)
                if not match:
                    continue
                start_before = max(0, index - before_context)
                end_after = min(len(lines), index + after_context + 1)
                matches.append({
                    "path": entry.path,
                    "line_number": index + 1,
                    "line_text": line,
                    "match_text": match.group(0),
                    "match_start": match.start(),
                    "before_context": lines[start_before:index],
                    "after_context": lines[index + 1:end_after],
                })
        return {
            "path": rel,
            "pattern": pattern,
            "regex": regex,
            "ignore_case": ignore_case,
            "matches": matches,
            "returned_count": len(matches),
            "scanned_files": scanned_files,
            "scanned_bytes": scanned_bytes,
            "complete": not truncated_files and len(matches) < safe_limit and not any(s.get("reason") == "byte_limit_exceeded" for s in skipped),
            "truncated": truncated_files or len(matches) >= safe_limit,
            "skipped": skipped,
            "head_commit_id": self._head(ctx),
        }

    async def cat(self, ctx: ScopedFsContext, path: str, structured: bool = False) -> dict[str, Any]:
        rel = self._clean_path(ctx, path, require=True)
        entry = self._stat(ctx, rel, include_size=True)
        if entry is None:
            raise ScopedFsNotFound(f"File not found: {rel}")
        if entry.type == "folder":
            return await self.ls(ctx, rel)
        content = self.ops.read_file_in_scope(ctx.project_id, ctx.scope_path, rel)
        text = content.decode("utf-8", errors="replace")
        content_json = None
        if structured and entry.type == "json":
            try:
                content_json = json.loads(text)
                text = ""
            except ValueError:
                pass
        return {
            "path": rel,
            "scope": self._scope_payload(ctx),
            "type": entry.type or detect_type(rel),
            "size_bytes": len(content),
            "content": content_json,
            "content_text": text,
            "head_commit_id": self._head(ctx),
        }

    async def head(
        self,
        ctx: ScopedFsContext,
        path: str,
        lines: int = 10,
        bytes: int | None = None,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path, require=True)
        content = self.ops.read_file_in_scope(ctx.project_id, ctx.scope_path, rel)
        if bytes is not None:
            output = content[: max(0, bytes)].decode("utf-8", errors="replace")
        else:
            output = "\n".join(content.decode("utf-8", errors="replace").splitlines()[: max(0, lines)])
            if output:
                output += "\n"
        return {"path": rel, "content_text": output, "bytes": len(output.encode("utf-8"))}

    async def tail(
        self,
        ctx: ScopedFsContext,
        path: str,
        lines: int = 10,
        bytes: int | None = None,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path, require=True)
        content = self.ops.read_file_in_scope(ctx.project_id, ctx.scope_path, rel)
        if bytes is not None:
            output = content[-max(0, bytes):].decode("utf-8", errors="replace") if bytes else ""
        else:
            output = "\n".join(content.decode("utf-8", errors="replace").splitlines()[-max(0, lines):])
            if output:
                output += "\n"
        return {"path": rel, "content_text": output, "bytes": len(output.encode("utf-8"))}

    async def stat(self, ctx: ScopedFsContext, path: str = "") -> dict[str, Any]:
        rel = self._clean_path(ctx, path)
        if not rel:
            return {
                "path": "",
                "scope": self._scope_payload(ctx),
                "exists": True,
                "type": "folder",
                "name": ctx.scope_path.rsplit("/", 1)[-1] if ctx.scope_path else "",
                "head_commit_id": self._head(ctx),
            }
        entry = self._stat(ctx, rel, include_size=True)
        if entry is None:
            return {
                "path": rel,
                "scope": self._scope_payload(ctx),
                "exists": False,
                "type": "",
                "head_commit_id": self._head(ctx),
            }
        data = self._entry_payload(entry)
        data.update({
            "exists": True,
            "scope": self._scope_payload(ctx),
            "head_commit_id": self._head(ctx),
        })
        return data

    async def write(
        self,
        ctx: ScopedFsContext,
        path: str,
        content: Any,
        node_type: str = "file",
        message: str = "",
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path, require=True)
        outcome = await self._run_write(
            self.commands.write_file(
                ctx.project_id,
                rel,
                content,
                node_type=node_type or "file",
                actor=ctx.actor,
                scope=ctx.scope_path,
                message=message,
                default_message_prefix="mcp write",
                base_commit_id=base_commit_id,
                defer_projection=True,
                source_channel="mcp",
            )
        )
        return {"path": outcome.path, "commit_id": outcome.result.commit_id, "scope": self._scope_payload(ctx)}

    async def mkdir(
        self,
        ctx: ScopedFsContext,
        path: str,
        parents: bool = False,
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        rel = self._clean_path(ctx, path, require=True)
        if not parents:
            parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
            if parent and self._stat(ctx, parent) is None:
                raise ScopedFsNotFound(f"No such parent directory: {parent}")
        outcome = await self._run_write(
            self.commands.mkdir(
                ctx.project_id,
                rel,
                actor=ctx.actor,
                scope=ctx.scope_path,
                message=f"mcp mkdir {rel}",
                base_commit_id=base_commit_id,
                defer_projection=True,
                source_channel="mcp",
            )
        )
        return {"path": rel, "commit_id": outcome.result.commit_id, "scope": self._scope_payload(ctx)}

    async def touch(
        self,
        ctx: ScopedFsContext,
        path: str = "",
        paths: list[str] | None = None,
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        rels = self._clean_paths(ctx, paths or [path])
        missing = [rel for rel in rels if self._stat(ctx, rel) is None]
        existing = [rel for rel in rels if rel not in missing]
        commit_ids: list[str] = []
        if existing:
            outcome = await self._run_write(
                self.commands.touch(
                    ctx.project_id,
                    existing,
                    actor=ctx.actor,
                    scope=ctx.scope_path,
                    message=f"mcp touch {len(existing)} files",
                    base_commit_id=base_commit_id,
                    defer_projection=True,
                    source_channel="mcp",
                )
            )
            commit_ids.append(outcome.result.commit_id)
        for rel in missing:
            outcome = await self._run_write(
                self.commands.write_bytes(
                    ctx.project_id,
                    rel,
                    b"",
                    actor=ctx.actor,
                    scope=ctx.scope_path,
                    message=f"mcp touch {rel}",
                    base_commit_id=None if commit_ids else base_commit_id,
                    defer_projection=True,
                    source_channel="mcp",
                )
            )
            commit_ids.append(outcome.result.commit_id)
        return {"paths": rels, "commit_ids": commit_ids, "scope": self._scope_payload(ctx)}

    async def cp(
        self,
        ctx: ScopedFsContext,
        old_path: str,
        new_path: str,
        recursive: bool = False,
        no_clobber: bool = False,
        message: str = "",
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        old_rel = self._clean_path(ctx, old_path, require=True)
        new_rel = self._clean_path(ctx, new_path, require=True)
        old_entry = self._stat(ctx, old_rel)
        if old_entry is None:
            raise ScopedFsNotFound(f"Path not found: {old_rel}")
        if old_entry.type == "folder" and not recursive:
            raise ScopedFsError("IS_DIRECTORY", f"Is a directory: {old_rel}")
        if no_clobber and self._stat(ctx, new_rel) is not None:
            return {"old_path": old_rel, "new_path": new_rel, "skipped": True, "reason": "destination exists"}
        outcome = await self._run_write(
            self.commands.copy(
                ctx.project_id,
                old_rel,
                new_rel,
                actor=ctx.actor,
                scope=ctx.scope_path,
                message=message or f"mcp copy {old_rel} -> {new_rel}",
                base_commit_id=base_commit_id,
                defer_projection=True,
                source_channel="mcp",
            )
        )
        return {"old_path": old_rel, "new_path": new_rel, "commit_id": outcome.result.commit_id, "skipped": False}

    async def mv(
        self,
        ctx: ScopedFsContext,
        old_path: str,
        new_path: str,
        no_clobber: bool = False,
        message: str = "",
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        old_rel = self._clean_path(ctx, old_path, require=True)
        new_rel = self._clean_path(ctx, new_path, require=True)
        if self._stat(ctx, old_rel) is None:
            raise ScopedFsNotFound(f"Path not found: {old_rel}")
        if no_clobber and self._stat(ctx, new_rel) is not None:
            return {"old_path": old_rel, "new_path": new_rel, "skipped": True, "reason": "destination exists"}
        outcome = await self._run_write(
            self.commands.move(
                ctx.project_id,
                old_rel,
                new_rel,
                actor=ctx.actor,
                scope=ctx.scope_path,
                message=message or f"mcp move {old_rel} -> {new_rel}",
                base_commit_id=base_commit_id,
                defer_projection=True,
                source_channel="mcp",
            )
        )
        return {"old_path": old_rel, "new_path": new_rel, "commit_id": outcome.result.commit_id, "skipped": False}

    async def rmdir(
        self,
        ctx: ScopedFsContext,
        path: str = "",
        paths: list[str] | None = None,
        parents: bool = False,
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        rels = self._clean_paths(ctx, paths or [path])
        remove_paths: list[str] = []
        for rel in rels:
            chain = self._rmdir_chain(ctx, rel, parents=parents)
            remove_paths.extend([p for p in chain if p not in remove_paths])
        outcome = await self._run_write(
            self.commands.delete(
                ctx.project_id,
                remove_paths,
                actor=ctx.actor,
                scope=ctx.scope_path,
                message=f"mcp rmdir {len(remove_paths)} directories",
                base_commit_id=base_commit_id,
                defer_projection=True,
                source_channel="mcp",
            )
        )
        return {"paths": rels, "removed_paths": remove_paths, "commit_id": outcome.result.commit_id}

    async def rm(
        self,
        ctx: ScopedFsContext,
        path: str = "",
        paths: list[str] | None = None,
        recursive: bool = False,
        force: bool = False,
        base_commit_id: str | None = None,
    ) -> dict[str, Any]:
        rels = self._clean_paths(ctx, paths or [path])
        existing: list[str] = []
        missing: list[str] = []
        for rel in rels:
            entry = self._stat(ctx, rel)
            if entry is None:
                missing.append(rel)
                continue
            if entry.type == "folder" and not recursive:
                raise ScopedFsError("IS_DIRECTORY", f"Is a directory: {rel}")
            existing.append(rel)
        if missing and not force:
            raise ScopedFsNotFound(f"Path not found: {missing[0]}")
        if not existing:
            return {"paths": rels, "removed": False, "commit_id": ""}
        outcome = await self._run_write(
            self.commands.delete(
                ctx.project_id,
                existing,
                actor=ctx.actor,
                scope=ctx.scope_path,
                message=f"mcp delete {len(existing)} paths",
                base_commit_id=base_commit_id,
                defer_projection=True,
                source_channel="mcp",
            )
        )
        return {"paths": existing, "removed": True, "commit_id": outcome.result.commit_id}

    async def _run_write(self, awaitable):
        try:
            return await awaitable
        except ConcurrentMutationError as exc:
            raise ScopedFsError("CONFLICT", str(exc), status_code=409) from exc
        except FileNotFoundError as exc:
            raise ScopedFsNotFound(str(exc)) from exc
        except ValueError as exc:
            raise ScopedFsError("INVALID_ARGUMENT", str(exc)) from exc

    def _clean_paths(self, ctx: ScopedFsContext, paths: list[str]) -> list[str]:
        rels = [self._clean_path(ctx, path, require=True) for path in paths]
        if not rels:
            raise ScopedFsError("INVALID_ARGUMENT", "path is required")
        return rels

    def _clean_path(self, ctx: ScopedFsContext, path: str = "", *, require: bool = False) -> str:
        try:
            rel = normalize_path(path or "")
        except ValueError as exc:
            raise ScopedFsError("INVALID_PATH", str(exc)) from exc
        if require and not rel:
            raise ScopedFsError("INVALID_ARGUMENT", "path is required")
        if self._is_excluded(ctx, rel):
            raise ScopedFsPermissionDenied(f"Path is excluded from this MCP endpoint: {rel}")
        return rel

    @staticmethod
    def _abs_path(ctx: ScopedFsContext, rel_path: str) -> str:
        """Lift a scope-relative path into the scope-absolute (project-relative)
        space that ``ctx.exclude`` and tree-reader ``entry.path`` values use."""
        rel = (rel_path or "").strip("/")
        if not ctx.scope_path:
            return rel
        return f"{ctx.scope_path}/{rel}" if rel else ctx.scope_path

    @staticmethod
    def _rel_path(ctx: ScopedFsContext, abs_path: str) -> str:
        """Inverse of :meth:`_abs_path`: drop the scope prefix so a scope-absolute
        entry path can be passed back into the scope-relative read APIs."""
        p = (abs_path or "").strip("/")
        if ctx.scope_path and (p == ctx.scope_path or p.startswith(ctx.scope_path + "/")):
            return p[len(ctx.scope_path):].strip("/")
        return p

    def _is_excluded(self, ctx: ScopedFsContext, rel_path: str) -> bool:
        # ``rel_path`` is scope-relative. The admission layer stores ``exclude``
        # entries scope-absolute (project-relative) and merges them with the
        # carved child-scope paths, so the canonical comparison space is
        # absolute. Legacy rows may hold scope-relative entries, so match BOTH
        # forms — fail-closed is the right default for a deny gate. (Previously
        # only the relative form was compared, which let a known excluded path
        # be read/written directly even though listings hid it.)
        rel = (rel_path or "").strip("/")
        abs_path = self._abs_path(ctx, rel)
        for exclude in ctx.exclude:
            clean = normalize_path(str(exclude))
            if not clean:
                continue
            for candidate in (rel, abs_path):
                if candidate == clean or candidate.startswith(clean + "/"):
                    return True
        return False

    def _stat(self, ctx: ScopedFsContext, rel_path: str, *, include_size: bool = False) -> VersionEntry | None:
        if self._is_excluded(ctx, rel_path):
            return None
        return self.ops.stat_in_scope(ctx.project_id, ctx.scope_path, rel_path, include_size=include_size)

    def _filter_entries(
        self,
        ctx: ScopedFsContext,
        entries: list[VersionEntry],
        *,
        include_hidden: bool,
    ) -> list[VersionEntry]:
        # entry.path is scope-absolute; normalize to scope-relative so the
        # exclusion check sees the same space as the read/stat callers.
        visible = [
            entry for entry in entries
            if not self._is_excluded(ctx, self._rel_path(ctx, entry.path))
        ]
        if include_hidden:
            return visible
        return [entry for entry in visible if not entry.name.startswith(".")]

    @staticmethod
    def _entry_payload(entry: VersionEntry) -> dict[str, Any]:
        return {
            "name": entry.name,
            "path": entry.path,
            "type": entry.type,
            "content_hash": entry.content_hash,
            "size_bytes": entry.size_bytes,
            "mime_type": entry.mime_type,
            "children_count": entry.children_count,
            "integrity_status": entry.integrity_status,
            "created_at": entry.created_at,
            "modified_at": entry.modified_at,
        }

    @staticmethod
    def _matches_find(entry: VersionEntry, name: str, path_glob: str, type_filter: str) -> bool:
        if type_filter == "file" and entry.type == "folder":
            return False
        if type_filter == "folder" and entry.type != "folder":
            return False
        if name and not fnmatch.fnmatch(entry.name, name):
            return False
        if path_glob and not fnmatch.fnmatch(entry.path, path_glob):
            return False
        return True

    @staticmethod
    def _bounded_int(value: Any, default: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        if parsed <= 0:
            return default
        return min(parsed, maximum)

    @staticmethod
    def _scope_payload(ctx: ScopedFsContext) -> dict[str, Any]:
        return {
            "id": ctx.scope_id,
            "path": ctx.scope_path,
            "mode": ctx.mode,
            "exclude": ctx.exclude,
            "channel": ctx.channel,
        }

    def _head(self, ctx: ScopedFsContext) -> str:
        return self.ops.get_scope_head_commit_id(ctx.project_id, ctx.scope_path)

    def _rmdir_chain(self, ctx: ScopedFsContext, rel: str, *, parents: bool) -> list[str]:
        entry = self._stat(ctx, rel)
        if entry is None:
            raise ScopedFsNotFound(f"Path not found: {rel}")
        if entry.type != "folder":
            raise ScopedFsError("NOT_A_DIRECTORY", f"Not a directory: {rel}")
        if self.ops.list_dir_in_scope(ctx.project_id, ctx.scope_path, rel):
            raise ScopedFsError("DIRECTORY_NOT_EMPTY", f"Directory not empty: {rel}")
        removable = [rel]
        if not parents:
            return removable
        child = rel
        parent = child.rsplit("/", 1)[0] if "/" in child else ""
        while parent:
            entries = self.ops.list_dir_in_scope(ctx.project_id, ctx.scope_path, parent)
            remaining = [entry for entry in entries if entry.path.strip("/") != child]
            if remaining:
                break
            removable.append(parent)
            child = parent
            parent = child.rsplit("/", 1)[0] if "/" in child else ""
        return removable

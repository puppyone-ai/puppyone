"""
MutOps — Unified entry point for typed MUT tree operations.

All channels (Web UI / Agent / Sandbox / MCP / Datasource / Ingest /
Table / Seed) operate on the MUT tree through this class. Channels do
not directly touch ``MutEphemeralClient`` or ``MutTreeReader``.

Architecture:
    Each typed write op (``write_file``, ``delete``, ``mkdir``, ``move``,
    ``trash``, ``restore``, ``permanent_delete``, ``bulk_write``)
    constructs an O(D) tree splice via ``services.tree_splice`` and
    routes it through ``services.direct_writer.apply_mutation`` for
    atomic CAS + history + audit + graft. No ``clone_lite``, no full
    blob downloads, no 3-way merge.

    Read ops resolve straight against the persisted Merkle root via
    ``MutTreeReader`` (S3-cached tree-node reads only, no flattening).

    External CLI / sync clients still use the MUT protocol via
    ``/api/v1/mut/*`` (with merge semantics for divergent local
    state) — that path lives in ``protocol_router`` and is unaffected
    by this module.

Usage:
    ops = MutOps(repo_manager)
    result = await ops.write_file("proj_1", "readme.md", b"# Hi", who="user:123")
    content = ops.read_file("proj_1", "readme.md")
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.validation import validate_path
from src.mut_engine.services.direct_writer import apply_mutation
from src.mut_engine.services.tree_reader import MutEntry, MutTreeReader
from src.mut_engine.services.tree_splice import (
    splice_batch,
    splice_mkdir,
    splice_move,
    splice_put_blob,
    splice_remove,
)


@dataclass
class WriteResult:
    commit_id: str = ""
    status: str = "ok"
    merged: bool = False
    conflicts: int = 0
    paths: list[str] = field(default_factory=list)


class MissingBlobError(RuntimeError):
    """Raised by ``MutOps.bulk_write_refs`` when a referenced blob
    isn't in the project's ObjectStore.

    Distinct from ``FileNotFoundError`` (which is for path-level
    misses) so callers can tell the two apart and respond
    differently — a missing path is normal (idempotent delete), a
    missing blob is an upload-pipeline bug.
    """


@dataclass(frozen=True)
class BlobRef:
    """Reference to an already-staged blob in a project's MUT object store.

    Carries enough metadata to record a commit (hash for the tree
    pointer, size for audit/quota) without having to materialize the
    payload in the Python process.

    The ``hash`` MUST identify a blob that's already present in the
    project's ``ObjectStore`` — i.e. some upstream stage step has
    already written it (or confirmed it exists). Producing a
    ``BlobRef`` IS the contract: "I have already put bytes such that
    ``store.get(hash) == those bytes``." Anyone holding a
    ``BlobRef`` can safely commit it without re-uploading.

    Why a dataclass and not a tuple: ``size`` is purely informational
    today (tree nodes only store ``hash``), but we surface it in
    audit logs (``"uploaded N files (X bytes)"``), and future tree
    formats may inline size for fast directory listing. The named
    fields keep that future change cheap.
    """

    hash: str
    size: int


class MutOps:
    """Unified entry point for MUT tree operations."""

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager
        self._reader = MutTreeReader(repo_manager)

    # ══════════════════════════════════════════════
    # Write operations — typed splice → direct_writer
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
        """Write a single file (create or update).

        Routes the write to the narrowest existing MUT scope that
        contains ``path`` so graft can preserve it (a write into the
        root scope at a path that belongs to a sub-scope is wholesale
        replaced by the sub-scope's tree during graft — the commit
        lands but the read path never sees it).
        """
        path = validate_path(path)
        target_scope, rel_path = self._resolve_write_target(
            project_id, path, scope,
        )

        def splice_fn(store, root_hash):
            return splice_put_blob(store, root_hash, rel_path, content)

        result = await apply_mutation(
            self._repos, project_id, target_scope, splice_fn,
            who=who,
            message=message or f"write {path}",
            op_type="write_file",
            audit_detail={"path": path, "size": len(content)},
        )
        return _to_result(result, [path])

    async def delete(
        self,
        project_id: str,
        paths: list[str],
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Delete one or more files.

        Each path is routed to the narrowest scope that contains it.
        Mixing paths from different scopes results in one commit per
        scope. Returns the FIRST commit; in practice all paths usually
        share one scope and there's only one push.
        """
        clean = [validate_path(p) for p in paths]
        if scope:
            return await self._delete_in_scope(
                project_id, scope, clean, who, message,
            )

        groups = self._group_paths_by_scope(project_id, clean)
        first_result: WriteResult | None = None
        for target_scope, rel_paths in groups.items():
            r = await self._delete_in_scope(
                project_id, target_scope, rel_paths, who, message,
            )
            first_result = first_result or r
        return first_result or WriteResult(paths=clean)

    async def _delete_in_scope(
        self,
        project_id: str,
        scope: str,
        rel_paths: list[str],
        who: str,
        message: str,
    ) -> WriteResult:
        def splice_fn(store, root_hash):
            return splice_remove(store, root_hash, rel_paths)

        result = await apply_mutation(
            self._repos, project_id, scope, splice_fn,
            who=who,
            message=message or f"delete {len(rel_paths)} files",
            op_type="delete",
            audit_detail={"paths": rel_paths},
        )
        full_paths = [
            self._join_scope_path(scope, p) for p in rel_paths
        ]
        return _to_result(result, full_paths)

    async def mkdir(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Create a directory (writes a ``.keep`` placeholder).

        Routed to the narrowest scope that contains ``path``, same as
        ``write_file``. Existing directories are no-ops (no commit
        created). Errors out if a file already occupies the path.
        """
        path = validate_path(path)
        keep_full = f"{path}/.keep"
        target_scope, rel_keep = self._resolve_write_target(
            project_id, keep_full, scope,
        )
        rel_dir = (
            rel_keep[: -len("/.keep")]
            if rel_keep.endswith("/.keep")
            else rel_keep
        )

        def splice_fn(store, root_hash):
            return splice_mkdir(store, root_hash, rel_dir)

        result = await apply_mutation(
            self._repos, project_id, target_scope, splice_fn,
            who=who,
            message=message or f"mkdir {path}",
            op_type="mkdir",
            audit_detail={"path": path},
        )
        return _to_result(result, [path])

    async def move(
        self,
        project_id: str,
        old_path: str,
        new_path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Move / rename a file or folder.

        Operates on tree-node hashes — the underlying blobs are NOT
        downloaded or re-uploaded. A folder rename of a 1000-file
        subtree costs the same as a 1-file rename.
        """
        old_path = validate_path(old_path)
        new_path = validate_path(new_path)

        if scope:
            old_scope, old_rel = scope, old_path
            new_scope, new_rel = scope, new_path
        else:
            old_scope, old_rel = self._select_write_scope(project_id, old_path)
            new_scope, new_rel = self._select_write_scope(project_id, new_path)

        if old_scope != new_scope:
            raise ValueError(
                f"cross-scope move not supported: "
                f"{old_path!r} (scope={old_scope!r}) → "
                f"{new_path!r} (scope={new_scope!r})",
            )

        def splice_fn(store, root_hash):
            return splice_move(store, root_hash, old_rel, new_rel)

        result = await apply_mutation(
            self._repos, project_id, old_scope, splice_fn,
            who=who,
            message=message or f"move {old_path} → {new_path}",
            op_type="move",
            audit_detail={"old_path": old_path, "new_path": new_path},
        )

        # Best-effort secondary index update — keeps access_points and
        # repo_scopes pointing at the new path. Failures here are
        # logged but don't fail the move.
        try:
            from src.mut_engine.services.hooks import post_commit_move

            post_commit_move(project_id, old_path, new_path)
        except Exception as e:
            from src.utils.logger import log_error

            log_error(
                f"[MutOps] post-commit move hook failed "
                f"for project={project_id}: {e}",
            )

        return _to_result(result, [old_path, new_path])

    async def bulk_write(
        self,
        project_id: str,
        files: dict[str, bytes],
        who: str,
        scope: str = "",
        deleted: list[str] | None = None,
        message: str = "",
    ) -> WriteResult:
        """Batch write + optional batch delete in one commit per scope.

        When ``scope`` is empty, paths are bucketed by the narrowest
        scope that contains each one and pushed per scope. See
        ``write_file`` for the why — root-scope writes at sub-scope
        paths are silently shadowed during graft.
        """
        clean = {validate_path(k): v for k, v in files.items()}
        clean_del = [validate_path(p) for p in (deleted or [])]
        if scope:
            return await self._bulk_write_in_scope(
                project_id, scope,
                {k: clean[k] for k in clean},
                clean_del,
                who, message,
            )

        write_groups = self._group_paths_by_scope(
            project_id, list(clean.keys()),
        )
        del_groups = self._group_paths_by_scope(project_id, clean_del)
        all_scopes = set(write_groups.keys()) | set(del_groups.keys())

        first_result: WriteResult | None = None
        for target_scope in all_scopes:
            rel_files = {
                rel: clean[self._join_scope_path(target_scope, rel)]
                for rel in write_groups.get(target_scope, [])
            }
            rel_dels = del_groups.get(target_scope, [])
            r = await self._bulk_write_in_scope(
                project_id, target_scope,
                rel_files, rel_dels, who, message,
            )
            first_result = first_result or r
        return first_result or WriteResult(
            paths=list(clean.keys()) + clean_del,
        )

    async def _bulk_write_in_scope(
        self,
        project_id: str,
        scope: str,
        rel_files: dict[str, bytes],
        rel_dels: list[str],
        who: str,
        message: str,
    ) -> WriteResult:
        ops: list[tuple] = []
        ops.extend(("put", path, content) for path, content in rel_files.items())
        ops.extend(("rm", path) for path in rel_dels)
        if not ops:
            return WriteResult()

        def splice_fn(store, root_hash):
            return splice_batch(store, root_hash, ops)

        result = await apply_mutation(
            self._repos, project_id, scope, splice_fn,
            who=who,
            message=message or f"bulk write {len(rel_files)} files",
            op_type="bulk_write",
            audit_detail={
                "writes": len(rel_files),
                "deletes": len(rel_dels),
            },
        )
        full_paths = [
            self._join_scope_path(scope, p)
            for p in list(rel_files.keys()) + rel_dels
        ]
        return _to_result(result, full_paths)

    # ══════════════════════════════════════════════
    # Hash-first APIs (Layer 1 + Layer 2 of the upload pipeline)
    # ══════════════════════════════════════════════
    #
    # The byte-taking ``write_file`` / ``bulk_write`` above are
    # convenience wrappers for "I have raw bytes in process memory".
    # They internally stage each blob (write to ObjectStore by hash)
    # and then commit by reference. The methods below expose those
    # two phases separately for callers that staged elsewhere — most
    # importantly, the multipart-upload path where blobs are
    # materialized in S3 directly and we never want them in the
    # Python process.
    #
    # Public surface for upload-pipeline callers:
    #   ``stage_blob_from_bytes(content)`` — returns a ``BlobRef`` after
    #     a single ``ObjectStore.put`` call. Same as what
    #     ``write_file`` does internally.
    #   ``bulk_write_refs(file_refs)`` — commit a tree update referencing
    #     already-staged blobs by hash. ``verify_blobs=True`` (default)
    #     does a HEAD round-trip per blob as a safety net against
    #     dangling commits — turn it off in known-good batches if the
    #     extra latency matters.
    #
    # The upload path (browser multipart, future CLI binary push) uses
    # ``stage_blob_from_s3`` (in ``ingest/file/jobs/jobs.py`` —
    # different module, S3-aware) to ``CopyObject`` from the upload
    # key into the MUT object key without touching the bytes, and
    # then calls ``bulk_write_refs`` here.

    async def stage_blob_from_bytes(
        self,
        project_id: str,
        content: bytes,
    ) -> BlobRef:
        """Write ``content`` to the project's MUT object store and
        return a ``BlobRef`` pointing at it.

        The store call is content-addressed and idempotent: writing
        the same bytes twice computes the same hash and is a no-op
        on the second call (so caller-side dedup is unnecessary —
        re-uploading the same file is free).

        Use this when you genuinely have bytes in memory (CLI text
        writes, connector outputs, internal templates). For multipart
        uploads where the bytes already live in S3, use
        ``ingest.file.jobs.jobs.stage_blob_from_s3`` instead — it
        uses S3 ``CopyObject`` to put the blob at the MUT key without
        ever loading it into the backend process.

        Implementation note: we deliberately bypass ``apply_mutation``
        here. A pure stage doesn't change any tree, so the scope
        lock + ``scope_hash`` DB read that ``apply_mutation`` does
        upfront would be wasted work. Instead we go straight to the
        ObjectStore — exactly what ``apply_mutation`` would do
        internally for the blob-write step.
        """
        repo = self._repos.get_server_repo(project_id)
        store = repo.store
        async_put = getattr(store, "async_put", None)
        if async_put is not None:
            blob_hash = await async_put(content)
        else:
            import asyncio
            blob_hash = await asyncio.to_thread(store.put, content)
        return BlobRef(hash=blob_hash, size=len(content))

    async def bulk_write_refs(
        self,
        project_id: str,
        file_refs: dict[str, BlobRef],
        who: str,
        scope: str = "",
        deleted: list[str] | None = None,
        message: str = "",
        verify_blobs: bool = True,
    ) -> WriteResult:
        """Commit a tree update referencing already-staged blobs by hash.

        Same scope-routing semantics as ``bulk_write``: paths are
        bucketed by their narrowest containing MUT scope and one
        commit is emitted per scope.

        **Caller contract**: every ``BlobRef.hash`` MUST already be
        present in the project's ObjectStore. The default
        ``verify_blobs=True`` does a HEAD round-trip per ref before
        constructing the commit — failing loud if any blob is
        missing. This is the safety net that makes "dangling commit"
        impossible in practice. Set ``verify_blobs=False`` only when
        the caller has independently confirmed all blobs are present
        in the same transaction (e.g. CLI ``/push`` after
        ``async_put_many``) and wants to skip the HEAD latency on a
        large batch.

        Compared to ``bulk_write(files: dict[str, bytes])``: this
        skips the per-blob ``store.put`` round-trip — the bytes
        never enter the Python process. For a 100-file folder
        upload at typical web-PDF sizes, that's the difference
        between holding ~500 MB in RAM (and ~5 seconds of S3
        re-download) and holding zero.
        """
        clean = {validate_path(k): v for k, v in file_refs.items()}
        clean_del = [validate_path(p) for p in (deleted or [])]

        if verify_blobs and clean:
            await self._verify_blobs_present(project_id, clean.values())

        if scope:
            return await self._bulk_write_refs_in_scope(
                project_id, scope, clean, clean_del, who, message,
            )

        write_groups = self._group_paths_by_scope(
            project_id, list(clean.keys()),
        )
        del_groups = self._group_paths_by_scope(project_id, clean_del)
        all_scopes = set(write_groups.keys()) | set(del_groups.keys())

        first_result: WriteResult | None = None
        for target_scope in all_scopes:
            rel_refs = {
                rel: clean[self._join_scope_path(target_scope, rel)]
                for rel in write_groups.get(target_scope, [])
            }
            rel_dels = del_groups.get(target_scope, [])
            r = await self._bulk_write_refs_in_scope(
                project_id, target_scope,
                rel_refs, rel_dels, who, message,
            )
            first_result = first_result or r
        return first_result or WriteResult(
            paths=list(clean.keys()) + clean_del,
        )

    async def _bulk_write_refs_in_scope(
        self,
        project_id: str,
        scope: str,
        rel_refs: dict[str, BlobRef],
        rel_dels: list[str],
        who: str,
        message: str,
    ) -> WriteResult:
        ops: list[tuple] = []
        ops.extend(
            ("put_ref", path, ref.hash) for path, ref in rel_refs.items()
        )
        ops.extend(("rm", path) for path in rel_dels)
        if not ops:
            return WriteResult()

        def splice_fn(store, root_hash):
            return splice_batch(store, root_hash, ops)

        total_size = sum(r.size for r in rel_refs.values())
        result = await apply_mutation(
            self._repos, project_id, scope, splice_fn,
            who=who,
            message=message or f"bulk write {len(rel_refs)} files",
            op_type="bulk_write",
            audit_detail={
                "writes": len(rel_refs),
                "deletes": len(rel_dels),
                "total_size": total_size,
            },
        )
        full_paths = [
            self._join_scope_path(scope, p)
            for p in list(rel_refs.keys()) + rel_dels
        ]
        return _to_result(result, full_paths)

    async def _verify_blobs_present(
        self,
        project_id: str,
        refs,  # Iterable[BlobRef]
    ) -> None:
        """Confirm every ``BlobRef.hash`` is present in the project's
        ObjectStore. Raises ``MissingBlobError`` on the first gap.

        Each check is a HEAD round-trip. We deduplicate hashes
        first (the same blob can land at multiple paths in one
        commit, e.g. dropping a folder with duplicate PDFs) so the
        worst case is ``O(unique_blobs)`` HEADs, not ``O(paths)``.

        The verification is a safety net, not a correctness
        requirement: the read path verifies ``hash_bytes(get(h))
        == h`` on every fetch (see ``ObjectStore.get``), so a
        missing blob produces a fail-loud ``ObjectNotFoundError``
        at read time, never silent corruption. We HEAD here only
        to reject the commit BEFORE history / audit fire — much
        easier to recover from than discovering at read time.
        """
        unique_hashes = {ref.hash for ref in refs if ref.hash}
        if not unique_hashes:
            return

        repo = self._repos.get_server_repo(project_id)
        store = repo.store
        async_exists_many = getattr(store, "async_exists_many", None)
        if async_exists_many is not None:
            ordered_hashes = sorted(unique_hashes)
            existing_hashes = await async_exists_many(ordered_hashes)
            missing = [h for h in ordered_hashes if h not in existing_hashes]
            if missing:
                h = missing[0]
                raise MissingBlobError(
                    f"blob {h[:12]}… not present in project {project_id}'s "
                    f"object store; refusing to commit a dangling tree"
                )
            return

        # ``async_exists`` is the abstract interface; concrete S3
        # backends expose ``async_exists_many`` above for bounded
        # parallel HEADs. Fall back to one-by-one checks for in-memory
        # or third-party stores.
        async_exists = getattr(store, "async_exists", None)
        for h in sorted(unique_hashes):
            if async_exists is not None:
                exists = await async_exists(h)
            else:
                import asyncio
                exists = await asyncio.to_thread(store.exists, h)
            if not exists:
                raise MissingBlobError(
                    f"blob {h[:12]}… not present in project {project_id}'s "
                    f"object store; refusing to commit a dangling tree"
                )

    async def trash(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Soft-delete: move to ``.trash/{basename}_{timestamp}``.

        For folders, the entire subtree is moved by hash — no blob
        contents are downloaded.
        """
        path = validate_path(path)
        basename = path.rsplit("/", 1)[-1] if "/" in path else path

        if scope:
            target_scope, rel_path = scope, path
        else:
            target_scope, rel_path = self._select_write_scope(project_id, path)

        trash_rel = f".trash/{basename}_{int(time.time())}"
        trash_full = self._join_scope_path(target_scope, trash_rel)

        def splice_fn(store, root_hash):
            return splice_move(store, root_hash, rel_path, trash_rel)

        result = await apply_mutation(
            self._repos, project_id, target_scope, splice_fn,
            who=who,
            message=message or f"trash {basename}",
            op_type="trash",
            audit_detail={"path": path, "trash_path": trash_full},
        )
        return _to_result(result, [path, trash_full])

    async def bulk_trash(
        self,
        project_id: str,
        paths: list[str],
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Soft-delete multiple files/folders in one commit per scope.

        Each path is moved to ``.trash/{basename}_{timestamp}`` within
        the scope it belongs to. When two selected items share a
        basename (e.g. ``/a/foo.md`` + ``/b/foo.md``), the second is
        suffixed ``_2`` etc. so they don't overwrite each other.
        Cross-scope batches split into one commit per scope (same rule
        as ``delete`` and ``bulk_write``).
        """
        if not paths:
            return WriteResult()

        clean = [validate_path(p) for p in paths]
        timestamp = int(time.time())

        if scope:
            return await self._bulk_trash_in_scope(
                project_id, scope, clean, who, message, timestamp,
            )

        groups = self._group_paths_by_scope(project_id, clean)
        first_result: WriteResult | None = None
        for target_scope, rel_paths in groups.items():
            r = await self._bulk_trash_in_scope(
                project_id, target_scope, rel_paths, who, message, timestamp,
            )
            first_result = first_result or r
        return first_result or WriteResult(paths=clean)

    async def _bulk_trash_in_scope(
        self,
        project_id: str,
        scope: str,
        rel_paths: list[str],
        who: str,
        message: str,
        timestamp: int,
    ) -> WriteResult:
        ops: list[tuple] = []
        trash_full_paths: list[str] = []
        seen: dict[str, int] = {}
        for rel in rel_paths:
            basename = rel.rsplit("/", 1)[-1] if "/" in rel else rel
            base_trash = f".trash/{basename}_{timestamp}"
            count = seen.get(base_trash, 0)
            seen[base_trash] = count + 1
            trash_rel = (
                base_trash if count == 0 else f"{base_trash}_{count + 1}"
            )
            ops.append(("mv", rel, trash_rel))
            trash_full_paths.append(
                self._join_scope_path(scope, trash_rel),
            )

        if not ops:
            return WriteResult()

        def splice_fn(store, root_hash):
            return splice_batch(store, root_hash, ops)

        result = await apply_mutation(
            self._repos, project_id, scope, splice_fn,
            who=who,
            message=message or f"trash {len(rel_paths)} items",
            op_type="bulk_trash",
            audit_detail={
                "paths": rel_paths,
                "trash_paths": trash_full_paths,
            },
        )
        original_full_paths = [
            self._join_scope_path(scope, p) for p in rel_paths
        ]
        return _to_result(
            result, original_full_paths + trash_full_paths,
        )

    async def restore(
        self,
        project_id: str,
        trash_path: str,
        original_path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Restore from ``.trash`` back to the original path.

        Both paths must live in the same scope (trash lives inside
        each scope). Cross-scope restore is rejected — the caller
        must move the entry across scopes via a separate explicit op.
        """
        trash_path = validate_path(trash_path)
        original_path = validate_path(original_path)

        if scope:
            trash_scope, trash_rel = scope, trash_path
            orig_scope, orig_rel = scope, original_path
        else:
            trash_scope, trash_rel = self._select_write_scope(
                project_id, trash_path,
            )
            orig_scope, orig_rel = self._select_write_scope(
                project_id, original_path,
            )

        if trash_scope != orig_scope:
            raise ValueError(
                f"cross-scope restore not supported: "
                f"trash={trash_path!r} (scope={trash_scope!r}) → "
                f"original={original_path!r} (scope={orig_scope!r})",
            )

        def splice_fn(store, root_hash):
            return splice_move(store, root_hash, trash_rel, orig_rel)

        result = await apply_mutation(
            self._repos, project_id, trash_scope, splice_fn,
            who=who,
            message=message or f"restore {original_path}",
            op_type="restore",
            audit_detail={
                "trash_path": trash_path,
                "original_path": original_path,
            },
        )
        return _to_result(result, [original_path, trash_path])

    async def permanent_delete(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
    ) -> WriteResult:
        """Hard-delete a file or folder (no trash).

        Files are removed by unlinking the entry; folders drop the
        whole subtree pointer in one tree write — no recursive blob
        downloads.
        """
        path = validate_path(path)
        if scope:
            target_scope, rel_path = scope, path
        else:
            target_scope, rel_path = self._select_write_scope(project_id, path)

        def splice_fn(store, root_hash):
            return splice_remove(store, root_hash, [rel_path])

        result = await apply_mutation(
            self._repos, project_id, target_scope, splice_fn,
            who=who,
            message=message or f"delete {path}",
            op_type="permanent_delete",
            audit_detail={"path": path},
        )
        return _to_result(result, [path])

    # ══════════════════════════════════════════════
    # Read operations (sync — direct Merkle tree reads)
    # ══════════════════════════════════════════════

    def read_file(self, project_id: str, path: str) -> bytes:
        return self._reader.read_file(project_id, path.strip("/"))

    def list_dir(self, project_id: str, path: str = "") -> list[MutEntry]:
        return self._reader.list_dir(project_id, path.strip("/"))

    def list_tree(
        self, project_id: str, path: str = "", max_depth: int = -1,
    ) -> list[MutEntry]:
        return self._reader.list_tree(
            project_id, path.strip("/"), max_depth=max_depth,
        )

    def stat(self, project_id: str, path: str) -> MutEntry | None:
        return self._reader.stat(project_id, path.strip("/"))

    def get_head_commit_id(self, project_id: str) -> str:
        return self._reader.get_head_commit_id(project_id)

    def get_root_hash(self, project_id: str) -> str:
        return self._reader.get_root_hash(project_id)

    # ══════════════════════════════════════════════
    # External-callers shim
    # ══════════════════════════════════════════════

    def push_and_finalize(self, project_id: str, push_result: dict) -> dict:
        """Run post-push hooks after any push.

        Used by the MUT protocol router (``/api/v1/mut/*``) to graft
        external CLI/sync pushes into the global root hash. Internal
        typed ops run the hook themselves via ``direct_writer`` and
        do not need this entry point.
        """
        from src.mut_engine.services.hooks import run_post_push_hook

        run_post_push_hook(project_id, self._repos, push_result)
        return push_result

    def _run_post_push_hook(
        self, project_id: str, push_result: dict,
    ) -> None:
        """Best-effort post-push hook — log on failure, never re-raise.

        ``direct_writer.apply_mutation`` already does this internally,
        so internal typed ops don't reach here. This shim exists for
        external callers (and tests) that want the same resilience
        without writing the try/except themselves.
        """
        try:
            from src.mut_engine.services.hooks import run_post_push_hook

            run_post_push_hook(project_id, self._repos, push_result)
        except Exception as e:
            import traceback

            from src.utils.logger import log_error

            commit_id = (
                push_result.get("commit_id")
                or push_result.get("new_commit_id")
            )
            log_error(
                f"[MutOps] post-push hook failed for project={project_id} "
                f"commit={commit_id} "
                f"scope={push_result.get('scope_path', '?')} "
                f"status={push_result.get('status', '?')} "
                f"error={type(e).__name__}: {e}\n{traceback.format_exc()}",
            )

    # ══════════════════════════════════════════════
    # Scope routing helpers
    # ══════════════════════════════════════════════

    def _select_write_scope(
        self, project_id: str, path: str,
    ) -> tuple[str, str]:
        """Pick the narrowest existing MUT scope that contains ``path``.

        Web UI operations pass project-root paths.  If a folder belongs
        to a narrower access point scope, writing against that scope
        avoids cloning and rebuilding the whole project root for every
        write/delete, AND — critically — keeps the write visible after
        graft.

        ``graft_subtree`` builds ``mut_root_hash`` by overlaying every
        sub-scope's tree at its declared path on top of the root
        scope's tree. A write into the root scope at a path that
        belongs to a sub-scope is wholesale REPLACED by the sub-scope's
        tree during that overlay — the commit lands but the read path
        never sees it. Writing into the narrowest scope that contains
        the path makes that scope the canonical source for the
        subtree, so graft preserves the write.
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
        write only carries the paths that belong to it. Empty
        ``scope_path`` means root scope — paths that no narrower scope
        claims end up there.
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


# ══════════════════════════════════════════════════
# Internal helpers
# ══════════════════════════════════════════════════


def _to_result(
    raw,
    paths: list[str] | None = None,
) -> WriteResult:
    """Translate ``direct_writer.WriteResult`` into the legacy ``MutOps``
    ``WriteResult`` shape.

    The two dataclasses already match field-for-field — this function
    exists so a future schema change in ``direct_writer`` can be
    absorbed without touching every call site, and so we can override
    the ``paths`` list with the caller's preferred presentation
    (e.g. trash returns ``[original, trash_path]`` rather than the
    full splice changes set).
    """
    return WriteResult(
        commit_id=raw.commit_id,
        status=raw.status,
        merged=raw.merged,
        conflicts=raw.conflicts,
        paths=paths if paths is not None else list(raw.paths),
    )

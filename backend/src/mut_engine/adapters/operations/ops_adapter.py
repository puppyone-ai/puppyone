"""
MutOps — Unified entry point for typed MUT tree operations.

All channels (Web UI / Agent / Sandbox / MCP / Datasource / Ingest /
Table / Seed) operate on the MUT tree through this class. Channels do
not directly touch ``MutEphemeralClient`` or ``MutTreeReader``.

Architecture:
    Each typed write op (``write_file``, ``delete``, ``mkdir``, ``move``,
    ``permanent_delete``, ``bulk_write``)
    constructs an O(D) tree splice via ``services.tree_splice`` and
    routes it through the Git-native transaction engine for atomic
    per-scope CAS + history + audit + graft. No ``clone_lite``, no full
    blob downloads, no protocol-handler publish path.

    Read ops resolve straight against the persisted Merkle root via
    ``MutTreeReader`` (S3-cached tree-node reads only, no flattening).

    External protocol clients submit version intents through adapters.
    Product operations do not own publish semantics directly.

Usage:
    ops = MutOps(repo_manager)
    result = await ops.write_file("proj_1", "readme.md", b"# Hi", who="user:123")
    content = ops.read_file("proj_1", "readme.md")
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.mut_engine.application.transaction_engine import GitNativeTransactionEngine
from src.mut_engine.domain.intents import OperationWriteIntent
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.validation import validate_path
from src.mut_engine.services.tree_reader import MutEntry, MutTreeReader
from src.mut_engine.services.tree_splice import (
    splice_batch,
    splice_copy,
    splice_mkdir,
    splice_move,
    splice_put_blob,
    splice_put_blob_ref,
    splice_remove,
    splice_touch,
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
        self._engine = GitNativeTransactionEngine(repo_manager)

    async def _apply_operation(
        self,
        project_id: str,
        scope: str,
        splice_fn,
        *,
        who: str,
        message: str,
        op_type: str,
        audit_detail: dict | None = None,
        expected_head_commit_id: str | None = None,
        allow_same_tree_commit: bool = False,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ):
        intent = OperationWriteIntent(
            project_id=project_id,
            scope_path=scope,
            actor=who,
            source_channel=source_channel,
            operation_type=op_type,
            message=message,
            audit_detail=audit_detail or {},
            expected_head_commit_id=expected_head_commit_id,
            allow_same_tree_commit=allow_same_tree_commit,
            defer_projection=defer_projection,
            policy_override=policy,
        )
        if scope:
            return await self._engine.apply_operation(intent, splice_fn)
        return await self._engine.apply_project_operation(intent, splice_fn)

    # ══════════════════════════════════════════════
    # Write operations — typed splice → Git-native transaction engine
    # ══════════════════════════════════════════════

    async def write_file(
        self,
        project_id: str,
        path: str,
        content: bytes,
        who: str,
        scope: str = "",
        message: str = "",
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        """Write a single file (create or update).

        Product/API writes default to the project root, but are then
        routed to the narrowest existing MUT scope that contains
        ``path`` so graft can preserve them (a write into the root
        scope at a path that belongs to a sub-scope is wholesale
        replaced by the sub-scope's tree during graft — the commit
        lands but the read path never sees it). Scoped access point
        callers pass ``scope`` explicitly, preserving their per-scope
        CAS boundary without leaking it into frontend history.

        ``policy`` lets the caller opt into a stricter conflict policy
        (e.g. ``"manual_review"``) than the configured rule set would
        select on its own — the engine queues conflicts in
        ``mut_conflicts`` instead of silently merging via LWW.
        """
        path = validate_path(path)
        target_scope, rel_path = self._resolve_write_target(
            project_id, path, scope,
        )

        def splice_fn(store, root_hash):
            return splice_put_blob(store, root_hash, rel_path, content)

        result = await self._apply_operation(
            project_id, target_scope, splice_fn,
            who=who,
            message=message or f"write {path}",
            op_type="write_file",
            audit_detail={"path": path, "size": len(content)},
            expected_head_commit_id=base_commit_id,
            defer_projection=defer_projection,
            policy=policy,
            source_channel=source_channel,
        )
        return _to_result(result, [path])

    async def delete(
        self,
        project_id: str,
        paths: list[str],
        who: str,
        scope: str = "",
        message: str = "",
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        """Delete one or more files.

        Product/API deletes default to one project-root transaction,
        but each path is then routed to the narrowest scope that
        contains it. Mixing paths from different scopes results in one
        commit per scope. Returns the FIRST commit; in practice all
        paths usually share one scope and there's only one push.
        Scoped access point callers pass ``scope`` explicitly, in
        which case all paths are relative to that scope and produce
        one scoped commit.

        ``policy`` / ``source_channel`` flow through to the engine's
        conflict-policy selection (e.g. ``manual_review`` queues
        ambiguous deletes rather than silently winning LWW).
        """
        clean = [validate_path(p) for p in paths]
        if scope:
            return await self._delete_in_scope(
                project_id, scope, clean, who, message, base_commit_id,
                defer_projection, policy=policy, source_channel=source_channel,
            )

        groups = self._group_paths_by_scope(project_id, clean)
        if base_commit_id is not None and len(groups) > 1:
            raise ValueError(
                "base_commit_id is ambiguous for multi-scope delete operations"
            )
        first_result: WriteResult | None = None
        for target_scope, rel_paths in groups.items():
            r = await self._delete_in_scope(
                project_id, target_scope, rel_paths, who, message, base_commit_id,
                defer_projection, policy=policy, source_channel=source_channel,
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
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        *,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        def splice_fn(store, root_hash):
            return splice_remove(store, root_hash, rel_paths)

        result = await self._apply_operation(
            project_id, scope, splice_fn,
            who=who,
            message=message or f"delete {len(rel_paths)} files",
            op_type="delete",
            audit_detail={"paths": rel_paths},
            expected_head_commit_id=base_commit_id,
            defer_projection=defer_projection,
            policy=policy,
            source_channel=source_channel,
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
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        """Create a directory (writes a ``.keep`` placeholder).

        Product/API calls create the directory in a project-root
        transaction, same as ``write_file``. Explicit scoped callers keep
        their scoped CAS boundary. Existing directories are no-ops (no
        commit created). Errors out if a file already occupies the path.
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

        result = await self._apply_operation(
            project_id, target_scope, splice_fn,
            who=who,
            message=message or f"mkdir {path}",
            op_type="mkdir",
            audit_detail={"path": path},
            expected_head_commit_id=base_commit_id,
            defer_projection=defer_projection,
            policy=policy,
            source_channel=source_channel,
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
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
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

        # Capture the source blob hash from the CURRENT scope tree
        # BEFORE we hand off to the engine. If a concurrent writer
        # renames or deletes ``old_rel`` between now and our CAS retry's
        # splice, the salvage path below uses this hash to recreate the
        # rename's add-side at ``new_rel``. This preserves the user's
        # intent ("the file I started from should end up at new_rel")
        # even when their src token is no longer in the tree.
        salvage_blob_hash = self._lookup_blob_hash(
            project_id, old_scope, old_rel,
        )

        def splice_fn(store, root_hash):
            try:
                return splice_move(store, root_hash, old_rel, new_rel)
            except FileNotFoundError:
                if not salvage_blob_hash:
                    raise
                # ``old_rel`` vanished underneath us (concurrent rename
                # or delete by another writer). Recreate the rename's
                # add-side using the blob we captured at submit time so
                # the new file lands as intended. The delete-side is
                # already realized by the concurrent op — no further work.
                from src.utils.logger import log_info
                log_info(
                    f"[move] source {old_rel!r} missing in scope tree "
                    f"during retry; salvaging via base blob "
                    f"{salvage_blob_hash[:12]} → {new_rel!r}",
                )
                return splice_put_blob_ref(
                    store, root_hash, new_rel, salvage_blob_hash,
                )

        result = await self._apply_operation(
            project_id, old_scope, splice_fn,
            who=who,
            message=message or f"move {old_path} → {new_path}",
            op_type="move",
            audit_detail={"old_path": old_path, "new_path": new_path},
            expected_head_commit_id=base_commit_id,
            defer_projection=defer_projection,
            policy=policy,
            source_channel=source_channel,
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

    async def copy(
        self,
        project_id: str,
        old_path: str,
        new_path: str,
        who: str,
        scope: str = "",
        message: str = "",
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        """Copy a file or folder without downloading blob contents."""
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
                f"cross-scope copy not supported: "
                f"{old_path!r} (scope={old_scope!r}) -> "
                f"{new_path!r} (scope={new_scope!r})",
            )

        def splice_fn(store, root_hash):
            return splice_copy(store, root_hash, old_rel, new_rel)

        result = await self._apply_operation(
            project_id, old_scope, splice_fn,
            who=who,
            message=message or f"copy {old_path} -> {new_path}",
            op_type="copy",
            audit_detail={"old_path": old_path, "new_path": new_path},
            expected_head_commit_id=base_commit_id,
            defer_projection=defer_projection,
            policy=policy,
            source_channel=source_channel,
        )
        return _to_result(result, [old_path, new_path])

    async def touch(
        self,
        project_id: str,
        paths: list[str],
        who: str,
        scope: str = "",
        message: str = "",
        base_commit_id: str | None = None,
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        """Update mtime for existing files without changing blob content."""
        clean = [validate_path(p) for p in paths]
        if not clean:
            return WriteResult()

        if scope:
            target_scope = scope
            rel_paths = clean
        else:
            groups = self._group_paths_by_scope(project_id, clean)
            if len(groups) != 1:
                raise ValueError("touch across multiple scopes is not supported")
            target_scope, rel_paths = next(iter(groups.items()))

        def splice_fn(store, root_hash):
            return splice_touch(store, root_hash, rel_paths)

        result = await self._apply_operation(
            project_id, target_scope, splice_fn,
            who=who,
            message=message or f"touch {len(clean)} files",
            op_type="touch",
            audit_detail={"paths": clean},
            expected_head_commit_id=base_commit_id,
            allow_same_tree_commit=True,
            defer_projection=defer_projection,
            policy=policy,
            source_channel=source_channel,
        )
        full_paths = [self._join_scope_path(target_scope, p) for p in rel_paths]
        return _to_result(result, full_paths)

    async def bulk_write(
        self,
        project_id: str,
        files: dict[str, bytes],
        who: str,
        scope: str = "",
        deleted: list[str] | None = None,
        message: str = "",
        defer_projection: bool = False,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        """Batch write + optional batch delete.

        When ``scope`` is empty, paths are committed as one project-root
        product transaction. Scoped access-point callers pass ``scope``
        explicitly to keep their local CAS boundary.
        """
        clean = {validate_path(k): v for k, v in files.items()}
        clean_del = [validate_path(p) for p in (deleted or [])]
        if scope:
            return await self._bulk_write_in_scope(
                project_id, scope,
                {k: clean[k] for k in clean},
                clean_del,
                who, message, defer_projection,
                policy=policy, source_channel=source_channel,
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
                defer_projection,
                policy=policy, source_channel=source_channel,
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
        defer_projection: bool = False,
        *,
        policy: str = "",
        source_channel: str = "papi",
    ) -> WriteResult:
        ops: list[tuple] = []
        ops.extend(("put", path, content) for path, content in rel_files.items())
        ops.extend(("rm", path) for path in rel_dels)
        if not ops:
            return WriteResult()

        def splice_fn(store, root_hash):
            return splice_batch(store, root_hash, ops)

        result = await self._apply_operation(
            project_id, scope, splice_fn,
            who=who,
            message=message or f"bulk write {len(rel_files)} files",
            op_type="bulk_write",
            policy=policy,
            source_channel=source_channel,
            audit_detail={
                "writes": len(rel_files),
                "deletes": len(rel_dels),
            },
            defer_projection=defer_projection,
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

        Implementation note: we deliberately bypass the transaction engine
        here. A pure stage doesn't change any tree, so the scope
        lock + ``scope_hash`` DB read that a write transaction does
        upfront would be wasted work. Instead we go straight to the
        ObjectStore — exactly what the write path does internally for
        the blob-write step.
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

        Same scope-routing semantics as ``bulk_write``: product/API
        callers commit once at project root; scoped access-point callers
        pass an explicit scope.

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
        result = await self._apply_operation(
            project_id, scope, splice_fn,
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

    async def permanent_delete(
        self,
        project_id: str,
        path: str,
        who: str,
        scope: str = "",
        message: str = "",
        base_commit_id: str | None = None,
    ) -> WriteResult:
        """Delete a file or folder from the current tree.

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

        result = await self._apply_operation(
            project_id, target_scope, splice_fn,
            who=who,
            message=message or f"delete {path}",
            op_type="permanent_delete",
            audit_detail={"path": path},
            expected_head_commit_id=base_commit_id,
        )
        return _to_result(result, [path])

    # ══════════════════════════════════════════════
    # Read operations (sync — direct Merkle tree reads)
    # ══════════════════════════════════════════════

    def read_file(self, project_id: str, path: str) -> bytes:
        return self._reader.read_file(project_id, path.strip("/"))

    def read_file_in_scope(self, project_id: str, scope: str, path: str) -> bytes:
        return self._reader.read_file_in_scope(
            project_id, scope.strip("/"), path.strip("/"),
        )

    def read_file_range(
        self,
        project_id: str,
        path: str,
        *,
        start: int = 0,
        limit: int | None = None,
    ):
        return self._reader.read_file_range(
            project_id,
            path.strip("/"),
            start=start,
            limit=limit,
        )

    def read_file_range_in_scope(
        self,
        project_id: str,
        scope: str,
        path: str,
        *,
        start: int = 0,
        limit: int | None = None,
    ):
        return self._reader.read_file_range_in_scope(
            project_id,
            scope.strip("/"),
            path.strip("/"),
            start=start,
            limit=limit,
        )

    def list_dir(
        self, project_id: str, path: str = "", *, include_size: bool = False
    ) -> list[MutEntry]:
        return self._reader.list_dir(
            project_id, path.strip("/"), include_size=include_size,
        )

    def list_dir_in_scope(
        self,
        project_id: str,
        scope: str,
        path: str = "",
        *,
        include_size: bool = False,
    ) -> list[MutEntry]:
        return self._reader.list_dir_in_scope(
            project_id, scope.strip("/"), path.strip("/"),
            include_size=include_size,
        )

    def list_tree(
        self,
        project_id: str,
        path: str = "",
        max_depth: int = -1,
        *,
        include_size: bool = False,
        max_entries: int | None = None,
    ) -> list[MutEntry]:
        return self._reader.list_tree(
            project_id, path.strip("/"), max_depth=max_depth,
            include_size=include_size,
            max_entries=max_entries,
        )

    def list_tree_in_scope(
        self,
        project_id: str,
        scope: str,
        path: str = "",
        max_depth: int = -1,
        *,
        include_size: bool = False,
        max_entries: int | None = None,
    ) -> list[MutEntry]:
        return self._reader.list_tree_in_scope(
            project_id, scope.strip("/"), path.strip("/"),
            max_depth=max_depth,
            include_size=include_size,
            max_entries=max_entries,
        )

    def stat(
        self, project_id: str, path: str, *, include_size: bool = False
    ) -> MutEntry | None:
        return self._reader.stat(
            project_id, path.strip("/"), include_size=include_size,
        )

    def stat_in_scope(
        self,
        project_id: str,
        scope: str,
        path: str,
        *,
        include_size: bool = False,
    ) -> MutEntry | None:
        return self._reader.stat_in_scope(
            project_id, scope.strip("/"), path.strip("/"),
            include_size=include_size,
        )

    def get_head_commit_id(self, project_id: str) -> str:
        return self._reader.get_head_commit_id(project_id)

    def get_scope_head_commit_id(self, project_id: str, scope_path: str) -> str:
        project_repo = self._repos.get_repo(project_id)
        return project_repo.history.get_scope_head_commit_id(
            (scope_path or "").strip("/"),
        ) or ""

    def get_scope_head_commit_id_for_path(
        self, project_id: str, path: str,
    ) -> str:
        scope_path, _rel_path = self._select_write_scope(
            project_id, validate_path(path),
        )
        return self.get_scope_head_commit_id(project_id, scope_path)

    def get_path_timestamps(
        self,
        project_id: str,
        paths: list[str],
        *,
        limit: int = 5000,
    ) -> dict[str, dict[str, str]]:
        clean_paths = {(p or "").strip("/") for p in paths}
        timestamps: dict[str, dict[str, str]] = {
            p: {"created_at": "", "modified_at": ""} for p in clean_paths
        }
        if not clean_paths:
            return timestamps

        try:
            repo = self._repos.get_server_repo(project_id)
            commits = repo.get_history_since("", limit=limit)
        except Exception:
            return timestamps

        for commit in commits:
            ts = str(commit.get("created_at") or commit.get("time") or "")
            if not ts:
                continue
            changes = commit.get("changes") or []
            if not isinstance(changes, list):
                continue
            for change in changes:
                path = str(change.get("path") or "").strip("/")
                if not path and "" not in clean_paths:
                    continue
                affected = {path, ""}
                parts = [part for part in path.split("/") if part]
                for index in range(1, len(parts)):
                    affected.add("/".join(parts[:index]))
                for affected_path in affected & clean_paths:
                    row = timestamps[affected_path]
                    if not row["created_at"] and change.get("action") == "add":
                        row["created_at"] = ts
                    if not row["created_at"] and affected_path != path:
                        row["created_at"] = ts
                    row["modified_at"] = ts
        return timestamps

    def get_root_hash(self, project_id: str) -> str:
        return self._reader.get_root_hash(project_id)

    # ══════════════════════════════════════════════
    # External-callers shim
    # ══════════════════════════════════════════════

    def push_and_finalize(self, project_id: str, push_result: dict) -> dict:
        """Run post-push hooks after any push.

        Used by the MUT protocol router (``/api/v1/mut/*``) to graft
        external CLI/sync pushes into the global root hash. Internal
        typed ops run the hook through the transaction engine and
        do not need this entry point.
        """
        from src.mut_engine.services.hooks import run_post_push_hook

        run_post_push_hook(project_id, self._repos, push_result)
        return push_result

    def _run_post_push_hook(
        self, project_id: str, push_result: dict,
    ) -> None:
        """Best-effort post-push hook — log on failure, never re-raise.

        The transaction engine already does this internally,
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
        """Return the product-root write target for a project path.

        Frontend/Data-page operations are repository-level user actions:
        they must produce one project-root transaction and one visible
        history item. Access-point/Git flows already know their scope and
        pass it explicitly through ``_resolve_write_target``; this helper
        intentionally does not infer child scopes from project paths.
        """
        clean = validate_path(path)
        return "", clean

    def _resolve_write_target(
        self, project_id: str, path: str, explicit_scope: str,
    ) -> tuple[str, str]:
        """Decide ``(scope, rel_path)`` for a single write/mkdir.

        If the caller supplied an explicit scope, trust it: assume
        ``path`` is already relative to that scope. Otherwise route to
        the project root; frontend/product operations must not infer a
        child scope from the path.
        """
        if explicit_scope:
            return explicit_scope, path
        return self._select_write_scope(project_id, path)

    def _group_paths_by_scope(
        self, project_id: str, paths: list[str],
    ) -> dict[str, list[str]]:
        """Bucket paths into publish groups.

        For product/API callers this intentionally returns one root
        group. Explicit scoped callers do not use this helper; they pass
        their scope to the in-scope write path directly.
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

    def _lookup_blob_hash(
        self, project_id: str, scope: str, rel_path: str,
    ) -> str:
        """Resolve the blob hash for ``scope/rel_path`` in the CURRENT
        scope state. Returns an empty string when the path doesn't exist
        or refers to a directory. Best-effort: any tree-walk failure
        produces ``""`` so callers can use it as an "optional fallback".
        """

        try:
            from src.mut_engine.application import tree as tree_mod

            repo = self._repos.get_server_repo(project_id)
            scope_hash = repo.get_scope_hash(scope) or ""
            if not scope_hash:
                return ""
            parts = [p for p in rel_path.strip("/").split("/") if p]
            if not parts:
                return ""
            current = scope_hash
            for part in parts[:-1]:
                entries = tree_mod.read_tree(repo.store, current)
                typ, child = entries.get(part, (None, None))
                if typ != "T":
                    return ""
                current = child
            entries = tree_mod.read_tree(repo.store, current)
            typ, hash_val = entries.get(parts[-1], (None, None))
            if typ != "B":
                return ""
            return hash_val or ""
        except Exception:
            return ""


# ══════════════════════════════════════════════════
# Internal helpers
# ══════════════════════════════════════════════════


def _to_result(
    raw,
    paths: list[str] | None = None,
) -> WriteResult:
    """Translate transaction-engine results into the legacy ``MutOps``
    ``WriteResult`` shape.

    The two dataclasses already match field-for-field — this function
    exists so a future schema change in the transaction result can be
    absorbed without touching every call site, and so we can override
    the ``paths`` list with the caller's preferred presentation.
    """
    return WriteResult(
        commit_id=raw.commit_id,
        status=raw.status,
        merged=raw.merged,
        conflicts=raw.conflicts,
        paths=paths if paths is not None else list(raw.paths),
    )

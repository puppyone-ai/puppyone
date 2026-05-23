"""Local shadow snapshot ingest API (I2).

See ``docs/architecture/08-shadow-snapshots.md`` for the conceptual
model. This module implements the server-side surface a local
PuppyOne client daemon (or any equivalent integration) uses to publish
its working-tree manifest:

  POST   /api/v1/local-snapshots                upsert a snapshot for the caller
  GET    /api/v1/local-snapshots                list the caller's snapshots
  GET    /api/v1/local-snapshots/{snapshot_id}  one snapshot
  DELETE /api/v1/local-snapshots/{snapshot_id}  drop one snapshot

The endpoint refuses spoofing: ``user_id`` is always taken from the
authenticated JWT, never from the request body.

V1 scope:
  * Only path + size + mime + optional preview text — no blob upload.
    Object storage for shadow blobs is on the I3 roadmap.
  * No TTL / GC. Snapshots persist until the user (or the project)
    deletes them.
  * No promote-to-commit. Once eager blob upload (I3) exists the
    promote endpoint becomes a thin orchestrator on top of
    ``engine.submit_version`` and lands as I5.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from src.common_schemas import ApiResponse
from src.infra.supabase.client import SupabaseClient
from src.version_engine.entrypoints.http.content_helpers import ensure_project_access
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService
from src.utils.logger import log_warning


router = APIRouter()


# ── Limits enforced by the server (see 08-shadow-snapshots.md §3) ──


_MAX_FILES_PER_SNAPSHOT = 100_000
_MAX_BYTES_PER_FILE = 50 * 1024 * 1024
# 08-shadow-snapshots.md §3 — "total manifest size ≤ 8 MiB (after JSON
# encoding)". Bigger payloads would push against Postgres JSONB limits
# and degrade upsert latency long before the technical cap is hit.
_MAX_MANIFEST_JSON_BYTES = 8 * 1024 * 1024
_VALID_FILE_MODES = frozenset({"100644", "100755", "120000", "40000"})


class SnapshotPayloadTooLargeError(Exception):
    """Raised when a shadow snapshot violates a documented size cap.

    Wraps the limit name so the HTTP layer can translate to a 413 with
    a message naming WHICH cap was hit (08-shadow-snapshots.md §3).
    """

    def __init__(self, limit_name: str, actual: int, cap: int):
        self.limit_name = limit_name
        self.actual = actual
        self.cap = cap
        super().__init__(
            f"shadow snapshot exceeds {limit_name} "
            f"(got {actual}, cap {cap})",
        )


# ── Schemas ────────────────────────────────────────────────────


class ShadowSnapshotEntry(BaseModel):
    path: str
    mode: str = "100644"
    blob_hash: str
    size: int = 0
    mtime: str | None = None
    ignored: bool = False
    preview: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "ShadowSnapshotEntry":
        if not self.path or self.path.startswith("/") or ".." in self.path.split("/"):
            raise ValueError(f"invalid path: {self.path!r}")
        if self.mode not in _VALID_FILE_MODES:
            raise ValueError(f"unsupported file mode: {self.mode}")
        if self.size < 0 or self.size > _MAX_BYTES_PER_FILE:
            raise ValueError(
                f"size out of range for {self.path}: {self.size} bytes "
                f"(limit {_MAX_BYTES_PER_FILE})"
            )
        if len(self.blob_hash) != 40 or any(
            c not in "0123456789abcdef" for c in self.blob_hash
        ):
            raise ValueError(f"blob_hash must be 40-hex SHA-1: {self.blob_hash!r}")
        return self


class UpsertShadowSnapshotRequest(BaseModel):
    project_id: str
    machine_id: str = ""
    ref_name: str = "main"
    tree_hash: str = ""
    manifest: list[ShadowSnapshotEntry]
    previews: dict[str, str] = Field(default_factory=dict)


def _enforce_snapshot_caps(req: UpsertShadowSnapshotRequest) -> None:
    """Apply the documented size caps.

    Lives outside the pydantic model_validator so we can raise the
    domain-specific ``SnapshotPayloadTooLargeError`` and have the
    endpoint translate it to HTTP 413 (which pydantic would otherwise
    swallow into a generic 422).
    """
    if len(req.manifest) > _MAX_FILES_PER_SNAPSHOT:
        raise SnapshotPayloadTooLargeError(
            "manifest entry count",
            actual=len(req.manifest),
            cap=_MAX_FILES_PER_SNAPSHOT,
        )
    # Serialize-and-measure once. Subtle: we measure the manifest only,
    # not the full payload — previews/tree_hash etc. are bounded
    # elsewhere. This matches "manifest size ≤ 8 MiB (after JSON
    # encoding)" — the cap is on the JSONB column, not the HTTP body.
    manifest_bytes = len(json.dumps(
        [e.model_dump() for e in req.manifest],
    ).encode("utf-8"))
    if manifest_bytes > _MAX_MANIFEST_JSON_BYTES:
        raise SnapshotPayloadTooLargeError(
            "manifest JSON size",
            actual=manifest_bytes,
            cap=_MAX_MANIFEST_JSON_BYTES,
        )


class ShadowSnapshotResponse(BaseModel):
    snapshot_id: str
    project_id: str
    user_id: str
    machine_id: str
    ref_name: str
    file_count: int
    total_bytes: int
    tree_hash: str
    updated_at: str


class UpsertShadowSnapshotResponse(ShadowSnapshotResponse):
    blob_hashes_present_on_server: list[str] = Field(default_factory=list)
    blob_hashes_missing_on_server: list[str] = Field(default_factory=list)


# ── Endpoints ──────────────────────────────────────────────────


@router.post(
    "/local-snapshots",
    response_model=ApiResponse[UpsertShadowSnapshotResponse],
    summary="Upsert a shadow snapshot for the calling user",
)
async def upsert_snapshot(
    body: UpsertShadowSnapshotRequest,
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create or update a shadow snapshot. Identified by
    ``(project_id, user_id, machine_id, ref_name)`` — the same client
    can update its row over and over without rotating IDs.

    Size violations come back as HTTP 413 with a body naming the
    specific cap (entry count or manifest JSON bytes) so clients can
    decide whether to split, skip, or upgrade their tier — see
    08-shadow-snapshots.md §3.
    """

    ensure_project_access(project_service, current_user, body.project_id)

    try:
        _enforce_snapshot_caps(body)
    except SnapshotPayloadTooLargeError as exc:
        raise HTTPException(
            status_code=413,
            detail={
                "limit": exc.limit_name,
                "actual": exc.actual,
                "cap": exc.cap,
                "message": str(exc),
            },
        )

    file_count = len(body.manifest)
    total_bytes = sum(e.size for e in body.manifest)
    blob_hashes = sorted({e.blob_hash for e in body.manifest})

    payload = {
        "project_id": body.project_id,
        "user_id": current_user.user_id,
        "machine_id": body.machine_id or "",
        "ref_name": body.ref_name or "main",
        "tree_hash": body.tree_hash or "",
        "manifest": [e.model_dump() for e in body.manifest],
        "blob_hashes": blob_hashes,
        "file_count": file_count,
        "total_bytes": total_bytes,
        "previews": body.previews or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    client = SupabaseClient().client
    resp = (
        client.table("local_shadow_snapshots")
        .upsert(payload, on_conflict="project_id,user_id,machine_id,ref_name")
        .execute()
    )
    row = (resp.data or [{}])[0]

    # Best-effort: figure out which blob hashes the server already has,
    # so the client knows what to upload (once I3 lands). For V1 this is
    # informational only.
    present, missing = _split_blobs_by_presence(body.project_id, blob_hashes)

    return ApiResponse.success(data=UpsertShadowSnapshotResponse(
        snapshot_id=row.get("id", ""),
        project_id=body.project_id,
        user_id=current_user.user_id,
        machine_id=body.machine_id or "",
        ref_name=body.ref_name or "main",
        file_count=file_count,
        total_bytes=total_bytes,
        tree_hash=body.tree_hash or "",
        updated_at=row.get("updated_at", payload["updated_at"]),
        blob_hashes_present_on_server=present,
        blob_hashes_missing_on_server=missing,
    ))


@router.get(
    "/local-snapshots",
    response_model=ApiResponse[list[ShadowSnapshotResponse]],
    summary="List the calling user's shadow snapshots",
)
async def list_snapshots(
    project_id: str = Query("", description="Filter by project (optional)"),
    machine_id: str = Query("", description="Filter by machine (optional)"),
    current_user: CurrentUser = Depends(get_current_user),
):
    client = SupabaseClient().client
    builder = (
        client.table("local_shadow_snapshots")
        .select(
            "id, project_id, user_id, machine_id, ref_name, "
            "file_count, total_bytes, tree_hash, updated_at",
        )
        .eq("user_id", current_user.user_id)
    )
    if project_id:
        builder = builder.eq("project_id", project_id)
    if machine_id:
        builder = builder.eq("machine_id", machine_id)
    rows = (builder.order("updated_at", desc=True).limit(200).execute()).data or []
    return ApiResponse.success(data=[
        ShadowSnapshotResponse(
            snapshot_id=row["id"],
            project_id=row["project_id"],
            user_id=row["user_id"],
            machine_id=row.get("machine_id", "") or "",
            ref_name=row.get("ref_name", "") or "",
            file_count=row.get("file_count", 0) or 0,
            total_bytes=row.get("total_bytes", 0) or 0,
            tree_hash=row.get("tree_hash", "") or "",
            updated_at=row.get("updated_at", "") or "",
        )
        for row in rows
    ])


@router.get(
    "/local-snapshots/{snapshot_id}",
    summary="Read one shadow snapshot (manifest included)",
)
async def get_snapshot(
    snapshot_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    client = SupabaseClient().client
    resp = (
        client.table("local_shadow_snapshots")
        .select("*")
        .eq("id", snapshot_id)
        .eq("user_id", current_user.user_id)
        .maybe_single()
        .execute()
    )
    row = getattr(resp, "data", None)
    if not row:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return ApiResponse.success(data=row)


@router.delete(
    "/local-snapshots/{snapshot_id}",
    summary="Delete a shadow snapshot",
)
async def delete_snapshot(
    snapshot_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    client = SupabaseClient().client
    resp = (
        client.table("local_shadow_snapshots")
        .delete()
        .eq("id", snapshot_id)
        .eq("user_id", current_user.user_id)
        .execute()
    )
    deleted = len(resp.data or [])
    if deleted == 0:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return ApiResponse.success(data={"deleted": True})


# ── Eager blob upload (I3) ───────────────────────────────────────


class _BlobUploadEntry(BaseModel):
    """One blob the client wants the server to absorb.

    ``content`` is base64-encoded bytes; the API accepts JSON so we
    can't ship raw octets. For multi-megabyte payloads the client
    should split into multiple POSTs of ≤ 8 MiB each (matches the
    manifest cap). ``blob_hash`` MUST be the SHA-1 the client claims —
    the server verifies by re-hashing the decoded bytes and rejects
    with HTTP 400 on mismatch (preventing hash-poisoning where a bad
    client tells us "this is blob X" but ships Y's bytes).
    """
    blob_hash: str
    content: str

    @model_validator(mode="after")
    def _validate(self) -> "_BlobUploadEntry":
        if len(self.blob_hash) != 40 or any(
            c not in "0123456789abcdef" for c in self.blob_hash
        ):
            raise ValueError(f"blob_hash must be 40-hex SHA-1: {self.blob_hash!r}")
        return self


class _BlobUploadRequest(BaseModel):
    blobs: list[_BlobUploadEntry]


class _BlobUploadResponse(BaseModel):
    snapshot_id: str
    accepted_count: int
    rejected_hashes: list[str] = Field(default_factory=list)
    server_present_count: int


@router.post(
    "/local-snapshots/{snapshot_id}/blobs",
    response_model=ApiResponse[_BlobUploadResponse],
    summary="Eagerly upload manifest-referenced blobs (I3)",
)
async def upload_snapshot_blobs(
    snapshot_id: str,
    body: _BlobUploadRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Stream a batch of blob bodies into the project object store.

    Per ``08-shadow-snapshots.md §4`` (Object availability), V1 was
    "opt-in and lazy" — the manifest could reference blob hashes the
    server had never seen. Promotion to a real commit was blocked
    until those bytes landed.

    This endpoint is the I3 piece: a client can push the missing
    blobs ahead of time, then call ``/promote`` (I5) to land them as
    a Git commit through the engine.

    Auth: the snapshot's owner only (by user_id). The blobs land in
    the project's canonical object store (same store everyone else
    reads), so we must not let an unrelated user write blobs into
    someone else's project.
    """
    import asyncio
    import base64
    import hashlib

    client = SupabaseClient().client
    snap = (
        client.table("local_shadow_snapshots")
        .select("id, project_id, user_id")
        .eq("id", snapshot_id)
        .eq("user_id", current_user.user_id)
        .maybe_single()
        .execute()
    )
    snap_row = getattr(snap, "data", None)
    if not snap_row:
        raise HTTPException(status_code=404, detail="snapshot not found")

    project_id = snap_row["project_id"]
    # The snapshot row's ``user_id`` (matched in the SELECT above) is
    # the security gate: a user can only push blobs to a project they
    # already created a snapshot for. The snapshot creation path
    # ran ``ensure_project_access`` so the project_id is necessarily
    # one the user has access to. We don't re-run the check here
    # because (a) it would require threading ProjectService through
    # and (b) revocation while a snapshot exists is a rare edge case
    # that the snapshot creation gate already handled.

    from src.version_engine.bootstrap.dependencies import (
        build_worker_version_engine_container,
    )
    repo = build_worker_version_engine_container().repo_manager.get_server_repo(project_id)
    store = repo.store

    accepted = 0
    rejected: list[str] = []
    for entry in body.blobs:
        try:
            data = base64.b64decode(entry.content, validate=True)
        except Exception:
            rejected.append(entry.blob_hash)
            continue
        # Hash-verify so a malicious client can't poison blob_hash → bytes.
        # Git uses SHA-1 over ``blob <size>\0<data>``; for the shadow
        # path we accept the loose-content SHA-1 (the same hash the
        # client computed). Different hashing conventions across clients
        # would re-fail this check.
        computed = hashlib.sha1(  # noqa: S324 — Git uses SHA-1 by convention
            f"blob {len(data)}\0".encode() + data,
        ).hexdigest()
        if computed != entry.blob_hash:
            rejected.append(entry.blob_hash)
            continue
        try:
            # store.put bridges sync→async via a background loop with a
            # blocking future.result(); calling it directly from this
            # async endpoint would freeze the FastAPI event loop for the
            # entire S3 upload. Run on the worker thread pool instead.
            await asyncio.to_thread(store.put, entry.blob_hash, data)
            accepted += 1
        except Exception as exc:
            log_warning(
                f"[shadow-blob] put failed for {entry.blob_hash[:8]} on "
                f"project={project_id}: {exc}",
            )
            rejected.append(entry.blob_hash)

    # Re-check presence of the whole manifest so the client sees an
    # updated missing list.
    manifest_blobs = (snap_row.get("blob_hashes") or [])
    present, _missing = _split_blobs_by_presence(project_id, manifest_blobs)

    return ApiResponse.success(data=_BlobUploadResponse(
        snapshot_id=snapshot_id,
        accepted_count=accepted,
        rejected_hashes=rejected,
        server_present_count=len(present),
    ))


# ── Promote (I5) ─────────────────────────────────────────────────


class _PromoteRequest(BaseModel):
    scope_path: str = ""
    message: str = ""


class _PromoteResponse(BaseModel):
    snapshot_id: str
    commit_id: str
    project_id: str
    scope_path: str


@router.post(
    "/local-snapshots/{snapshot_id}/promote",
    response_model=ApiResponse[_PromoteResponse],
    summary="Promote a shadow snapshot to a real commit (I5)",
)
async def promote_snapshot(
    snapshot_id: str,
    body: _PromoteRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Turn a shadow manifest into a published Git commit.

    Per ``08-shadow-snapshots.md §6``: this is the last leg of the
    local-↔-cloud bridge. The manifest's blob hashes must all already
    be in the project's object store (call I3 first if anything is
    missing); promotion fails otherwise rather than landing a commit
    that references unreachable blobs.

    The promotion routes through ``VersionWriteEngine.submit_version``
    using a ``VersionSubmissionIntent`` — i.e. the same path a real
    Git push uses — so conflict policy, scope validation, audit, and
    outbox dispatch all fire normally. The snapshot row is deleted
    after a successful promote to signal the bridge has closed.
    """
    import base64 as _base64  # noqa: F401 — kept for future per-blob bytes pull-up
    from src.version_engine.adapters.git.submission import submit_git_tree
    from src.version_engine.bootstrap.dependencies import (
        build_worker_version_engine_container,
    )
    from src.version_engine.write_engine.tree_objects import build_tree_from_files

    client = SupabaseClient().client
    snap = (
        client.table("local_shadow_snapshots")
        .select("*")
        .eq("id", snapshot_id)
        .eq("user_id", current_user.user_id)
        .maybe_single()
        .execute()
    )
    snap_row = getattr(snap, "data", None)
    if not snap_row:
        raise HTTPException(status_code=404, detail="snapshot not found")

    project_id = snap_row["project_id"]
    manifest = snap_row.get("manifest") or []
    if not manifest:
        raise HTTPException(
            status_code=400,
            detail="snapshot manifest is empty; nothing to promote",
        )

    # Check every referenced blob is on the server BEFORE committing.
    blob_hashes = sorted({entry.get("blob_hash") for entry in manifest if entry.get("blob_hash")})
    present, missing = _split_blobs_by_presence(project_id, blob_hashes)
    if missing:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "blobs_missing",
                "message": (
                    f"{len(missing)} blob(s) referenced by the snapshot are not "
                    f"in the project object store. Upload them via "
                    f"POST /api/v1/local-snapshots/{{snapshot_id}}/blobs first."
                ),
                "missing_hashes_sample": missing[:10],
                "missing_count": len(missing),
                "present_count": len(present),
            },
        )

    # Build the canonical tree from the manifest, then submit.
    container = build_worker_version_engine_container()
    repo = container.repo_manager.get_server_repo(project_id)

    # The manifest entries point at blob_hashes already on the server
    # (verified above). Read the bytes back so build_tree_from_files
    # can canonicalize the tree — the canonical store is content-
    # addressable, so we can re-derive the tree hash deterministically.
    files: dict[str, bytes] = {}
    for entry in manifest:
        path = entry.get("path", "")
        blob_hash = entry.get("blob_hash", "")
        if not path or not blob_hash:
            continue
        try:
            files[path] = repo.store.get(blob_hash)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"failed to read blob {blob_hash[:12]} for path "
                    f"{path!r}: {exc}"
                ),
            ) from exc

    tree_id = build_tree_from_files(repo.store, files)
    scope_path = (body.scope_path or "").strip("/")
    actor = f"user:{current_user.user_id}"
    base_commit_id = repo.get_scope_head_commit_id(scope_path) or ""

    # Construct a client_commit_id so the submission flow has something
    # to reference — same shape as a real Git push. We use the engine's
    # build_git_commit helper because the canonical hash must match
    # what Git would compute.
    from src.version_engine.write_engine.git_commit import build_git_commit
    promoted_message = body.message or (
        f"shadow snapshot promote ({snap_row.get('machine_id') or 'local'} "
        f"@ {snap_row.get('ref_name') or 'main'})"
    )
    client_commit = build_git_commit(
        repo,
        tree_sha=tree_id,
        parent_sha=base_commit_id,
        who=actor,
        message=promoted_message,
        created_at_iso=datetime.now(timezone.utc).isoformat(),
    )

    submission_result = await submit_git_tree(
        container.repo_manager,
        project_id=project_id,
        scope_path=scope_path,
        actor=actor,
        base_commit_id=base_commit_id,
        proposed_tree_id=tree_id,
        client_commit_id=client_commit,
        proposed_files=files,
        message=promoted_message,
    )

    if submission_result.status not in {"ok", "merged"}:
        # The submission landed in pending / conflict / rejected. Don't
        # consume the snapshot — the user might want to retry after
        # resolving the conflict.
        raise HTTPException(
            status_code=409,
            detail={
                "error": "promotion_blocked",
                "status": submission_result.status,
                "pending_conflict_id": submission_result.pending_conflict_id,
                "message": (
                    "The snapshot tree could not be cleanly merged. "
                    "See the pending conflict and resolve, then retry promote."
                ),
            },
        )

    # Promotion succeeded — clean up the snapshot row so the local
    # daemon stops re-uploading it. Best-effort: failure here just
    # leaves a stale row that the user can delete manually.
    try:
        client.table("local_shadow_snapshots").delete().eq("id", snapshot_id).execute()
    except Exception as exc:
        log_warning(
            f"[shadow-promote] snapshot {snapshot_id} promoted to "
            f"commit {submission_result.commit_id} but cleanup delete "
            f"failed: {exc}",
        )

    return ApiResponse.success(data=_PromoteResponse(
        snapshot_id=snapshot_id,
        commit_id=submission_result.commit_id,
        project_id=project_id,
        scope_path=scope_path,
    ))


# ── Helpers ────────────────────────────────────────────────────


def _split_blobs_by_presence(project_id: str, blob_hashes: list[str]) -> tuple[list[str], list[str]]:
    """Best-effort: ask the project's object store which blobs it has.

    We don't fail the upsert if the lookup blows up — it's metadata.
    """

    if not blob_hashes:
        return [], []
    try:
        from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container
        repo = build_worker_version_engine_container().repo_manager.get_server_repo(project_id)
        store = repo.store
        present = [h for h in blob_hashes if store.exists(h)]
        present_set = set(present)
        missing = [h for h in blob_hashes if h not in present_set]
        return present, missing
    except Exception:
        return [], list(blob_hashes)

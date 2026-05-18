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

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from src.common_schemas import ApiResponse
from src.infra.supabase.client import SupabaseClient
from src.version_engine.routers._content_helpers import ensure_project_access
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService


router = APIRouter()


# ── Limits enforced by the server (see 08-shadow-snapshots.md §3) ──


_MAX_FILES_PER_SNAPSHOT = 100_000
_MAX_BYTES_PER_FILE = 50 * 1024 * 1024
_VALID_FILE_MODES = frozenset({"100644", "100755", "120000", "40000"})


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

    @model_validator(mode="after")
    def _validate(self) -> "UpsertShadowSnapshotRequest":
        if len(self.manifest) > _MAX_FILES_PER_SNAPSHOT:
            raise ValueError(
                f"manifest has {len(self.manifest)} entries; cap is "
                f"{_MAX_FILES_PER_SNAPSHOT}",
            )
        return self


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
    can update its row over and over without rotating IDs."""

    ensure_project_access(project_service, current_user, body.project_id)

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


# ── Helpers ────────────────────────────────────────────────────


def _split_blobs_by_presence(project_id: str, blob_hashes: list[str]) -> tuple[list[str], list[str]]:
    """Best-effort: ask the project's object store which blobs it has.

    We don't fail the upsert if the lookup blows up — it's metadata.
    """

    if not blob_hashes:
        return [], []
    try:
        from src.version_engine.dependencies import get_repo_manager_standalone
        repo = get_repo_manager_standalone().get_server_repo(project_id)
        store = repo.store
        present = [h for h in blob_hashes if store.exists(h)]
        present_set = set(present)
        missing = [h for h in blob_hashes if h not in present_set]
        return present, missing
    except Exception:
        return [], list(blob_hashes)

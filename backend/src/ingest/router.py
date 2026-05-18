"""
Ingest Router - Unified entry point API.

This router provides a unified interface for all data ingestion:
- FILE: Local file upload → File Worker (ETL)
- SAAS: SaaS platform sync → SyncEngine (synchronous execution)

Dual-layer routing architecture:
- Layer 1: mode (raw | ocr_parse)
- Layer 2: file_type (json | text | ocr_needed | binary)
"""

import asyncio
import base64
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)

from src.infra.file_formats import detect_mime, detect_node_type
from src.infra.s3.dependencies import get_s3_service
from src.infra.s3.exceptions import S3Error, S3FileSizeExceededError, S3MultipartError
from src.infra.s3.service import S3Service
from src.ingest.dependencies import get_ingest_service

# Import underlying services for file processing
from src.ingest.file.dependencies import get_etl_service
from src.ingest.file.exceptions import RuleNotFoundError
from src.ingest.file.service import ETLService
from src.ingest.file.tasks.models import ETLTaskStatus
from src.ingest.schemas import (
    BatchQueryRequest,
    BatchTaskResponse,
    IngestStatus,
    IngestSubmitItem,
    IngestSubmitResponse,
    IngestTaskResponse,
    IngestType,
    SourceType,
    UploadAbortRequest,
    UploadAbortResponse,
    UploadCompleteBatchRequest,
    UploadCompleteBatchResponse,
    UploadCompleteItemResult,
    UploadCompleteRequest,
    UploadCompleteResponse,
    UploadInitFileResponse,
    UploadInitRequest,
    UploadInitResponse,
    UploadPartResponse,
)
from src.ingest.service import IngestService
from src.ingest.shared.task.normalizers import detect_file_ingest_type
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

# === File Type Classification ===

_OCR_DOCUMENT_MIME_PREFIXES = (
    "application/msword",
    "application/vnd.ms-",
    "application/vnd.openxmlformats-officedocument.",
    "application/vnd.oasis.opendocument.",
    "application/rtf",
    "text/rtf",
    "application/epub+zip",
    "application/x-mobipocket-ebook",
)


def classify_file_type(filename: str) -> str:
    """Classify an upload using the canonical file-format registry.

    This legacy/simple upload endpoint needs coarse routing buckets
    (json/text/ocr_needed/binary), but the knowledge about extensions
    and filenames must stay in `src.infra.file_formats`. Keeping a
    local extension list here was the old architecture smell.
    """
    node_type = detect_node_type(filename)
    if node_type == "json":
        return "json"

    ingest_type = detect_file_ingest_type(filename)
    if ingest_type == IngestType.TEXT:
        return "text"

    mime = detect_mime(filename).lower()
    if (
        ingest_type in {IngestType.PDF, IngestType.IMAGE}
        or any(mime.startswith(prefix) for prefix in _OCR_DOCUMENT_MIME_PREFIXES)
    ):
        return "ocr_needed"

    return "binary"


# === File Upload Endpoint ===

@router.post("/submit/file", response_model=IngestSubmitResponse, status_code=202)
async def submit_file_ingest(
    # Required fields
    project_id: str = Form(..., description="Target project ID"),
    files: list[UploadFile] = File(..., description="Files to upload"),

    # Optional configuration
    # Default is "raw" so callers that don't opt into the OCR
    # pipeline never accidentally trigger MineRU/LLM. Was "ocr_parse"
    # historically, which made the smart-parse pipeline the implicit
    # default and burned worker cycles for clients that just wanted
    # a file dropped into the tree.
    mode: str = Form("raw", description="Processing mode: raw | ocr_parse"),
    rule_id: int | None = Form(None, description="ETL rule ID (for ocr_parse mode)"),
    parent_path: str | None = Form(None, description="Parent directory path for new files"),
    # Legacy alias kept so older frontend callers that still send
    # `parent_id` continue to land files in the intended ObjectStore path.
    # The content tree is path-based, so new callers should use
    # `parent_path`.
    parent_id: str | None = Form(None, description="Deprecated alias for parent_path"),

    # Dependencies
    etl_service: ETLService = Depends(get_etl_service),
    s3_service: S3Service = Depends(get_s3_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit file ingest tasks.

    All text/JSON files are written directly to the version tree via version transaction engine.
    Binary/OCR files go to S3 + ETL Worker (when OCR is enabled).
    When `settings.ENABLE_OCR` is False any incoming `mode="ocr_parse"`
    is downgraded to "raw" so binary/OCR-needing files end up on S3
    via the same code path as a plain file upload.
    """
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    # OCR pause: silently downgrade ocr_parse → raw when the
    # smart-parse pipeline is disabled at the deployment level.
    # We log once per request rather than per-file because callers
    # batch dozens of files into one POST and we don't want to spam
    # the log. Using the module-level `settings` singleton (rather
    # than constructing `Settings()` per request) keeps env-file
    # parsing off the hot path.
    from src.config import settings as app_settings
    if mode == "ocr_parse" and not app_settings.ENABLE_OCR:
        logger.warning(
            "OCR pipeline is paused (ENABLE_OCR=False); downgrading "
            "ocr_parse → raw for project=%s, %d file(s).",
            project_id, len(files),
        )
        mode = "raw"

    from src.version_engine.dependencies import create_version_write_command_service

    commands = create_version_write_command_service()

    target_parent_path = (parent_path or parent_id or "").strip("/")

    items: list[IngestSubmitItem] = []
    modified_files: dict[str, bytes] = {}

    for f in files:
        original_filename = f.filename or "file"
        original_basename = Path(original_filename).name
        content = await f.read()
        len(content)

        file_type = classify_file_type(original_basename)

        file_path = (
            f"{target_parent_path}/{original_basename}"
            if target_parent_path
            else original_basename
        )

        try:
            if file_type == "json":
                try:
                    text_content = content.decode("utf-8", errors="ignore")
                    json_data = json.loads(text_content)
                except json.JSONDecodeError as e:
                    logger.warning(f"JSON parse failed for {original_filename}: {e}")
                    json_data = {"_raw": content.decode("utf-8", errors="ignore"), "_parse_error": str(e)}

                json_bytes = json.dumps(json_data, ensure_ascii=False, indent=2).encode("utf-8")
                modified_files[file_path] = json_bytes

                task = _create_completed_task(
                    etl_service, current_user.user_id, project_id,
                    original_filename, rule_id, file_path, "json"
                )
                items.append(_make_completed_item(task, original_filename, file_path))

            elif file_type == "text":
                modified_files[file_path] = content

                task = _create_completed_task(
                    etl_service, current_user.user_id, project_id,
                    original_filename, rule_id, file_path, "markdown"
                )
                items.append(_make_completed_item(task, original_filename, file_path))

            elif file_type == "ocr_needed" and mode == "ocr_parse":
                s3_key = await _upload_to_s3(
                    s3_service, project_id, original_filename, content, f.content_type
                )

                try:
                    task = await etl_service.submit_etl_task(
                        user_id=current_user.user_id,
                        project_id=project_id,
                        filename=original_filename,
                        rule_id=rule_id,
                        s3_key=s3_key,
                    )
                except RuleNotFoundError as e:
                    items.append(_make_failed_item(
                        etl_service.create_failed_task(
                            user_id=current_user.user_id, project_id=project_id, filename=original_filename, rule_id=rule_id, error=str(e)
                        ),
                        original_filename, s3_key, str(e)
                    ))
                    continue

                task.metadata["mount_path"] = file_path
                task.metadata["s3_key"] = s3_key
                etl_service.task_repository.update_task(task)

                items.append(IngestSubmitItem(
                    task_id=str(task.task_id or 0),
                    source_type=SourceType.FILE,
                    ingest_type=detect_file_ingest_type(original_filename),
                    status=IngestStatus.PENDING if task.status == ETLTaskStatus.PENDING else IngestStatus.PROCESSING,
                    filename=original_filename,
                    s3_key=s3_key,
                    path=file_path,
                ))

            else:
                # Generic binary path — hit by:
                #   (a) file_type == "binary" (zip, exe, mp4, …)
                #   (b) file_type == "ocr_needed" with mode=="raw"
                #       (PDF / image / docx after the OCR pause
                #       downgrade above; previously they went through
                #       the ETL worker, which would eventually write
                #       to ObjectStore itself).
                #
                # Without writing into `modified_files` here, the file
                # gets stashed in S3 + a "completed" task row but never
                # appears in the explorer — the bug a user just hit:
                # uploaded PDFs while OCR was paused, the task panel
                # said "Completed", but the file never showed up in the
                # tree. Keep the S3 upload too so any downstream code
                # that consumes `s3_key` keeps working; the dual write
                # is redundant on storage but trivial to revert once
                # we either retire S3 for raw uploads or bring OCR
                # back online.
                s3_key = await _upload_to_s3(
                    s3_service, project_id, original_filename, content, f.content_type
                )

                modified_files[file_path] = content

                task = _create_completed_task(
                    etl_service, current_user.user_id, project_id,
                    original_filename, rule_id, file_path, "file"
                )
                items.append(_make_completed_item(task, original_filename, file_path, s3_key))

        except S3FileSizeExceededError as e:
            items.append(_make_failed_item(
                etl_service.create_failed_task(
                    user_id=current_user.user_id, project_id=project_id, filename=original_filename, rule_id=rule_id, error=str(e),
                    metadata={"error_stage": "upload"}
                ),
                original_filename, None, str(e)
            ))
        except (S3Error, Exception) as e:
            logger.error(f"File ingest failed for {original_filename}: {e}", exc_info=True)
            items.append(_make_failed_item(
                etl_service.create_failed_task(
                    user_id=current_user.user_id, project_id=project_id, filename=original_filename, rule_id=rule_id, error=f"Import failed: {e}",
                    metadata={"error_stage": "process"}
                ),
                original_filename, None, str(e)
            ))

    if modified_files:
        try:
            await commands.bulk_write(
                project_id,
                modified_files,
                actor=f"ingest:{current_user.user_id}",
                message=f"Upload {len(modified_files)} file(s)",
            )
        except Exception as e:
            logger.error(f"version push failed during file ingest: {e}", exc_info=True)

    return IngestSubmitResponse(items=items, total=len(items))


# === Helper Functions ===

async def _upload_to_s3(
    s3_service: S3Service,
    project_id: str,
    original_filename: str,
    content: bytes,
    content_type: str | None,
) -> str:
    _, ext = os.path.splitext(original_filename)
    safe_filename = f"{uuid.uuid4()}{ext}"
    s3_key = f"projects/{project_id}/files/{safe_filename}"

    original_filename_b64 = base64.b64encode(
        original_filename.encode("utf-8")
    ).decode("ascii")

    await s3_service.upload_file(
        key=s3_key,
        content=content,
        content_type=content_type,
        metadata={
            "original_filename_b64": original_filename_b64,
            "project_id": str(project_id),
        },
    )
    return s3_key


def _create_completed_task(
    etl_service: ETLService,
    user_id: str,
    project_id: str,
    filename: str,
    rule_id: int | None,
    path: str,
    node_type: str,
):
    task = etl_service.create_failed_task(
        user_id=user_id,
        project_id=project_id,
        filename=filename,
        rule_id=rule_id,
        error="Direct import completed",
        metadata={
            "direct_import": True,
            "path": path,
            "node_type": node_type,
        }
    )
    task.status = ETLTaskStatus.COMPLETED
    task.error = None
    task.progress = 100
    etl_service.task_repository.update_task(task)
    return task


def _make_completed_item(
    task,
    filename: str,
    path: str,
    s3_key: str | None = None,
) -> IngestSubmitItem:
    return IngestSubmitItem(
        task_id=str(task.task_id or 0),
        source_type=SourceType.FILE,
        ingest_type=detect_file_ingest_type(filename),
        status=IngestStatus.COMPLETED,
        filename=filename,
        s3_key=s3_key,
        path=path,
    )


def _make_failed_item(
    task,
    filename: str,
    s3_key: str | None,
    error: str,
) -> IngestSubmitItem:
    return IngestSubmitItem(
        task_id=str(task.task_id or 0),
        source_type=SourceType.FILE,
        ingest_type=detect_file_ingest_type(filename),
        status=IngestStatus.FAILED,
        filename=filename,
        s3_key=s3_key,
        error=error,
    )


# === Backend-Proxied Multipart Upload Endpoints ===
#
# Four-step protocol with all bytes flowing through the FastAPI
# process (browser → Next.js same-origin → FastAPI → S3):
#   1. POST /upload/init     — initiate S3 multipart upload, create
#                              the pending task, return ``upload_id``
#                              + ``s3_key`` + ``total_parts``.
#   2. PUT  /upload/part     — browser PUTs each part to FastAPI;
#                              FastAPI calls boto3 ``upload_part`` to
#                              hand bytes to S3 and returns the
#                              ``ETag`` to the client.
#   3. POST /upload/complete — finalize the multipart upload + write
#                              the assembled bytes into ObjectStore (see
#                              batch variant for folder uploads).
#   4. POST /upload/abort    — (cancel path) drop in-flight upload.
#
# Why proxy instead of presigned-URL direct-to-S3?
#   Some S3-compatible providers (notably Supabase Storage's S3
#   emulation) don't expose ``PutBucketCors`` and the dashboard CORS
#   settings only cover their REST API, not the S3 endpoint. Direct
#   browser → S3 PUTs from any web origin are blocked by browser
#   CORS no matter what — there's no setting that fixes it. Proxying
#   through FastAPI sidesteps the issue entirely (browser → Next.js
#   is same-origin; Next.js → FastAPI → S3 is server-to-server,
#   neither pays the CORS tax).
#
#   Trade-off: ~15-30% slower than direct-to-S3 due to the extra
#   hop, plus backend bandwidth (each part flows through us once).
#   Acceptable because typical files are small-medium and the
#   simplicity win (one upload path that works on every backend) is
#   worth way more than the 30% speed delta. For genuinely large /
#   reliability-sensitive workloads, users should use the local
#   sync daemon, which survives tab close, network drops, and
#   reboots — strictly better reliability than any web upload can
#   ever offer.

# AWS hard limits + sensible defaults. ``MAX_FILE_SIZE`` is a safety
# rail; the bucket itself can hold up to 5TiB per object.
_DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024            # 8 MiB
_MIN_CHUNK_SIZE = 5 * 1024 * 1024                # 5 MiB (AWS minimum, except last part)
_MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024          # 5 GiB
_MAX_PARTS_PER_UPLOAD = 10000                    # AWS hard limit
# Per-part request body cap (8 MiB chunk + slack for the last-part
# overshoot some clients send). Used to short-circuit oversized
# bodies before we forward them to S3 and pay for the bandwidth.
_MAX_PART_BODY_SIZE = 32 * 1024 * 1024           # 32 MiB


@router.post("/upload/init", response_model=UploadInitResponse)
async def init_multipart_upload(
    request: UploadInitRequest,
    s3_service: S3Service = Depends(get_s3_service),
    etl_service: ETLService = Depends(get_etl_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Begin a backend-proxied multipart upload for one or more files.

    For each file we:
      1. Verify project access (the auth boundary; the subsequent
         ``/upload/part`` and ``/upload/complete`` calls re-verify
         task ownership against the user-bound task we create here).
      2. Allocate a unique S3 key namespaced by project + user.
      3. Initiate a multipart upload on S3 — gets us an
         ``UploadId`` we'll thread through subsequent calls.
      4. Create a ``pending`` task in the ``uploads`` table so client
         polling has a real ID from the very first frame.

    Crucially we do NOT pre-sign per-part URLs anymore. Parts are
    PUT to the proxied ``/upload/part`` endpoint, which performs
    ``upload_part`` server-side. See the protocol comment above for
    why we abandoned direct-to-S3.
    """
    if not project_service.verify_project_access(
        request.project_id, current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Project not found")

    chunk_size = request.chunk_size or _DEFAULT_CHUNK_SIZE
    if chunk_size < _MIN_CHUNK_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"chunk_size must be >= {_MIN_CHUNK_SIZE} bytes (AWS minimum)",
        )

    # Validate every file FIRST, synchronously. Range / part-count
    # errors are deterministic; we want the request to fail with
    # 400 before we go and create any S3 multiparts that we'd then
    # have to clean up. This also keeps the parallel path below
    # exception-free for client errors — only S3/Supabase failures
    # can reach gather.
    prepared_files: list[dict] = []
    for f in request.files:
        if f.size > _MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File '{f.filename}' is {f.size} bytes; max allowed "
                    f"is {_MAX_FILE_SIZE} bytes"
                ),
            )

        num_parts = max(1, (f.size + chunk_size - 1) // chunk_size)
        if num_parts > _MAX_PARTS_PER_UPLOAD:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File '{f.filename}' would require {num_parts} parts at "
                    f"chunk_size={chunk_size}; AWS caps multipart at "
                    f"{_MAX_PARTS_PER_UPLOAD}. Increase chunk_size."
                ),
            )

        original_basename = Path(f.filename).name
        _, ext = os.path.splitext(original_basename)
        # Key layout: ``projects/{pid}/uploads/{uid}/{uuid}{ext}``.
        # Project + user prefix lets us scope auth on subsequent
        # ``/upload/part`` calls (the task echoes the s3_key back to
        # the client; we cross-check the echo).
        s3_key = (
            f"projects/{request.project_id}/uploads/"
            f"{current_user.user_id}/{uuid.uuid4()}{ext}"
        )

        parent_path = (f.parent_path or "").strip("/")
        mount_path = (
            f"{parent_path}/{original_basename}"
            if parent_path
            else original_basename
        )

        # Tag S3 metadata so back-fill / debug tooling can recover the
        # original filename (which may contain non-ASCII chars S3
        # rejects in raw user-metadata values).
        original_filename_b64 = base64.b64encode(
            f.filename.encode("utf-8")
        ).decode("ascii")

        prepared_files.append({
            "f": f,
            "num_parts": num_parts,
            "s3_key": s3_key,
            "mount_path": mount_path,
            "original_filename_b64": original_filename_b64,
        })

    # Resolve default rule_id ONCE. The legacy ``uploads`` schema
    # requires a non-null rule_id on every row but the finalize
    # worker doesn't invoke the rule engine — so the value is
    # purely a placeholder. Resolving it once and reusing across
    # all per-file inserts saves (N-1) × ~400ms in etl_rules
    # queries alone for an N-file batch. The lookup itself is sync
    # Supabase work so we offload to a thread.
    default_rule_id = await asyncio.to_thread(
        etl_service.get_default_rule_id_for_user, current_user.user_id,
    )

    # Per-file init: create_multipart_upload (S3) + create_pending_upload_task
    # (Supabase). Each is independent of the others, so we fan
    # them out under a semaphore. Sequential previously cost
    # ~1.2s × N files; parallel collapses that to one round-trip
    # cycle for the batch (capped at 8 in flight).
    _INIT_PARALLEL_LIMIT = 8
    sem = asyncio.Semaphore(_INIT_PARALLEL_LIMIT)

    async def _init_one_file(prepared: dict) -> UploadInitFileResponse:
        f = prepared["f"]
        s3_key = prepared["s3_key"]
        mount_path = prepared["mount_path"]
        original_filename_b64 = prepared["original_filename_b64"]
        num_parts = prepared["num_parts"]

        async with sem:
            upload_id = await s3_service.create_multipart_upload(
                key=s3_key,
                content_type=f.content_type,
                metadata={
                    "project_id": str(request.project_id),
                    "user_id": str(current_user.user_id),
                    "original_filename_b64": original_filename_b64,
                },
            )

            try:
                # ``create_pending_upload_task`` is sync (Supabase
                # REST), so wrap in to_thread to actually
                # parallelize. With ``default_rule_id`` pre-resolved,
                # this collapses to a single uploads INSERT per task.
                task = await asyncio.to_thread(
                    etl_service.create_pending_upload_task,
                    user_id=current_user.user_id,
                    project_id=request.project_id,
                    filename=f.filename,
                    s3_key=s3_key,
                    upload_id=upload_id,
                    mount_path=mount_path,
                    size=f.size,
                    content_type=f.content_type,
                    default_rule_id=default_rule_id,
                )
            except Exception as e:
                # If task creation fails after we've already
                # initiated the multipart upload, abort it so we
                # don't leak an orphan eating bucket space (AWS
                # keeps multiparts forever unless you have a
                # lifecycle rule).
                logger.error(
                    f"Failed to create pending upload task for "
                    f"{f.filename}: {e}",
                    exc_info=True,
                )
                try:
                    await s3_service.abort_multipart_upload(s3_key, upload_id)
                except Exception as abort_err:
                    logger.warning(
                        f"Failed to abort orphaned multipart "
                        f"upload {s3_key}: {abort_err}"
                    )
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create upload task: {e}",
                )

            return UploadInitFileResponse(
                task_id=str(task.task_id),
                filename=f.filename,
                s3_key=s3_key,
                upload_id=upload_id,
                chunk_size=chunk_size,
                total_parts=num_parts,
            )

    # Use ``return_exceptions=True`` to let every per-file coro
    # finish (including its own multipart-abort cleanup) before
    # we surface the first error. With the default
    # ``return_exceptions=False`` semantics, gather cancels
    # in-flight siblings on the first failure — and a coro
    # cancelled mid ``abort_multipart_upload`` would leave the
    # worst kind of orphan: half-aborted with no record.
    raw_results = await asyncio.gather(
        *(_init_one_file(p) for p in prepared_files),
        return_exceptions=True,
    )

    # If any per-file init raised, roll back all successful siblings
    # before surfacing the first error. Because the client never
    # receives the partial success response on a 500, leaving those
    # pending tasks/multipart sessions around would create invisible
    # orphans.
    first_error: HTTPException | BaseException | None = None
    for r in raw_results:
        if isinstance(r, HTTPException):
            first_error = first_error or r
        elif isinstance(r, BaseException):
            first_error = first_error or r

    if first_error is not None:
        async def _cleanup_successful_init(r) -> None:
            if not isinstance(r, UploadInitFileResponse):
                return
            try:
                await s3_service.abort_multipart_upload(r.s3_key, r.upload_id)
            except Exception as abort_err:
                logger.warning(
                    f"Failed to abort multipart upload after init "
                    f"batch failure {r.s3_key}: {abort_err}"
                )
            try:
                await asyncio.to_thread(
                    etl_service.task_repository.delete_task, r.task_id,
                )
            except Exception as delete_err:
                logger.warning(
                    f"Failed to delete upload task after init "
                    f"batch failure {r.task_id}: {delete_err}"
                )

        await asyncio.gather(
            *(_cleanup_successful_init(r) for r in raw_results),
            return_exceptions=True,
        )
        if isinstance(first_error, HTTPException):
            raise first_error
        raise HTTPException(
            status_code=500,
            detail=f"upload/init failed: {first_error}",
        )

    return UploadInitResponse(files=raw_results)


@router.put("/upload/part", response_model=UploadPartResponse)
async def upload_part(
    request: Request,
    task_id: str = Query(..., description="Task ID issued by /upload/init"),
    part_number: int = Query(..., ge=1, le=10000, description="1-based part index"),
    s3_service: S3Service = Depends(get_s3_service),
    etl_service: ETLService = Depends(get_etl_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Forward one multipart part to S3 on behalf of the browser.

    Auth boundary:
      - The task is looked up by ``task_id`` and must belong to the
        current user. The ``s3_key`` and ``upload_id`` are pulled
        from the task's metadata, never from the client — so a
        compromised browser can't redirect a part to a different
        upload session by tampering with query parameters.

    Memory model:
      - We read the request body fully into a ``bytes`` buffer
        before calling ``upload_part``. boto3's ``upload_part``
        wants a seekable Body for the SHA-256 signing pass. With
        the default 8 MiB chunk_size and 4 concurrent parts per
        file, peak per-file RAM is ~32 MiB — trivial. For
        pathological 1024-part uploads (5 GiB at 5 MiB chunks) the
        per-file ceiling is the same (still 4 concurrent parts).
      - We DON'T stream the body straight to boto3 to keep this
        endpoint simple; if memory pressure ever shows up in
        profiling we can swap to ``s3.upload_part_copy`` or rewrite
        with ``aiobotocore`` streaming.

    Body size cap:
      - ``Content-Length`` (or actual body size) over
        ``_MAX_PART_BODY_SIZE`` is rejected. Prevents a client from
        OOM'ing the FastAPI worker by sending an obscene part.

    Errors:
      - 404: task not found / not owned.
      - 409: task is no longer pending (already completed/aborted).
      - 400: part_number > total_parts for the task, or body size
             exceeds the cap.
      - 502: S3 ``upload_part`` failed (typically transient — the
             client's retry loop should clear it).
    """
    task = etl_service.task_repository.get_task(task_id)
    if not task or (
        task.created_by is not None and task.created_by != current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status != ETLTaskStatus.PENDING:
        raise HTTPException(
            status_code=409,
            detail=f"Task is not pending (status={task.status.value})",
        )

    s3_key = task.metadata.get("s3_key")
    upload_id = task.metadata.get("upload_id")
    if not s3_key or not upload_id:
        # Defensive: a task with no s3_key/upload_id can't be a
        # multipart upload target. Treat as 404 — the client must
        # have a stale task_id from another flow.
        raise HTTPException(
            status_code=404,
            detail="Task is not a multipart upload",
        )

    # Check Content-Length first for an early bounce; it's cheap.
    content_length_header = request.headers.get("content-length")
    if content_length_header:
        try:
            cl = int(content_length_header)
        except ValueError:
            cl = -1
        if cl > _MAX_PART_BODY_SIZE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Part body is {cl} bytes; max per part is "
                    f"{_MAX_PART_BODY_SIZE} bytes"
                ),
            )

    body = await request.body()
    if len(body) == 0:
        raise HTTPException(status_code=400, detail="Empty part body")
    if len(body) > _MAX_PART_BODY_SIZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Part body is {len(body)} bytes; max per part is "
                f"{_MAX_PART_BODY_SIZE} bytes"
            ),
        )

    try:
        etag = await s3_service.upload_part(
            key=s3_key,
            upload_id=upload_id,
            part_number=part_number,
            data=body,
        )
    except S3MultipartError as e:
        # ``upload_part`` failures are most often transient (S3 5xx,
        # connection reset, ETag mismatch on a partial replay). We
        # surface a 502 — same wire signature the client's retry
        # loop already handles, no special-casing needed.
        logger.warning(
            f"upload_part failed for task {task_id} part {part_number}: {e}"
        )
        raise HTTPException(
            status_code=502, detail=f"S3 upload_part failed: {e}"
        )

    return UploadPartResponse(part_number=part_number, etag=etag)


@router.post("/upload/complete", response_model=UploadCompleteResponse)
async def complete_upload(
    request: UploadCompleteRequest,
    s3_service: S3Service = Depends(get_s3_service),
    etl_service: ETLService = Depends(get_etl_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Finalize a direct-to-S3 multipart upload and write the assembled
    bytes into ObjectStore *inline*.

    By the time the client calls this, every part is already in S3.
    We:
      1. Verify task ownership (the auth boundary on the back end of
         the protocol — the ``s3_key`` & ``upload_id`` are echoed back
         from the client and we cross-check them against the task we
         created in /upload/init).
      2. Run S3 ``CompleteMultipartUpload`` to assemble the parts.
      3. HEAD the resulting object as a sanity check (size matches
         what the client claimed; non-fatal mismatch is logged).
      4. Pull bytes S3 -> backend RAM, write them into ObjectStore via
         ``finalize_upload_to_version``, mark the task COMPLETED. We do
         this inline (instead of dispatching to the ARQ worker) so
         that:
           - the user sees "Completed" the instant /upload/complete
             returns; no waiting on a separate worker poll cycle.
           - the dev environment doesn't need a separate worker
             process running for normal-sized uploads.
         For pathologically large files (multi-GB) the inline path
         can exceed an HTTP timeout — that's a future enhancement
         (a request-flag that swaps to the ``etl_finalize_upload_job``
         worker path, which is still wired up).
    """
    task = etl_service.task_repository.get_task(request.task_id)
    if not task or (
        task.created_by is not None and task.created_by != current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Task not found")

    # State guard: complete is a one-way trip from PENDING. Re-calling
    # would race with the finalize worker; the client should consult
    # the task status instead.
    if task.status != ETLTaskStatus.PENDING:
        raise HTTPException(
            status_code=409,
            detail=f"Task is not pending (status={task.status.value})",
        )

    expected_key = task.metadata.get("s3_key")
    expected_upload_id = task.metadata.get("upload_id")
    if expected_key != request.s3_key or expected_upload_id != request.upload_id:
        # Mismatch usually means a confused/replayed client. Refuse
        # rather than complete a multipart upload bound to a different
        # task — would leave the original task PENDING forever.
        raise HTTPException(
            status_code=400,
            detail="s3_key/upload_id mismatch with the task",
        )

    parts = sorted(
        [(p.part_number, p.etag) for p in request.parts], key=lambda x: x[0]
    )

    try:
        await s3_service.complete_multipart_upload(
            request.s3_key, request.upload_id, parts
        )
    except Exception as e:
        logger.error(
            f"complete_multipart_upload failed for task {request.task_id}: {e}",
            exc_info=True,
        )
        # Best-effort cleanup so we don't leave a half-assembled
        # multipart upload on the bucket.
        try:
            await s3_service.abort_multipart_upload(
                request.s3_key, request.upload_id
            )
        except Exception:
            pass
        task.mark_failed(f"Failed to finalize multipart upload: {e}")
        task.metadata["error_stage"] = "complete_multipart"
        etl_service.task_repository.update_task(task)
        raise HTTPException(
            status_code=502, detail=f"S3 complete_multipart_upload failed: {e}"
        )

    # Sanity-check that S3 sees the object at the expected size.
    # Mismatch is non-fatal but worth logging — could indicate a
    # client that lied about the file size or a part ETag mismatch.
    expected_size = task.metadata.get("size")
    try:
        meta = await s3_service.get_file_metadata(request.s3_key)
        if expected_size and meta.size != expected_size:
            logger.warning(
                f"Task {request.task_id}: declared size {expected_size} "
                f"differs from S3 size {meta.size}"
            )
    except Exception as e:
        logger.warning(
            f"Task {request.task_id}: head_object after complete failed: {e}"
        )

    # Run finalize INLINE: download from S3, write into ObjectStore, mark
    # task COMPLETED. The helper is also the body of the ARQ worker
    # job, so behaviour and runtime-state transitions are identical.
    from src.ingest.file.jobs.jobs import finalize_upload_to_version

    try:
        result = await finalize_upload_to_version(
            task_id=task.task_id,
            repo=etl_service.task_repository,
            s3=s3_service,
            state_repo=etl_service.state_repo,
        )
    except asyncio.CancelledError:
        # Finalize already wrote the FAILED state for us; surface
        # a 504 to the client so they can decide whether to retry.
        raise HTTPException(
            status_code=504, detail="Finalize timed out writing to ObjectStore"
        )

    if not result.get("ok"):
        # Helper has already marked the task FAILED + persisted state.
        raise HTTPException(
            status_code=500,
            detail=f"Failed to finalize upload: {result.get('error', 'unknown error')}",
        )

    return UploadCompleteResponse(
        task_id=str(task.task_id),
        status=IngestStatus.COMPLETED,
        path=result.get("path") or task.metadata.get("mount_path"),
    )


@router.post(
    "/upload/complete-batch",
    response_model=UploadCompleteBatchResponse,
)
async def complete_upload_batch(
    request: UploadCompleteBatchRequest,
    s3_service: S3Service = Depends(get_s3_service),
    etl_service: ETLService = Depends(get_etl_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Finalize multiple multipart uploads as one project-root product commit.

    Why this exists:
      The single-file ``/upload/complete`` endpoint pays a fixed
      per-commit overhead (negotiate + push RPCs, ~1.5–2s on a warm
      cache). For a folder of 100 files that adds up to 150–200s of
      sequential commits — and 100 nearly-identical entries in the
      audit log. This endpoint collapses that into one ``bulk_write``
      call -> one visible project-root commit.

    Failure model — partial success with HTTP 200:
      The response always carries one ``UploadCompleteItemResult``
      per input item, including failures. We chose this over
      "all-or-nothing 5xx" because:
        * the user has already paid the bandwidth to upload all
          parts; bouncing the whole batch would force them to
          re-upload every file
        * the typical failure mode is "one weird file" (mount path
          collision, ETag mismatch, S3 hiccup), not "everything is
          broken" — partial success degrades gracefully.
      Callers must walk ``items`` and surface failures per-file
      rather than treating the whole response as one transaction.

    Step-by-step:
      1. Per item: validate ownership + state + s3_key/upload_id
         echo. Items that fail validation are recorded immediately
         and excluded from later steps.
      2. Per surviving item: run S3
         ``CompleteMultipartUpload``. Failures here mark the task
         FAILED and are excluded from the bulk push.
      3. Single call to ``finalize_uploads_to_version_batch`` for all
         items that made it past steps 1–2. That helper does the
         CopyObject pre-stage + one project-root ``bulk_write``.
      4. Merge per-item results from each phase into a single
         ordered response, preserving the input ordering.
    """
    # ────────────────────────────────────────────────────────────────
    # Phase 1: validate (auth, state, echo cross-check). Build maps
    # that the later phases consume.
    # ────────────────────────────────────────────────────────────────
    item_results: dict[str, UploadCompleteItemResult] = {}
    eligible: list = []  # items that survive validation

    for item in request.items:
        task = etl_service.task_repository.get_task(item.task_id)
        if not task or (
            task.created_by is not None
            and task.created_by != current_user.user_id
        ):
            item_results[item.task_id] = UploadCompleteItemResult(
                task_id=item.task_id,
                status=IngestStatus.FAILED,
                error="Task not found",
            )
            continue

        if task.status != ETLTaskStatus.PENDING:
            item_results[item.task_id] = UploadCompleteItemResult(
                task_id=item.task_id,
                status=IngestStatus.FAILED,
                error=f"Task is not pending (status={task.status.value})",
            )
            continue

        expected_key = task.metadata.get("s3_key")
        expected_upload_id = task.metadata.get("upload_id")
        if expected_key != item.s3_key or expected_upload_id != item.upload_id:
            item_results[item.task_id] = UploadCompleteItemResult(
                task_id=item.task_id,
                status=IngestStatus.FAILED,
                error="s3_key/upload_id mismatch with the task",
            )
            continue

        eligible.append((item, task))

    # ────────────────────────────────────────────────────────────────
    # Phase 2: per-item S3 CompleteMultipartUpload — run in parallel.
    #
    # Each call is just sending an XML manifest to finalize an
    # already-uploaded object; no bytes flow at this point. The
    # operations are independent (different keys, different upload
    # ids) so there's no ordering constraint. Supabase Storage
    # handles bursts of 5–10 concurrent metadata operations
    # comfortably; we cap concurrency at 8 below as a defensive
    # ceiling for very large folder uploads.
    #
    # Sequential previously cost ~1s per file (the round-trip to
    # Supabase + the size-sanity HEAD afterwards). Going parallel
    # collapses that to ~1× one round-trip regardless of N.
    # ────────────────────────────────────────────────────────────────
    _COMPLETE_PARALLEL_LIMIT = 8
    completed_task_ids_set: set = set()
    completed_lock = asyncio.Lock()

    async def _finalize_one(item, task):
        """Complete one multipart upload + record outcome.

        Returns nothing; mutates ``item_results`` and
        ``completed_task_ids_set`` in place. Designed to be safe
        under ``asyncio.gather`` because each invocation only
        touches its own task record (the task repo is
        Supabase-backed; per-task PATCHes are independent).
        """
        parts = sorted(
            [(p.part_number, p.etag) for p in item.parts], key=lambda x: x[0]
        )
        try:
            await s3_service.complete_multipart_upload(
                item.s3_key, item.upload_id, parts
            )
        except Exception as e:
            logger.error(
                f"complete_multipart_upload failed for task {item.task_id}: {e}",
                exc_info=True,
            )
            try:
                await s3_service.abort_multipart_upload(
                    item.s3_key, item.upload_id
                )
            except Exception:
                pass
            task.mark_failed(f"Failed to finalize multipart upload: {e}")
            task.metadata["error_stage"] = "complete_multipart"
            etl_service.task_repository.update_task(task)
            item_results[item.task_id] = UploadCompleteItemResult(
                task_id=item.task_id,
                status=IngestStatus.FAILED,
                error=f"S3 complete_multipart_upload failed: {e}",
            )
            return

        # Sanity-check size as a non-fatal warning (consistent with
        # the single-file endpoint). Failure here just logs — we don't
        # block the upload on a missing HEAD.
        expected_size = task.metadata.get("size")
        try:
            meta = await s3_service.get_file_metadata(item.s3_key)
            if expected_size and meta.size != expected_size:
                logger.warning(
                    f"Task {item.task_id}: declared size {expected_size} "
                    f"differs from S3 size {meta.size}"
                )
        except Exception as e:
            logger.warning(
                f"Task {item.task_id}: head_object after complete failed: {e}"
            )

        async with completed_lock:
            completed_task_ids_set.add(task.task_id)

    sem = asyncio.Semaphore(_COMPLETE_PARALLEL_LIMIT)

    async def _bounded(item, task):
        async with sem:
            await _finalize_one(item, task)

    if eligible:
        await asyncio.gather(
            *(_bounded(item, task) for item, task in eligible),
            return_exceptions=False,  # _finalize_one swallows its own errors
        )

    # Preserve input order in completed_task_ids — the bulk finalize
    # downstream doesn't strictly require it, but it makes the
    # response easier to reason about for paginated UIs.
    completed_task_ids = [
        task.task_id for _, task in eligible
        if task.task_id in completed_task_ids_set
    ]

    # ────────────────────────────────────────────────────────────────
    # Phase 3: ONE bulk finalize for everything that made it this far.
    # ────────────────────────────────────────────────────────────────
    if completed_task_ids:
        from src.ingest.file.jobs.jobs import finalize_uploads_to_version_batch

        try:
            batch_results = await finalize_uploads_to_version_batch(
                task_ids=completed_task_ids,
                repo=etl_service.task_repository,
                s3=s3_service,
                state_repo=etl_service.state_repo,
            )
        except asyncio.CancelledError:
            # Surface a 504 — same contract as the single-file
            # endpoint, callers know to retry the whole batch.
            raise HTTPException(
                status_code=504,
                detail="Bulk finalize timed out writing to ObjectStore",
            )

        for r in batch_results:
            tid = r["task_id"]
            if r.get("ok"):
                if r.get("skipped"):
                    item_results[tid] = UploadCompleteItemResult(
                        task_id=tid,
                        status=IngestStatus.CANCELLED,
                        path=None,
                    )
                else:
                    item_results[tid] = UploadCompleteItemResult(
                        task_id=tid,
                        status=IngestStatus.COMPLETED,
                        path=r.get("path"),
                    )
            else:
                item_results[tid] = UploadCompleteItemResult(
                    task_id=tid,
                    status=IngestStatus.FAILED,
                    error=r.get("error") or "Finalize failed",
                )

    # ────────────────────────────────────────────────────────────────
    # Assemble the response in the original input order so clients can
    # zip results back to their own indices without bookkeeping.
    # ────────────────────────────────────────────────────────────────
    ordered: list[UploadCompleteItemResult] = []
    for item in request.items:
        result = item_results.get(item.task_id)
        if result is None:
            # Defensive: should never happen, but don't drop the item
            # from the response if some new failure mode slips past.
            result = UploadCompleteItemResult(
                task_id=item.task_id,
                status=IngestStatus.FAILED,
                error="Internal: item not processed",
            )
        ordered.append(result)

    return UploadCompleteBatchResponse(items=ordered)


@router.post("/upload/abort", response_model=UploadAbortResponse)
async def abort_upload(
    request: UploadAbortRequest,
    s3_service: S3Service = Depends(get_s3_service),
    etl_service: ETLService = Depends(get_etl_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Abort an in-flight multipart upload and mark the task cancelled.

    Idempotent: callable even if S3 has already cleaned up the
    multipart upload (we swallow ``NoSuchUpload``-style errors). The
    task transition to CANCELLED still happens so the client sees a
    stable terminal state.
    """
    task = etl_service.task_repository.get_task(request.task_id)
    if not task or (
        task.created_by is not None and task.created_by != current_user.user_id
    ):
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        await s3_service.abort_multipart_upload(
            request.s3_key, request.upload_id
        )
    except Exception as e:
        # The most common reason this fails is "already aborted/
        # completed", which is fine — we still want to flag the task
        # as cancelled so the UI converges.
        logger.warning(
            f"abort_multipart_upload for task {request.task_id} "
            f"raised (likely already gone): {e}"
        )

    if task.status == ETLTaskStatus.PENDING:
        task.mark_cancelled("Upload aborted by client")
        etl_service.task_repository.update_task(task)

    return UploadAbortResponse(task_id=str(task.task_id), cancelled=True)


# === SaaS/URL Submit Endpoint ===

def _detect_provider_from_url(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    host = parsed.netloc.lower()

    if scheme == "oauth":
        oauth_type = host or parsed.path.strip("/")
        mapping = {
            "gmail": "gmail",
            "drive": "google_drive",
            "google-drive": "google_drive",
            "calendar": "google_calendar",
            "google-calendar": "google_calendar",
        }
        return mapping.get(oauth_type, "url")

    if host in ("github.com", "www.github.com"):
        return "github"
    if host in ("notion.so", "www.notion.so") or "notion.site" in host:
        return "notion"
    if "airtable.com" in host:
        return "airtable"
    if "docs.google.com" in host and "/spreadsheets/" in url:
        return "google_sheets"
    if "docs.google.com" in host and "/document/" in url:
        return "google_docs"
    if "linear.app" in host:
        return "linear"
    if "drive.google.com" in host:
        return "google_drive"

    return "url"


def _suggest_import_name(provider: str, url: str) -> str | None:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if provider == "github":
        parts = [part for part in parsed.path.strip("/").split("/") if part]
        if len(parts) < 2:
            return None
        repo = parts[1][:-4] if parts[1].endswith(".git") else parts[1]
        repo = repo.strip().strip("/")
        return repo or None

    if provider == "url":
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host or None

    return None


@router.post("/submit/saas", response_model=IngestSubmitResponse, status_code=202)
async def submit_saas_ingest(
    project_id: str = Form(..., description="Target project ID"),
    url: str = Form(..., description="SaaS or Web URL"),
    name: str | None = Form(None, description="Custom name"),
    crawl_options: str | None = Form(None, description="JSON crawl options for generic web URLs"),

    # Dependencies
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit SaaS/URL ingest — routes through Bootstrap + SyncEngine.

    All data writes go through version transaction engine.
    """
    from src.connectors.datasource.dependencies import get_connector_registry
    from src.connectors.datasource.engine import SyncEngine
    from src.connectors.datasource.repository import SyncRepository
    from src.connectors.datasource.service import SyncService
    from src.infra.supabase.client import SupabaseClient

    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    provider = _detect_provider_from_url(url)

    try:
        registry = get_connector_registry()
        supabase = SupabaseClient()
        sync_repo = SyncRepository(supabase)

        sync_svc = SyncService(sync_repo=sync_repo)
        for p in registry.providers():
            connector = registry.get(p)
            if connector:
                sync_svc.register_connector(connector)

        from src.connectors.datasource.run_repository import SyncRunRepository
        engine = SyncEngine(
            registry=registry,
            sync_repo=sync_repo,
            run_repo=SyncRunRepository(supabase),
        )

        config = {"source_url": url}
        if name:
            config["name"] = name
        if provider == "url" and crawl_options:
            try:
                parsed_crawl_options = json.loads(crawl_options)
            except json.JSONDecodeError as exc:
                raise ValueError("crawl_options must be valid JSON") from exc
            if not isinstance(parsed_crawl_options, dict):
                raise ValueError("crawl_options must be a JSON object")
            config["crawl_options"] = parsed_crawl_options

        connector = registry.get(provider)
        if not connector and provider == "notion":
            # Until a dedicated Notion one-time connector exists, route pasted
            # Notion page URLs through the generic URL importer instead of
            # failing a visible import path.
            provider = "url"
            connector = registry.get(provider)
        if not connector:
            raise ValueError(f"Unknown import provider: {provider}")

        spec = connector.spec()
        if spec.creation_mode == "direct":
            if not config.get("name"):
                suggested_name = _suggest_import_name(provider, url)
                if suggested_name:
                    config["name"] = suggested_name
            syncs = [
                await sync_svc.create_sync(
                    project_id=project_id,
                    provider=provider,
                    config=config,
                    target_folder_path="",
                    direction="inbound",
                    sync_mode="import_once",
                    trigger={"type": "import_once"},
                    user_id=current_user.user_id,
                )
            ]
        else:
            syncs = await sync_svc.bootstrap(
                project_id=project_id,
                provider=provider,
                config=config,
                sync_mode="import_once",
                trigger={"type": "import_once"},
                user_id=current_user.user_id,
            )

        node_path = syncs[0].path if syncs else None
        execution_errors: list[str] = []

        for s in syncs:
            try:
                result = await engine.execute(s.id)
                if result and result.get("path"):
                    node_path = result["path"]
            except Exception as exc:
                logger.error(f"[SaaS ingest] First fetch failed for sync {s.id}: {exc}")
                execution_errors.append(str(exc))
                continue

            refreshed = sync_repo.get_by_id(s.id)
            if refreshed and refreshed.error_message:
                execution_errors.append(refreshed.error_message)

        if execution_errors:
            raise ValueError(execution_errors[0])

        return IngestSubmitResponse(
            items=[
                IngestSubmitItem(
                    task_id=syncs[0].id if syncs else "",
                    source_type=SourceType.SAAS if provider != "url" else SourceType.URL,
                    ingest_type=_provider_to_ingest_type(provider),
                    status=IngestStatus.COMPLETED,
                    path=node_path,
                )
            ],
            total=1,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"SaaS submit failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


def _provider_to_ingest_type(provider: str) -> IngestType:
    mapping = {
        "github": IngestType.GITHUB,
        "notion": IngestType.NOTION,
        "gmail": IngestType.GMAIL,
        "google_drive": IngestType.GOOGLE_DRIVE,
        "google_sheets": IngestType.GOOGLE_SHEETS,
        "google_docs": IngestType.GOOGLE_DOCS,
        "google_calendar": IngestType.GOOGLE_CALENDAR,
        "airtable": IngestType.AIRTABLE,
        "linear": IngestType.LINEAR,
        "url": IngestType.WEB_PAGE,
    }
    return mapping.get(provider, IngestType.WEB_PAGE)


# === Task Query Endpoints ===

@router.get("/tasks/{task_id}", response_model=IngestTaskResponse)
async def get_ingest_task(
    task_id: str,
    source_type: SourceType = Query(..., description="Task source type: file, saas, url"),
    service: IngestService = Depends(get_ingest_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    task = await service.get_task(task_id, source_type, current_user.user_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return task


@router.post("/tasks/batch", response_model=BatchTaskResponse)
async def batch_get_ingest_tasks(
    request: BatchQueryRequest,
    service: IngestService = Depends(get_ingest_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tasks = await service.batch_get_tasks(
        tasks=[t.model_dump() for t in request.tasks],
        user_id=current_user.user_id,
    )
    return BatchTaskResponse(tasks=tasks, total=len(tasks))


@router.delete("/tasks/{task_id}")
async def cancel_ingest_task(
    task_id: str,
    source_type: SourceType = Query(..., description="Task source type"),
    service: IngestService = Depends(get_ingest_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    success = await service.cancel_task(task_id, source_type, current_user.user_id)

    if not success:
        raise HTTPException(status_code=404, detail="Task not found or cannot cancel")

    return {"task_id": task_id, "cancelled": True}


# === Health Check ===

@router.get("/health")
async def get_ingest_health(
    response: Response,
    etl_service: ETLService = Depends(get_etl_service),
):
    from src.ingest.file.config import etl_config

    errors: list[str] = []
    file_worker = {
        "status": "ready",
        "queue_size": 0,
        "task_count": 0,
        "worker_count": etl_config.etl_worker_count,
    }

    try:
        file_worker["queue_size"] = etl_service.get_queue_size()
        file_worker["task_count"] = etl_service.get_task_count()
    except Exception as e:
        file_worker["status"] = "unhealthy"
        errors.append(f"file_worker_check_failed: {e}")

    status = "ready" if file_worker["status"] == "ready" else "degraded"
    if status != "ready":
        response.status_code = 503

    return {
        "status": status,
        "file_worker": file_worker,
        "errors": errors,
    }


# === Rules Management Endpoints ===

from src.ingest.file.rules.dependencies import get_rule_repository
from src.ingest.file.rules.repository_supabase import RuleRepositorySupabase
from src.ingest.file.rules.schemas import RuleCreateRequest
from src.ingest.file.schemas import (
    ETLRuleCreateRequest,
    ETLRuleListResponse,
    ETLRuleResponse,
)


@router.get("/rules", response_model=ETLRuleListResponse)
async def list_rules(
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
    limit: int = Query(50, ge=1, le=100, description="Maximum number of rules"),
    offset: int = Query(0, ge=0, description="Number of rules to skip"),
):
    try:
        from src.ingest.file.rules.default_rules import get_or_create_default_rule
        get_or_create_default_rule(rule_repository)
    except Exception as e:
        logger.warning(f"Failed to ensure global default rule: {e}")

    rules = rule_repository.list_rules(limit=limit, offset=offset)
    total = rule_repository.count_rules()

    rule_responses = [
        ETLRuleResponse(
            rule_id=rule.rule_id,
            name=rule.name,
            description=rule.description,
            json_schema=rule.json_schema,
            system_prompt=rule.system_prompt,
            postprocess_mode=getattr(rule, "postprocess_mode", None),
            postprocess_strategy=getattr(rule, "postprocess_strategy", None),
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )
        for rule in rules
    ]

    return ETLRuleListResponse(
        rules=rule_responses,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/rules", response_model=ETLRuleResponse, status_code=201)
async def create_rule(
    request: ETLRuleCreateRequest,
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
):
    try:
        rule_create = RuleCreateRequest(
            name=request.name,
            description=request.description,
            json_schema=request.json_schema,
            system_prompt=request.system_prompt,
            postprocess_mode=request.postprocess_mode or "llm",
            postprocess_strategy=request.postprocess_strategy,
        )

        rule = rule_repository.create_rule(rule_create)

        logger.info(f"ETL rule created: {rule.rule_id}")

        return ETLRuleResponse(
            rule_id=rule.rule_id,
            name=rule.name,
            description=rule.description,
            json_schema=rule.json_schema,
            system_prompt=rule.system_prompt,
            postprocess_mode=getattr(rule, "postprocess_mode", None),
            postprocess_strategy=getattr(rule, "postprocess_strategy", None),
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )

    except Exception as e:
        logger.error(f"Error creating rule: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rules/{rule_id}", response_model=ETLRuleResponse)
async def get_rule(
    rule_id: int,
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
):
    rule = rule_repository.get_rule(str(rule_id))

    if not rule:
        logger.warning(f"Rule not found: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

    return ETLRuleResponse(
        rule_id=rule.rule_id,
        name=rule.name,
        description=rule.description,
        json_schema=rule.json_schema,
        system_prompt=rule.system_prompt,
        postprocess_mode=getattr(rule, "postprocess_mode", None),
        postprocess_strategy=getattr(rule, "postprocess_strategy", None),
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: int,
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
):
    success = rule_repository.delete_rule(str(rule_id))

    if not success:
        logger.warning(f"Rule not found for deletion: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

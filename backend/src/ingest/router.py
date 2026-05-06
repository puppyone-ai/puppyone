"""
Ingest Router - Unified entry point API.

This router provides a unified interface for all data ingestion:
- FILE: Local file upload → File Worker (ETL)
- SAAS: SaaS platform sync → SyncEngine (synchronous execution)

Dual-layer routing architecture:
- Layer 1: mode (raw | ocr_parse)
- Layer 2: file_type (json | text | ocr_needed | binary)
"""

import base64
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile

from src.infra.s3.dependencies import get_s3_service
from src.infra.s3.exceptions import S3Error, S3FileSizeExceededError
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

JSON_EXTS = {'.json'}

TEXT_EXTS = {
    '.txt', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.java',
    '.c', '.cpp', '.h', '.html', '.css', '.xml', '.yaml', '.yml',
    '.csv', '.sh', '.sql', '.go', '.rs', '.rb', '.php', '.swift',
    '.kt', '.scala', '.r', '.m', '.pl', '.lua', '.dart', '.coffee',
    '.toml', '.ini', '.cfg', '.log', '.tsv', '.bat', '.ps1',
}

OCR_EXTS = {
    '.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.bmp', '.webp',
    '.doc', '.docx', '.ppt', '.pptx',
}


def classify_file_type(ext: str) -> str:
    ext_lower = ext.lower()
    if ext_lower in JSON_EXTS:
        return "json"
    elif ext_lower in TEXT_EXTS:
        return "text"
    elif ext_lower in OCR_EXTS:
        return "ocr_needed"
    else:
        return "binary"


# === File Upload Endpoint ===

@router.post("/submit/file", response_model=IngestSubmitResponse, status_code=202)
async def submit_file_ingest(
    # Required fields
    project_id: str = Form(..., description="Target project ID"),
    files: list[UploadFile] = File(..., description="Files to upload"),

    # Optional configuration
    mode: str = Form("ocr_parse", description="Processing mode: raw | ocr_parse"),
    rule_id: int | None = Form(None, description="ETL rule ID (for ocr_parse mode)"),
    parent_path: str | None = Form(None, description="Parent directory path for new files"),
    # Legacy alias kept so older frontend callers that still send
    # `parent_id` continue to land files in the intended MUT path.
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

    All text/JSON files are written directly to the Mut tree via MUT protocol.
    Binary/OCR files go to S3 + ETL Worker.
    """
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    from src.mut_engine.dependencies import create_mut_ops

    ops = create_mut_ops()

    target_parent_path = (parent_path or parent_id or "").strip("/")

    items: list[IngestSubmitItem] = []
    modified_files: dict[str, bytes] = {}

    for f in files:
        original_filename = f.filename or "file"
        original_basename = Path(original_filename).name
        _, ext = os.path.splitext(original_basename)

        content = await f.read()
        len(content)

        file_type = classify_file_type(ext)

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
                s3_key = await _upload_to_s3(
                    s3_service, project_id, original_filename, content, f.content_type
                )

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
            await ops.bulk_write(
                project_id,
                modified_files,
                who=f"ingest:{current_user.user_id}",
                message=f"Upload {len(modified_files)} file(s)",
            )
        except Exception as e:
            logger.error(f"MUT push failed during file ingest: {e}", exc_info=True)

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


@router.post("/submit/saas", response_model=IngestSubmitResponse, status_code=202)
async def submit_saas_ingest(
    project_id: str = Form(..., description="Target project ID"),
    url: str = Form(..., description="SaaS or Web URL"),
    name: str | None = Form(None, description="Custom name"),

    # Dependencies
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit SaaS/URL ingest — routes through Bootstrap + SyncEngine.

    All data writes go through MUT protocol.
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

        syncs = await sync_svc.bootstrap(
            project_id=project_id,
            provider=provider,
            config=config,
            sync_mode="import_once",
            trigger={"type": "import_once"},
            user_id=current_user.user_id,
        )

        node_path = syncs[0].path if syncs else None

        for s in syncs:
            try:
                await engine.execute(s.id)
            except Exception as exc:
                logger.error(f"[SaaS ingest] First fetch failed for sync {s.id}: {exc}")

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

"""
Ingest Router - Unified entry point API.

This router provides a unified interface for all data ingestion:
- FILE: Local file upload → File Worker (ETL)
- SAAS: SaaS platform sync → SaaS Worker (Import)
- URL: Generic URL crawl → SaaS Worker (Import)
"""

import base64
import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.project.dependencies import get_project_service
from src.project.service import ProjectService
from src.s3.dependencies import get_s3_service
from src.s3.service import S3Service
from src.s3.exceptions import S3Error, S3FileSizeExceededError
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService

from src.ingest.schemas import (
    SourceType,
    IngestType,
    IngestMode,
    IngestStatus,
    IngestSubmitItem,
    IngestSubmitResponse,
    IngestTaskResponse,
    BatchQueryRequest,
    BatchTaskResponse,
)
from src.ingest.dependencies import get_ingest_service
from src.ingest.service import IngestService
from src.ingest.shared.task.normalizers import detect_file_ingest_type

# Import underlying services for file processing
from src.ingest.file.dependencies import get_etl_service
from src.ingest.file.service import ETLService
from src.ingest.file.tasks.models import ETLTaskStatus
from src.ingest.file.exceptions import RuleNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])


# === File Upload Endpoint ===

@router.post("/submit/file", response_model=IngestSubmitResponse, status_code=202)
async def submit_file_ingest(
    # Required fields
    project_id: str = Form(..., description="Target project ID"),
    files: list[UploadFile] = File(..., description="Files to upload"),
    
    # Optional configuration
    mode: str = Form("smart", description="Processing mode: smart, raw, structured"),
    rule_id: Optional[int] = Form(None, description="ETL rule ID (for structured mode)"),
    node_id: Optional[str] = Form(None, description="Target node ID"),
    json_path: Optional[str] = Form(None, description="JSON Pointer mount path"),
    
    # Dependencies
    etl_service: ETLService = Depends(get_etl_service),
    s3_service: S3Service = Depends(get_s3_service),
    node_service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit file ingest tasks.
    
    Processing modes:
    - smart: Text files direct import; PDF/Image → OCR (File Worker)
    - raw: All files direct import (no OCR, just storage)
    - structured: All files → File Worker with specific rule
    """
    # Access checks
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    if node_id is not None:
        node = node_service.get_by_id(node_id, project_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

    mount_json_path = json_path or ""
    items: list[IngestSubmitItem] = []
    
    # Text file extensions for smart mode
    text_exts = {'.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', 
                 '.c', '.cpp', '.h', '.html', '.css', '.xml', '.yaml', '.yml', '.csv', '.sh', '.sql'}

    for f in files:
        original_filename = f.filename or "file"
        original_basename = Path(original_filename).name

        # Generate safe S3 key
        _, ext = os.path.splitext(original_basename)
        safe_filename = f"{uuid.uuid4()}{ext}"
        s3_key = f"projects/{project_id}/raw/{safe_filename}"

        # Upload to S3
        try:
            content = await f.read()
            original_filename_b64 = base64.b64encode(
                original_filename.encode("utf-8")
            ).decode("ascii")
            await s3_service.upload_file(
                key=s3_key,
                content=content,
                content_type=f.content_type,
                metadata={
                    "original_filename_b64": original_filename_b64,
                    "project_id": str(project_id),
                },
            )
        except S3FileSizeExceededError as e:
            task = await etl_service.create_failed_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                error=str(e),
                metadata={"error_stage": "upload"},
            )
            items.append(IngestSubmitItem(
                task_id=str(task.task_id or 0),
                source_type=SourceType.FILE,
                ingest_type=detect_file_ingest_type(original_filename),
                status=IngestStatus.FAILED,
                filename=original_filename,
                error=str(e),
            ))
            continue
        except (S3Error, Exception) as e:
            task = await etl_service.create_failed_task(
                user_id=current_user.user_id,
                project_id=project_id,
                filename=original_filename,
                rule_id=rule_id,
                error=f"Upload failed: {e}",
                metadata={"error_stage": "upload"},
            )
            items.append(IngestSubmitItem(
                task_id=str(task.task_id or 0),
                source_type=SourceType.FILE,
                ingest_type=detect_file_ingest_type(original_filename),
                status=IngestStatus.FAILED,
                filename=original_filename,
                error=str(e),
            ))
            continue

        # Determine processing logic based on mode and file type
        is_text_file = ext.lower() in text_exts
        should_use_worker = True

        if mode == "raw":
            should_use_worker = False
        elif mode == "smart":
            if is_text_file:
                should_use_worker = False
        elif mode == "structured":
            should_use_worker = True

        if should_use_worker:
            # Path A: Submit to File Worker (ETL)
            try:
                task = await etl_service.submit_etl_task(
                    user_id=current_user.user_id,
                    project_id=project_id,
                    filename=original_filename,
                    rule_id=rule_id,
                    s3_key=s3_key,
                )
            except RuleNotFoundError as e:
                task = await etl_service.create_failed_task(
                    user_id=current_user.user_id,
                    project_id=project_id,
                    filename=original_filename,
                    rule_id=rule_id,
                    error=str(e),
                    metadata={"error_stage": "submit", "s3_key": s3_key},
                )
                items.append(IngestSubmitItem(
                    task_id=str(task.task_id or 0),
                    source_type=SourceType.FILE,
                    ingest_type=detect_file_ingest_type(original_filename),
                    status=IngestStatus.FAILED,
                    filename=original_filename,
                    s3_key=s3_key,
                    error=str(e),
                ))
                continue
            
            # Persist mount plan into task metadata
            suffix = hashlib.sha1(s3_key.encode("utf-8")).hexdigest()
            mount_key = f"{original_basename}-{suffix[:8]}"
            task.metadata["mount_key"] = mount_key
            task.metadata["mount_json_path"] = mount_json_path
            if node_id is not None:
                task.metadata["mount_node_id"] = node_id
            else:
                task.metadata["auto_node_name"] = suffix[:10]
                task.metadata["auto_create_node"] = True
                
            task.metadata["s3_key"] = s3_key
            etl_service.task_repository.update_task(task)
            
            items.append(IngestSubmitItem(
                task_id=str(task.task_id or 0),
                source_type=SourceType.FILE,
                ingest_type=detect_file_ingest_type(original_filename),
                status=IngestStatus.PENDING if task.status == ETLTaskStatus.PENDING else IngestStatus.PROCESSING,
                filename=original_filename,
                s3_key=s3_key,
            ))

        else:
            # Path B: Direct Create (No Worker)
            try:
                # Calculate node type
                node_type = "file"
                if ext.lower() == '.pdf':
                    node_type = "pdf"
                elif ext.lower() in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}:
                    node_type = "image"
                elif ext.lower() == '.md':
                    node_type = "markdown"
                elif ext.lower() == '.json':
                    node_type = "json"

                # Direct create node content
                node_content = {}
                if is_text_file:
                    try:
                        text_content = content.decode("utf-8", errors="ignore")
                        if node_type == "json":
                            import json
                            try:
                                node_content = json.loads(text_content)
                            except Exception:
                                node_content = {"raw": text_content}
                        else:
                            node_content = text_content
                    except Exception as e:
                        logger.warning(f"Failed to decode text file {original_filename}: {e}")
                        node_content = {}
                else:
                    node_content = {
                        "s3_key": s3_key,
                        "filename": original_filename,
                        "size": len(content),
                        "mime_type": f.content_type
                    }

                # Create/Update node
                created_node_id = None
                if node_id:
                    await node_service.finalize_pending_node(
                        node_id=node_id,
                        project_id=project_id,
                        content=node_content,
                        new_name=original_filename,
                    )
                    created_node_id = node_id
                else:
                    logger.warning("Direct create without node_id not fully implemented")
                    created_node_id = "unknown"

                # Create a completed task for history/polling
                task = await etl_service.create_failed_task(
                    user_id=current_user.user_id,
                    project_id=project_id,
                    filename=original_filename,
                    rule_id=rule_id,
                    error="Skipped (Direct Import)",
                    metadata={
                        "mode": mode,
                        "skipped_worker": True,
                        "node_id": created_node_id
                    }
                )
                # Fix status to COMPLETED
                task.status = ETLTaskStatus.COMPLETED
                task.error = None
                task.progress = 100
                etl_service.task_repository.update_task(task)

                items.append(IngestSubmitItem(
                    task_id=str(task.task_id or 0),
                    source_type=SourceType.FILE,
                    ingest_type=detect_file_ingest_type(original_filename),
                    status=IngestStatus.COMPLETED,
                    filename=original_filename,
                    s3_key=s3_key,
                ))

            except Exception as e:
                logger.error(f"Direct import failed: {e}", exc_info=True)
                task = await etl_service.create_failed_task(
                    user_id=current_user.user_id,
                    project_id=project_id,
                    filename=original_filename,
                    rule_id=rule_id,
                    error=f"Direct import failed: {e}",
                    metadata={"error_stage": "direct_import"},
                )
                items.append(IngestSubmitItem(
                    task_id=str(task.task_id or 0),
                    source_type=SourceType.FILE,
                    ingest_type=detect_file_ingest_type(original_filename),
                    status=IngestStatus.FAILED,
                    filename=original_filename,
                    s3_key=s3_key,
                    error=str(e),
                ))

    return IngestSubmitResponse(items=items, total=len(items))


# === SaaS/URL Submit Endpoint ===

@router.post("/submit/saas", response_model=IngestSubmitResponse, status_code=202)
async def submit_saas_ingest(
    project_id: str = Form(..., description="Target project ID"),
    url: str = Form(..., description="SaaS or Web URL"),
    name: Optional[str] = Form(None, description="Custom name"),
    
    # Dependencies
    service: IngestService = Depends(get_ingest_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit SaaS/URL ingest task.
    
    Supported URLs:
    - GitHub: https://github.com/owner/repo
    - Notion: https://notion.so/page-id
    - Google Sheets: https://docs.google.com/spreadsheets/d/...
    - Airtable: https://airtable.com/...
    - Generic URL: Any web page (via Firecrawl)
    """
    # Access checks
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        item = await service.submit_saas(
            user_id=current_user.user_id,
            project_id=project_id,
            url=url,
            name=name,
        )
        return IngestSubmitResponse(items=[item], total=1)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"SaaS submit failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to submit import task")


# === Task Query Endpoints ===

@router.get("/tasks/{task_id}", response_model=IngestTaskResponse)
async def get_ingest_task(
    task_id: str,
    source_type: SourceType = Query(..., description="Task source type: file, saas, url"),
    service: IngestService = Depends(get_ingest_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get task status.
    
    Must provide source_type to route to the correct service.
    """
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
    """
    Batch query task statuses.
    """
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
    """Cancel a task."""
    success = await service.cancel_task(task_id, source_type, current_user.user_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or cannot cancel")
    
    return {"task_id": task_id, "cancelled": True}


# === Health Check ===

@router.get("/health")
async def get_ingest_health(
    etl_service: ETLService = Depends(get_etl_service),
):
    """
    Get ingest service health status.
    """
    from src.ingest.file.config import etl_config
    
    return {
        "status": "healthy",
        "file_worker": {
            "queue_size": etl_service.get_queue_size(),
            "task_count": etl_service.get_task_count(),
            "worker_count": etl_config.etl_worker_count,
        },
        "saas_worker": {
            "status": "healthy",  # TODO: Add actual health check
        }
    }


# === Rules Management Endpoints ===

from src.ingest.file.rules.repository_supabase import RuleRepositorySupabase
from src.ingest.file.rules.schemas import RuleCreateRequest
from src.ingest.file.rules.dependencies import get_rule_repository
from src.ingest.file.schemas import (
    ETLRuleCreateRequest,
    ETLRuleResponse,
    ETLRuleListResponse,
)


@router.get("/rules", response_model=ETLRuleListResponse)
async def list_rules(
    rule_repository: Annotated[RuleRepositorySupabase, Depends(get_rule_repository)],
    limit: int = Query(50, ge=1, le=100, description="Maximum number of rules"),
    offset: int = Query(0, ge=0, description="Number of rules to skip"),
):
    """
    List all ETL rules for current user.
    """
    # Ensure global default rule is discoverable
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
    """
    Create a new ETL rule for current user.
    """
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
    """
    Get an ETL rule by ID.
    """
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
    """
    Delete an ETL rule.
    """
    success = rule_repository.delete_rule(str(rule_id))

    if not success:
        logger.warning(f"Rule not found for deletion: {rule_id}")
        raise HTTPException(status_code=404, detail="Rule not found")

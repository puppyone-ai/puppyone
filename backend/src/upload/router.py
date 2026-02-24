"""
Ingest Router - Unified entry point API.

This router provides a unified interface for all data ingestion:
- FILE: Local file upload → File Worker (ETL)
- SAAS: SaaS platform sync → SaaS Worker (Import)
- URL: Generic URL crawl → SaaS Worker (Import)

双层路由架构:
- Layer 1: mode (raw | ocr_parse)
- Layer 2: file_type (json | text | ocr_needed | binary)
"""

import base64
import hashlib
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.project.dependencies import get_project_service
from src.project.service import ProjectService
from src.s3.dependencies import get_s3_service
from src.s3.service import S3Service
from src.s3.exceptions import S3Error, S3FileSizeExceededError
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService

from src.upload.schemas import (
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
from src.upload.dependencies import get_ingest_service
from src.upload.service import IngestService
from src.upload.shared.task.normalizers import detect_file_ingest_type

# Import underlying services for file processing
from src.upload.file.dependencies import get_etl_service
from src.upload.file.service import ETLService
from src.upload.file.tasks.models import ETLTaskStatus
from src.upload.file.exceptions import RuleNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

# === File Type Classification ===

# JSON 文件扩展名
JSON_EXTS = {'.json'}

# 文本文件扩展名（可直接读取内容）
TEXT_EXTS = {
    '.txt', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', 
    '.c', '.cpp', '.h', '.html', '.css', '.xml', '.yaml', '.yml', 
    '.csv', '.sh', '.sql', '.go', '.rs', '.rb', '.php', '.swift',
    '.kt', '.scala', '.r', '.m', '.pl', '.lua', '.dart', '.coffee',
    '.toml', '.ini', '.cfg', '.log', '.tsv', '.bat', '.ps1',
}

# 需要 OCR 的文件扩展名
OCR_EXTS = {
    '.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.bmp', '.webp',
    '.doc', '.docx', '.ppt', '.pptx',
}


def classify_file_type(ext: str) -> str:
    """
    分类文件类型
    
    Returns:
        "json" | "text" | "ocr_needed" | "binary"
    """
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
    rule_id: Optional[int] = Form(None, description="ETL rule ID (for ocr_parse mode)"),
    parent_id: Optional[str] = Form(None, description="Parent node ID for new nodes"),
    
    # Dependencies
    etl_service: ETLService = Depends(get_etl_service),
    s3_service: S3Service = Depends(get_s3_service),
    node_service: ContentNodeService = Depends(get_content_node_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Submit file ingest tasks.
    
    双层路由架构:
    
    Layer 1 - mode:
      - raw: 原始存储（所有文件直接存储，不做 OCR）
      - ocr_parse: 智能解析（文本直接存，OCR 文件走 Worker）
    
    Layer 2 - file_type (基于扩展名自动判断):
      - json: .json → preview_json (不存 S3)
      - text: .md/.txt/.py/... → preview_md (不存 S3)
      - ocr_needed: .pdf/.jpg/.docx/... → S3 + ETL Worker → preview_md
      - binary: 其他 → S3 only (无预览)
    
    存储规则:
      ┌──────────┬────────────┬─────────────┬────────────┬────────────┬─────────┐
      │  mode    │ file_type  │    type     │preview_json│ preview_md │  s3_key │
      ├──────────┼────────────┼─────────────┼────────────┼────────────┼─────────┤
      │ raw      │ json       │ json        │ ✓          │ -          │ -       │
      │ raw      │ text       │ markdown    │ -          │ ✓          │ -       │
      │ raw      │ ocr_needed │ file        │ -          │ -          │ ✓       │
      │ raw      │ binary     │ file        │ -          │ -          │ ✓       │
      │ ocr_parse│ json       │ json        │ ✓          │ -          │ -       │
      │ ocr_parse│ text       │ markdown    │ -          │ ✓          │ -       │
      │ ocr_parse│ ocr_needed │ file        │ -          │ ✓ (OCR后)  │ ✓       │
      │ ocr_parse│ binary     │ file        │ -          │ -          │ ✓       │
      └──────────┴────────────┴─────────────┴────────────┴────────────┴─────────┘
      
      type 直接决定前端渲染方式（folder/json/markdown/file/github_repo/...）
    """
    # Access checks
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate parent_id if provided
    if parent_id is not None:
        parent_node = node_service.get_by_id(parent_id, project_id)
        if not parent_node:
            raise HTTPException(status_code=404, detail="Parent node not found")

    items: list[IngestSubmitItem] = []

    for f in files:
        original_filename = f.filename or "file"
        original_basename = Path(original_filename).name
        _, ext = os.path.splitext(original_basename)
        
        # 读取文件内容
        content = await f.read()
        content_size = len(content)
        
        # 分类文件类型
        file_type = classify_file_type(ext)
        
        try:
            # ═══════════════════════════════════════════════════════════════
            # 根据 mode + file_type 决定处理方式
            # ═══════════════════════════════════════════════════════════════
            
            if file_type == "json":
                # ─────────────────────────────────────────────────────────
                # JSON 文件：直接存 preview_json，不存 S3
                # ─────────────────────────────────────────────────────────
                try:
                    text_content = content.decode("utf-8", errors="ignore")
                    json_data = json.loads(text_content)
                except json.JSONDecodeError as e:
                    # JSON 解析失败，作为文本处理
                    logger.warning(f"JSON parse failed for {original_filename}: {e}")
                    json_data = {"_raw": content.decode("utf-8", errors="ignore"), "_parse_error": str(e)}
                
                node = node_service.create_json_node(
                    project_id=project_id,
                    name=original_basename,
                    content=json_data,
                    parent_id=parent_id,
                    created_by=current_user.user_id,
                )
                
                # 创建完成状态的任务记录（用于前端轮询）
                task = await _create_completed_task(
                    etl_service, current_user.user_id, project_id, 
                    original_filename, rule_id, node.id, "json"
                )
                items.append(_make_completed_item(task, original_filename, node.id))
                
            elif file_type == "text":
                # ─────────────────────────────────────────────────────────
                # 文本文件：直接存 preview_md，不存 S3
                # ─────────────────────────────────────────────────────────
                text_content = content.decode("utf-8", errors="ignore")
                
                node = await node_service.create_markdown_node(
                    project_id=project_id,
                    name=original_basename,
                    content=text_content,
                    parent_id=parent_id,
                    created_by=current_user.user_id,
                )
                
                task = await _create_completed_task(
                    etl_service, current_user.user_id, project_id,
                    original_filename, rule_id, node.id, "markdown"
                )
                items.append(_make_completed_item(task, original_filename, node.id))
                
            elif file_type == "ocr_needed" and mode == "ocr_parse":
                # ─────────────────────────────────────────────────────────
                # OCR 文件 + ocr_parse 模式：上传 S3 + 提交 ETL Worker
                # ─────────────────────────────────────────────────────────
                # 1. 上传到 S3
                s3_key = await _upload_to_s3(
                    s3_service, project_id, original_filename, content, f.content_type
                )
                
                # 2. 创建 pending 节点
                pending_node = node_service.create_pending_node(
                    project_id=project_id,
                    name=original_basename,
                    parent_id=parent_id,
                    created_by=current_user.user_id,
                    s3_key=s3_key,
                    mime_type=f.content_type,
                    size_bytes=content_size,
                )
                
                # 3. 提交 ETL 任务
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
                        await etl_service.create_failed_task(
                            current_user.user_id, project_id, original_filename, rule_id, str(e)
                        ),
                        original_filename, s3_key, str(e)
                    ))
                    continue
                
                # 4. 记录挂载信息
                task.metadata["mount_node_id"] = pending_node.id
                task.metadata["s3_key"] = s3_key
                etl_service.task_repository.update_task(task)
                
                items.append(IngestSubmitItem(
                    task_id=str(task.task_id or 0),
                    source_type=SourceType.FILE,
                    ingest_type=detect_file_ingest_type(original_filename),
                    status=IngestStatus.PENDING if task.status == ETLTaskStatus.PENDING else IngestStatus.PROCESSING,
                    filename=original_filename,
                    s3_key=s3_key,
                    node_id=pending_node.id,
                ))

            else:
                # ─────────────────────────────────────────────────────────
                # 二进制文件（或 raw 模式下的 OCR 文件）：上传 S3，创建 file 节点
                # ─────────────────────────────────────────────────────────
                # 上传到 S3
                s3_key = await _upload_to_s3(
                    s3_service, project_id, original_filename, content, f.content_type
                )
                
                # 创建 file 节点（无预览）
                node = node_service.create_file_node(
                    project_id=project_id,
                    name=original_basename,
                    s3_key=s3_key,
                    mime_type=f.content_type,
                    size_bytes=content_size,
                    parent_id=parent_id,
                    created_by=current_user.user_id,
                )
                
                task = await _create_completed_task(
                    etl_service, current_user.user_id, project_id,
                    original_filename, rule_id, node.id, "file"
                )
                items.append(_make_completed_item(task, original_filename, node.id, s3_key))
                
        except S3FileSizeExceededError as e:
            items.append(_make_failed_item(
                await etl_service.create_failed_task(
                    current_user.user_id, project_id, original_filename, rule_id, str(e),
                    metadata={"error_stage": "upload"}
                ),
                original_filename, None, str(e)
            ))
        except (S3Error, Exception) as e:
            logger.error(f"File ingest failed for {original_filename}: {e}", exc_info=True)
            items.append(_make_failed_item(
                await etl_service.create_failed_task(
                    current_user.user_id, project_id, original_filename, rule_id, f"Import failed: {e}",
                    metadata={"error_stage": "process"}
                ),
                original_filename, None, str(e)
            ))

    return IngestSubmitResponse(items=items, total=len(items))


# === Helper Functions ===

async def _upload_to_s3(
    s3_service: S3Service,
    project_id: str,
    original_filename: str,
    content: bytes,
    content_type: Optional[str],
) -> str:
    """上传文件到 S3，返回 s3_key"""
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


async def _create_completed_task(
    etl_service: ETLService,
    user_id: str,
    project_id: str,
    filename: str,
    rule_id: Optional[int],
    node_id: str,
    node_type: str,
):
    """创建一个已完成状态的任务记录（用于前端轮询和历史记录）"""
    task = await etl_service.create_failed_task(
        user_id=user_id,
        project_id=project_id,
        filename=filename,
        rule_id=rule_id,
        error="Direct import completed",
        metadata={
            "direct_import": True,
            "node_id": node_id,
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
    node_id: str,
    s3_key: Optional[str] = None,
) -> IngestSubmitItem:
    """创建完成状态的响应项"""
    return IngestSubmitItem(
        task_id=str(task.task_id or 0),
        source_type=SourceType.FILE,
        ingest_type=detect_file_ingest_type(filename),
        status=IngestStatus.COMPLETED,
        filename=filename,
        s3_key=s3_key,
        node_id=node_id,
    )


def _make_failed_item(
    task,
    filename: str,
    s3_key: Optional[str],
    error: str,
) -> IngestSubmitItem:
    """创建失败状态的响应项"""
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
    response: Response,
    etl_service: ETLService = Depends(get_etl_service),
):
    """
    Get ingest service readiness status.
    """
    from src.upload.file.config import etl_config

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

    # 当前尚无统一的 SaaS worker 健康探针，先显式标记 unknown，避免误报 healthy。
    saas_worker = {
        "status": "unknown",
    }

    status = "ready" if file_worker["status"] == "ready" else "degraded"
    if status != "ready":
        response.status_code = 503

    return {
        "status": status,
        "file_worker": file_worker,
        "saas_worker": saas_worker,
        "errors": errors,
    }


# === Rules Management Endpoints ===

from src.upload.file.rules.repository_supabase import RuleRepositorySupabase
from src.upload.file.rules.schemas import RuleCreateRequest
from src.upload.file.rules.dependencies import get_rule_repository
from src.upload.file.schemas import (
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
        from src.upload.file.rules.default_rules import get_or_create_default_rule
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

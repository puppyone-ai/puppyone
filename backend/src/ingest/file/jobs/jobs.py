"""
ETL ARQ Jobs

OCR job enqueues postprocess job on success.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

from src.ingest.file.config import etl_config
from src.ingest.file.exceptions import ETLTransformationError
from src.ingest.file.ocr.base import OCRProvider, OCRProviderError
from src.ingest.file.rules.engine import RuleEngine
from src.ingest.file.rules.repository_supabase import RuleRepositorySupabase
from src.ingest.file.state.models import ETLPhase, ETLRuntimeState
from src.ingest.file.state.repository import ETLStateRepositoryRedis
from src.ingest.file.tasks.models import ETLTaskResult, ETLTaskStatus
from src.exceptions import BusinessException, ErrorCode
from src.content_node.repository import ContentNodeRepository
from src.content_node.service import ContentNodeService
from src.s3.service import S3Service
from src.supabase.client import SupabaseClient

logger = logging.getLogger(__name__)


def _artifact_markdown_key(task_id: int, user_id: str, project_id: str) -> str:
    # Avoid using filename here (can have special chars). Use deterministic keys.
    return f"users/{user_id}/etl_artifacts/{project_id}/{task_id}/mineru.md"


def _output_json_key(task_id: int, user_id: str, project_id: str) -> str:
    return f"users/{user_id}/processed/{project_id}/{task_id}.json"


def _chunk_text(text: str, chunk_size: int, max_chunks: int) -> list[str]:
    if chunk_size <= 0:
        return [text]
    chunks: list[str] = []
    for i in range(0, len(text), chunk_size):
        if len(chunks) >= max_chunks:
            break
        chunks.append(text[i : i + chunk_size])
    return chunks


async def etl_ocr_job(ctx: dict, task_id: int) -> dict:
    """
    OCR stage: Parse document -> upload markdown artifact -> enqueue postprocess job.
    
    Supports multiple OCR providers (MineRU, Reducto, etc.) via pluggable OCRProvider interface.
    """
    repo = ctx["task_repository"]
    s3 = ctx["s3_service"]
    ocr_provider: OCRProvider = ctx["ocr_provider"]
    state_repo: ETLStateRepositoryRedis = ctx["state_repo"]
    queue_name: str = ctx["arq_queue_name"]

    task = repo.get_task(task_id)
    if not task:
        logger.warning(f"etl_ocr_job: task not found: {task_id}")
        return {"ok": False, "error": "task_not_found"}

    # Respect DB-level cancellation as a safety net (e.g. Redis state expired)
    if task.status == ETLTaskStatus.CANCELLED:
        logger.info(f"etl_ocr_job: task cancelled in DB, skip: {task_id}")
        return {"ok": True, "skipped": "cancelled"}

    # Runtime state init or load
    state = await state_repo.get(task_id)
    if state is None:
        state = ETLRuntimeState(
            task_id=task_id,
            user_id=task.user_id,
            project_id=task.project_id,
            filename=task.filename,
            rule_id=task.rule_id,
        )

    if state.status == ETLTaskStatus.CANCELLED:
        logger.info(f"etl_ocr_job: task cancelled, skip: {task_id}")
        return {"ok": True, "skipped": "cancelled"}

    state.phase = ETLPhase.OCR
    state.status = ETLTaskStatus.MINERU_PARSING
    state.progress = max(state.progress, 10)
    state.attempt_ocr += 1
    state.touch()
    await state_repo.set(state)

    started_at = time.time()
    try:
        # Resolve source S3 key
        if "s3_key" in task.metadata:
            source_key = task.metadata["s3_key"]
        else:
            source_key = f"users/{task.user_id}/raw/{task.project_id}/{task.filename}"

        presigned_url = await s3.generate_presigned_download_url(
            source_key, expires_in=3600
        )

        # Use pluggable OCR provider (MineRU, Reducto, etc.)
        parsed = await ocr_provider.parse_document(
            file_url=presigned_url,
            data_id=str(task_id),
        )

        # If user cancelled while we were waiting on provider, honor cancellation and avoid overwriting terminal state.
        latest = await state_repo.get(task_id)
        if (
            latest and latest.status == ETLTaskStatus.CANCELLED
        ) or task.status == ETLTaskStatus.CANCELLED:
            logger.info(f"etl_ocr_job: cancelled during provider wait, skip: {task_id}")
            return {"ok": True, "skipped": "cancelled"}

        state.provider_task_id = parsed.task_id
        state.progress = max(state.progress, 40)
        await state_repo.set(state)

        # Upload markdown artifact to S3
        md_key = _artifact_markdown_key(task_id, task.user_id, task.project_id)
        await s3.upload_file(
            key=md_key,
            content=parsed.markdown_content.encode("utf-8"),
            content_type="text/markdown",
            metadata={"task_id": str(task_id), "provider_task_id": parsed.task_id},
        )
        state.artifact_mineru_markdown_key = md_key
        state.progress = max(state.progress, 55)
        await state_repo.set(state)

        latest = await state_repo.get(task_id)
        if (
            latest and latest.status == ETLTaskStatus.CANCELLED
        ) or task.status == ETLTaskStatus.CANCELLED:
            logger.info(
                f"etl_ocr_job: cancelled before enqueue postprocess, skip: {task_id}"
            )
            return {"ok": True, "skipped": "cancelled"}

        # Enqueue postprocess
        job = await ctx["redis"].enqueue_job(
            "etl_postprocess_job", task_id, _queue_name=queue_name
        )
        state.arq_job_id_postprocess = job.job_id
        state.phase = ETLPhase.POSTPROCESS
        state.status = ETLTaskStatus.LLM_PROCESSING
        state.progress = max(state.progress, 60)
        await state_repo.set(state)

        elapsed = time.time() - started_at
        return {"ok": True, "stage": "ocr", "seconds": elapsed, "markdown_key": md_key}

    except asyncio.CancelledError:
        # ARQ enforces WorkerSettings.job_timeout via asyncio.wait_for which cancels the job task.
        # On Python 3.12, asyncio.CancelledError inherits BaseException, so a plain `except Exception`
        # won't run and the runtime state would stay stuck at MINERU_PARSING.
        state.status = ETLTaskStatus.FAILED
        state.error_stage = "timeout"
        state.error_message = f"ETL OCR job timed out (>{etl_config.etl_task_timeout}s)"
        state.progress = 0
        await state_repo.set_terminal(state)

        task.status = ETLTaskStatus.FAILED
        task.error = state.error_message
        task.metadata.update(
            {"error_stage": "timeout", "provider_task_id": state.provider_task_id}
        )
        repo.update_task(task)
        logger.error(f"etl_ocr_job timeout task_id={task_id}")
        return {"ok": False, "stage": "ocr", "error": state.error_message}

    except OCRProviderError as e:
        # Handle OCR provider-specific errors
        state.status = ETLTaskStatus.FAILED
        state.error_stage = f"ocr_{e.provider}"
        state.error_message = str(e)
        state.progress = 0
        await state_repo.set_terminal(state)

        task.status = ETLTaskStatus.FAILED
        task.error = str(e)
        task.metadata.update(
            {
                "error_stage": f"ocr_{e.provider}",
                "provider_task_id": state.provider_task_id,
            }
        )
        repo.update_task(task)
        logger.error(f"etl_ocr_job failed task_id={task_id}: {e}")
        return {"ok": False, "stage": "ocr", "error": str(e)}

    except Exception as e:
        # Handle unexpected errors
        state.status = ETLTaskStatus.FAILED
        state.error_stage = f"ocr_{ocr_provider.name}"
        state.error_message = str(e)
        state.progress = 0
        await state_repo.set_terminal(state)

        task.status = ETLTaskStatus.FAILED
        task.error = str(e)
        task.metadata.update(
            {
                "error_stage": f"ocr_{ocr_provider.name}",
                "provider_task_id": state.provider_task_id,
            }
        )
        repo.update_task(task)
        logger.error(f"etl_ocr_job failed task_id={task_id}: {e}", exc_info=True)
        return {"ok": False, "stage": "ocr", "error": str(e)}


async def etl_postprocess_job(ctx: dict, task_id: int) -> dict:
    """
    Postprocess stage: load markdown artifact -> apply rule (LLM) -> upload JSON -> persist terminal state.
    """
    repo = ctx["task_repository"]
    s3 = ctx["s3_service"]
    llm = ctx["llm_service"]
    state_repo: ETLStateRepositoryRedis = ctx["state_repo"]

    task = repo.get_task(task_id)
    if not task:
        logger.warning(f"etl_postprocess_job: task not found: {task_id}")
        return {"ok": False, "error": "task_not_found"}

    # Respect DB-level cancellation as a safety net (e.g. Redis state expired)
    if task.status == ETLTaskStatus.CANCELLED:
        logger.info(f"etl_postprocess_job: task cancelled in DB, skip: {task_id}")
        return {"ok": True, "skipped": "cancelled"}

    state = await state_repo.get(task_id)
    if state and state.status == ETLTaskStatus.CANCELLED:
        logger.info(f"etl_postprocess_job: task cancelled, skip: {task_id}")
        return {"ok": True, "skipped": "cancelled"}

    # Ensure state exists
    if state is None:
        state = ETLRuntimeState(
            task_id=task_id,
            user_id=task.user_id,
            project_id=task.project_id,
            filename=task.filename,
            rule_id=task.rule_id,
            status=ETLTaskStatus.LLM_PROCESSING,
            phase=ETLPhase.POSTPROCESS,
            progress=60,
        )

    state.phase = ETLPhase.POSTPROCESS
    state.status = ETLTaskStatus.LLM_PROCESSING
    state.progress = max(state.progress, 60)
    state.attempt_postprocess += 1
    state.touch()
    await state_repo.set(state)

    started_at = time.time()
    try:
        md_key = state.artifact_mineru_markdown_key or task.metadata.get(
            "artifact_mineru_markdown_key"
        )
        if not md_key:
            raise RuntimeError("Missing markdown artifact key for postprocess")

        markdown_bytes = await s3.download_file(md_key)
        markdown = markdown_bytes.decode("utf-8")

        # Load rule (per-user)
        # NOTE: We manually create instances here instead of using FastAPI Depends()
        # because Worker runs outside the FastAPI request context.
        # RuleRepositorySupabase expects supabase.Client (with .table()), not our wrapper class.
        supabase_client = SupabaseClient().client
        rule_repo = RuleRepositorySupabase(
            supabase_client=supabase_client, user_id=task.user_id
        )
        rule = rule_repo.get_rule(str(task.rule_id))
        if not rule:
            raise RuntimeError(f"Rule not found: {task.rule_id}")

        # postprocess_mode=skip: no LLM calls, only wrap markdown pointer and metadata
        if getattr(rule, "postprocess_mode", "llm") == "skip":
            # BREAKING: default skip-mode output should expose markdown content directly for mounting,
            # and MUST NOT leak internal metadata (task_id/user_id/project_id/S3 keys).
            base_name = Path(task.filename).stem
            output_obj = {
                base_name: {
                    "filename": task.filename,
                    "content": markdown,
                }
            }
        else:
            # Strategy selection
            strategy = getattr(rule, "postprocess_strategy", None)
            if not strategy:
                if len(markdown) > etl_config.etl_postprocess_chunk_threshold_chars:
                    strategy = "chunked-summarize"
                else:
                    strategy = "direct-json"

            input_text = markdown
            if strategy == "chunked-summarize":
                chunks = _chunk_text(
                    markdown,
                    chunk_size=etl_config.etl_postprocess_chunk_size_chars,
                    max_chunks=etl_config.etl_postprocess_max_chunks,
                )
                summaries: list[str] = []
                for idx, ch in enumerate(chunks, start=1):
                    resp = await llm.call_text_model(
                        prompt=(
                            "请将以下文档分块内容总结为要点（保留关键字段名/数值/表格信息），输出纯文本。\n\n"
                            f"分块 {idx}/{len(chunks)}:\n{ch}"
                        ),
                        system_prompt="你是一个严谨的文档摘要助手。",
                        response_format="text",
                    )
                    summaries.append(resp.content)
                input_text = "\n\n".join(
                    [f"## Chunk {i + 1} Summary\n{t}" for i, t in enumerate(summaries)]
                )

            engine = RuleEngine(llm)
            transform = await engine.apply_rule(markdown_content=input_text, rule=rule)
            if not transform.success:
                raise ETLTransformationError(
                    transform.error or "Unknown error", str(task.rule_id)
                )
            output_obj = transform.output

        latest = await state_repo.get(task_id)
        if (
            latest and latest.status == ETLTaskStatus.CANCELLED
        ) or task.status == ETLTaskStatus.CANCELLED:
            logger.info(
                f"etl_postprocess_job: cancelled before upload, skip: {task_id}"
            )
            return {"ok": True, "skipped": "cancelled"}

        output_key = _output_json_key(task_id, task.user_id, task.project_id)
        output_json = json.dumps(output_obj, indent=2, ensure_ascii=False).encode(
            "utf-8"
        )
        await s3.upload_file(
            key=output_key,
            content=output_json,
            content_type="application/json",
            metadata={"task_id": str(task_id), "rule_id": str(task.rule_id)},
        )

        processing_time = time.time() - started_at
        result = ETLTaskResult(
            output_path=output_key,
            output_size=len(output_json),
            processing_time=processing_time,
            mineru_task_id=state.provider_task_id,
        )

        # Auto-mount after output is generated (this replaces legacy mount endpoint & callbacks)
        mount_node_id = task.metadata.get("mount_node_id")
        mount_json_path = task.metadata.get("mount_json_path") or ""
        mount_key = task.metadata.get("mount_key") or Path(task.filename).name

        # Create ContentNodeService manually (Worker has no FastAPI Depends context)
        _supabase = SupabaseClient()
        _repo = ContentNodeRepository(_supabase)
        _s3 = S3Service()
        node_service = ContentNodeService(_repo, _s3)

        if not mount_node_id:
            # Auto-create a JSON node per file when mount target is not provided
            auto_name = task.metadata.get("auto_node_name") or f"{task_id}"
            auto_name = str(auto_name)[:12]
            created_node = await asyncio.to_thread(
                node_service.create_json_node,
                project_id=task.project_id,
                name=auto_name,
                content={},
                parent_id=None,
                created_by=task.user_id,
            )
            mount_node_id = created_node.id
            task.metadata["mount_node_id"] = mount_node_id
            task.metadata["auto_node_created"] = True

        # Avoid double-wrapping on mount:
        # - skip-mode output_obj shape is {base_name: {filename, content}}
        # - mount_key is already a per-file unique key (filename+hash), so we mount the inner payload.
        if getattr(rule, "postprocess_mode", "llm") == "skip":
            base_name = Path(task.filename).stem
            mount_value: Any = (
                output_obj.get(base_name, output_obj)
                if isinstance(output_obj, dict)
                else output_obj
            )
        else:
            mount_value = output_obj

        try:
            # Check if target node is a pending node (方案 B: 直接更新节点)
            existing_node = await asyncio.to_thread(
                node_service.get_by_id, mount_node_id, task.project_id
            )
            
            # Check if it's a pending file (type='file' with no preview_type)
            is_pending = existing_node.type == "file" and existing_node.preview_type is None
            if is_pending:
                # ─────────────────────────────────────────────────────────────
                # Pending 节点处理：填充 preview_md，type 保持 "file" 不变
                # 语义：type=原始本质, preview_type=Agent看到什么
                # ─────────────────────────────────────────────────────────────
                # 提取 markdown 内容
                if isinstance(mount_value, dict) and "content" in mount_value:
                    markdown_content = mount_value["content"]
                elif isinstance(mount_value, str):
                    markdown_content = mount_value
                else:
                    markdown_content = markdown  # 使用原始 markdown
                
                # type 保持 "file"，文件名也保持原始（IMG_4561.PNG 就是 IMG_4561.PNG）
                # 只更新 preview_type 和 preview_md
                await node_service.finalize_pending_node(
                    node_id=mount_node_id,
                    project_id=task.project_id,
                    content=markdown_content,
                    # new_name=None → 不改名
                )
                logger.info(f"ETL: Filled preview for pending node {mount_node_id}")
                # Pending 节点处理完成，跳过后面的 JSON 挂载逻辑
            else:
                # ─────────────────────────────────────────────────────────────
                # 传统逻辑：挂载到已存在的 JSON 节点
                # ─────────────────────────────────────────────────────────────
                existing_content = existing_node.preview_json or {}
            
            # Merge data at the specified path
            if mount_json_path:
                path_parts = [p for p in mount_json_path.split("/") if p]
                current = existing_content
                for part in path_parts[:-1]:
                    if part not in current:
                        current[part] = {}
                    current = current[part]
                if path_parts:
                    current[path_parts[-1]] = {mount_key: mount_value}
                else:
                    existing_content[mount_key] = mount_value
            else:
                existing_content[mount_key] = mount_value
            
            # Update node with merged content
            await asyncio.to_thread(
                node_service.update_node,
                mount_node_id,
                    task.project_id,
                    preview_json=existing_content,
            )
        except Exception as e:
            # Mount failure => task failed (output exists in S3, but contract is "completed means mounted")
            err = f"Mount failed: {e}"
            task.status = ETLTaskStatus.FAILED
            task.error = err
            task.metadata["error_stage"] = "mount"
            task.metadata["output_path"] = output_key
            repo.update_task(task)

            state.status = ETLTaskStatus.FAILED
            state.error_stage = "mount"
            state.error_message = err
            state.progress = 0
            state.updated_at = datetime.now(UTC)
            await state_repo.set_terminal(state)
            return {"ok": False, "stage": "mount", "error": err}

        # Persist terminal state to DB (mounted successfully)
        task.mark_completed(result)
        repo.update_task(task)

        state.status = ETLTaskStatus.COMPLETED
        state.phase = ETLPhase.FINALIZE
        state.progress = 100
        state.error_message = None
        state.error_stage = None
        state.updated_at = datetime.now(UTC)
        await state_repo.set_terminal(state)

        return {"ok": True, "stage": "postprocess", "output_key": output_key}

    except asyncio.CancelledError:
        # Same reason as OCR job: avoid leaving Redis runtime state stuck in LLM_PROCESSING.
        md_key = state.artifact_mineru_markdown_key or task.metadata.get(
            "artifact_mineru_markdown_key"
        )
        if md_key:
            task.metadata["artifact_mineru_markdown_key"] = md_key
        if state.provider_task_id:
            task.metadata["provider_task_id"] = state.provider_task_id
        task.metadata["error_stage"] = "timeout"

        err = f"ETL postprocess job timed out (>{etl_config.etl_task_timeout}s)"
        task.status = ETLTaskStatus.FAILED
        task.error = err
        repo.update_task(task)

        state.status = ETLTaskStatus.FAILED
        state.error_stage = "timeout"
        state.error_message = err
        state.progress = 0
        state.updated_at = datetime.now(UTC)
        await state_repo.set_terminal(state)

        logger.error(f"etl_postprocess_job timeout task_id={task_id}")
        return {"ok": False, "stage": "postprocess", "error": err}

    except Exception as e:
        # Persist minimal retry pointer if OCR succeeded
        md_key = state.artifact_mineru_markdown_key or task.metadata.get(
            "artifact_mineru_markdown_key"
        )
        if md_key:
            task.metadata["artifact_mineru_markdown_key"] = md_key
        if state.provider_task_id:
            task.metadata["provider_task_id"] = state.provider_task_id
        task.metadata["error_stage"] = "postprocess"

        task.status = ETLTaskStatus.FAILED
        task.error = str(e)
        repo.update_task(task)

        state.status = ETLTaskStatus.FAILED
        state.error_stage = "postprocess"
        state.error_message = str(e)
        state.progress = 0
        state.updated_at = datetime.now(UTC)
        await state_repo.set_terminal(state)

        logger.error(
            f"etl_postprocess_job failed task_id={task_id}: {e}", exc_info=True
        )
        return {"ok": False, "stage": "postprocess", "error": str(e)}

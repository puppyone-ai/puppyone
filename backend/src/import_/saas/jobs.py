"""
SaaS Import ARQ Jobs

Job functions for processing SaaS imports in the ARQ worker.
These are registered in the unified worker alongside ETL jobs.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict

from src.sync_task.models import SyncTaskStatus

logger = logging.getLogger(__name__)


async def sync_github_repo_job(ctx: dict, task_id: int) -> Dict[str, Any]:
    """
    ARQ job for GitHub repository synchronization.
    
    This job is executed by the unified worker (same as ETL jobs).
    
    单节点模式：
    - 下载 repo ZIP
    - 提取所有文本文件
    - 上传到 S3 目录（保持目录结构）
    - 创建单个 github_repo 节点（存储元信息）
    
    Args:
        ctx: ARQ context with services injected at startup
        task_id: The sync task ID
        
    Returns:
        Result dict with status and details
    """
    from .github.processor import GithubRepoProcessor
    from .state_repository import SyncStateRepositoryRedis
    
    task_repo = ctx["sync_task_repository"]
    state_repo: SyncStateRepositoryRedis = ctx["sync_state_repo"]
    node_service = ctx["content_node_service"]
    github_service = ctx["github_service"]
    s3_service = ctx["s3_service"]  # 新增：S3 服务
    
    processor = GithubRepoProcessor(
        task_repository=task_repo,
        state_repository=state_repo,
        node_service=node_service,
        github_service=github_service,
        s3_service=s3_service,  # 新增：传递 S3 服务
    )
    
    try:
        return await processor.process(task_id)
    except asyncio.CancelledError:
        # Handle ARQ timeout
        logger.error(f"sync_github_repo_job timed out: task_id={task_id}")
        
        # Update state to failed
        state = await state_repo.get(task_id)
        if state:
            state.mark_failed("Job timed out", stage="timeout")
            await state_repo.set_terminal(state)
        
        await task_repo.mark_failed(task_id, "Job timed out")
        
        return {"ok": False, "error": "timeout"}


async def sync_notion_db_job(ctx: dict, task_id: int) -> Dict[str, Any]:
    """
    ARQ job for Notion database synchronization.
    
    Placeholder for future implementation.
    """
    logger.warning(f"sync_notion_db_job: not implemented yet, task_id={task_id}")
    
    task_repo = ctx["sync_task_repository"]
    await task_repo.mark_failed(task_id, "Notion sync not implemented yet")
    
    return {"ok": False, "error": "not_implemented"}


async def sync_notion_page_job(ctx: dict, task_id: int) -> Dict[str, Any]:
    """
    ARQ job for Notion page synchronization.
    
    Placeholder for future implementation.
    """
    logger.warning(f"sync_notion_page_job: not implemented yet, task_id={task_id}")
    
    task_repo = ctx["sync_task_repository"]
    await task_repo.mark_failed(task_id, "Notion page sync not implemented yet")
    
    return {"ok": False, "error": "not_implemented"}


async def sync_airtable_job(ctx: dict, task_id: int) -> Dict[str, Any]:
    """
    ARQ job for Airtable base synchronization.
    
    Placeholder for future implementation.
    """
    logger.warning(f"sync_airtable_job: not implemented yet, task_id={task_id}")
    
    task_repo = ctx["sync_task_repository"]
    await task_repo.mark_failed(task_id, "Airtable sync not implemented yet")
    
    return {"ok": False, "error": "not_implemented"}


async def sync_google_sheet_job(ctx: dict, task_id: int) -> Dict[str, Any]:
    """
    ARQ job for Google Sheets synchronization.
    
    Placeholder for future implementation.
    """
    logger.warning(f"sync_google_sheet_job: not implemented yet, task_id={task_id}")
    
    task_repo = ctx["sync_task_repository"]
    await task_repo.mark_failed(task_id, "Google Sheets sync not implemented yet")
    
    return {"ok": False, "error": "not_implemented"}


async def sync_linear_job(ctx: dict, task_id: int) -> Dict[str, Any]:
    """
    ARQ job for Linear project synchronization.
    
    Placeholder for future implementation.
    """
    logger.warning(f"sync_linear_job: not implemented yet, task_id={task_id}")
    
    task_repo = ctx["sync_task_repository"]
    await task_repo.mark_failed(task_id, "Linear sync not implemented yet")
    
    return {"ok": False, "error": "not_implemented"}


# Export all job functions for worker registration
SYNC_JOBS = [
    sync_github_repo_job,
    sync_notion_db_job,
    sync_notion_page_job,
    sync_airtable_job,
    sync_google_sheet_job,
    sync_linear_job,
]


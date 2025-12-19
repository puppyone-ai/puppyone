"""
ETL Callbacks

处理 ETL 任务完成后的回调操作，包括更新 table 数据。
"""

import json
import logging
from typing import Optional, Any, Dict

from src.etl.tasks.models import ETLTask, ETLTaskStatus
from src.s3.service import S3Service
from src.supabase.tables.repository import TableRepository
from src.supabase.tables.schemas import TableUpdate
from src.supabase.dependencies import get_supabase_client

logger = logging.getLogger(__name__)


def navigate_and_update_nested_dict(
    data: Dict[str, Any],
    path: str,
    content: Any
) -> Dict[str, Any]:
    """
    在嵌套字典中导航到指定路径并更新 content 字段。
    
    Args:
        data: 要更新的字典数据
        path: 路径，如 "root/docs/file.pdf"
        content: 要设置的内容
    
    Returns:
        更新后的字典数据
    """
    path_parts = path.split("/")
    current = data
    
    # Navigate to the parent of the target
    for i, part in enumerate(path_parts[:-1]):
        if part not in current:
            logger.warning(f"Path component not found: {part} in path {path}")
            return data
        
        current = current[part]
        
        # Navigate into children if it's a folder
        if isinstance(current, dict) and current.get("type") == "folder":
            if "children" not in current:
                logger.warning(f"Folder {part} has no children")
                return data
            current = current["children"]
        elif i < len(path_parts) - 2:  # Not the parent yet
            logger.warning(f"Expected folder at {part}, got: {type(current)}")
            return data
    
    # Update the target file's content
    filename = path_parts[-1]
    if filename in current and isinstance(current[filename], dict):
        if current[filename].get("type") == "file":
            current[filename]["content"] = content
            logger.info(f"Updated content for file: {path}")
        else:
            logger.warning(f"Target {filename} is not a file")
    else:
        logger.warning(f"File not found: {filename} in path {path}")
    
    return data


async def handle_etl_task_completion(
    task: ETLTask,
    s3_service: S3Service,
    table_repository: Optional[TableRepository] = None,
    max_retries: int = 3
) -> bool:
    """
    处理 ETL 任务完成后的回调。
    
    当 ETL 任务完成时，从 S3 获取解析结果，并更新对应 table 中的文件内容。
    使用重试机制处理并发更新冲突。
    
    Args:
        task: 完成的 ETL 任务
        s3_service: S3 服务实例
        table_repository: Table 仓库实例（可选，如果不提供则自动创建）
        max_retries: 最大重试次数（用于处理并发冲突）
    
    Returns:
        是否成功处理
    """
    try:
        # Check if task is completed
        if task.status != ETLTaskStatus.COMPLETED:
            logger.warning(
                f"Task {task.task_id} is not completed, status: {task.status.value}"
            )
            return False
        
        # Get result path from task
        if not task.result or not task.result.output_path:
            logger.error(f"Task {task.task_id} has no result path")
            return False
        
        # Check if task has table_id and file_path metadata
        table_id = task.metadata.get("table_id")
        file_path = task.metadata.get("file_path")
        
        if not table_id or not file_path:
            logger.warning(
                f"Task {task.task_id} missing table_id or file_path metadata, "
                f"skipping table update"
            )
            return False
        
        logger.info(
            f"Processing ETL completion callback for task {task.task_id}, "
            f"table_id={table_id}, file_path={file_path}"
        )
        
        # Download result from S3
        result_content = await s3_service.download_file(task.result.output_path)
        
        if not result_content:
            logger.error(
                f"Failed to download result from S3: {task.result.output_path}"
            )
            return False
        
        # Parse JSON result
        try:
            result_json = json.loads(result_content.decode("utf-8"))
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse result JSON: {e}")
            return False
        
        # Get table repository if not provided
        if table_repository is None:
            supabase_client = get_supabase_client()
            table_repository = TableRepository(client=supabase_client)
        
        # Retry loop to handle concurrent updates
        import asyncio
        for attempt in range(max_retries):
            try:
                # Get current table data (fresh read each retry)
                table_response = table_repository.get_by_id(int(table_id))
                if not table_response:
                    logger.error(f"Table not found: {table_id}")
                    return False
                
                # Update the file content in folder structure
                current_data = table_response.data or {}
                updated_data = navigate_and_update_nested_dict(
                    data=current_data,
                    path=file_path,
                    content=result_json
                )
                
                # Update table in database
                update_result = table_repository.update(
                    table_id=int(table_id),
                    table_data=TableUpdate(data=updated_data)
                )
                
                if update_result:
                    logger.info(
                        f"Successfully updated table {table_id} with ETL result for {file_path} "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    return True
                else:
                    if attempt < max_retries - 1:
                        logger.warning(
                            f"Failed to update table {table_id}, retrying... "
                            f"(attempt {attempt + 1}/{max_retries})"
                        )
                        await asyncio.sleep(0.5 * (attempt + 1))  # Exponential backoff
                    else:
                        logger.error(f"Failed to update table {table_id} after {max_retries} attempts")
                        return False
            
            except Exception as retry_error:
                if attempt < max_retries - 1:
                    logger.warning(
                        f"Error updating table {table_id}, retrying: {retry_error} "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(0.5 * (attempt + 1))
                else:
                    raise  # Re-raise on final attempt
        
        return False
    
    except Exception as e:
        logger.error(
            f"Error handling ETL task completion for task {task.task_id}: {e}",
            exc_info=True
        )
        return False


async def process_pending_etl_callbacks(
    task_ids: list[int],
    s3_service: S3Service,
    task_repository,
    table_repository: Optional[TableRepository] = None
) -> Dict[int, bool]:
    """
    批量处理待处理的 ETL 回调。
    
    Args:
        task_ids: 任务 ID 列表
        s3_service: S3 服务实例
        task_repository: ETL 任务仓库实例
        table_repository: Table 仓库实例（可选）
    
    Returns:
        任务 ID 到处理结果的映射
    """
    results = {}
    
    for task_id in task_ids:
        try:
            task = task_repository.get_task(task_id)
            if not task:
                logger.warning(f"Task not found: {task_id}")
                results[task_id] = False
                continue
            
            if task.status == ETLTaskStatus.COMPLETED:
                # Check if already processed (avoid duplicate updates)
                if task.metadata.get("callback_processed"):
                    logger.debug(f"Task {task_id} callback already processed")
                    results[task_id] = True
                    continue
                
                # Process callback
                success = await handle_etl_task_completion(
                    task=task,
                    s3_service=s3_service,
                    table_repository=table_repository
                )
                results[task_id] = success
                
                # Mark as processed in metadata
                if success:
                    task.metadata["callback_processed"] = True
                    task_repository.update_task(task)
            else:
                results[task_id] = False
        
        except Exception as e:
            logger.error(f"Error processing callback for task {task_id}: {e}")
            results[task_id] = False
    
    return results


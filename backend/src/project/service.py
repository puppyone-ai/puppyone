"""
Project 服务层

负责 Project 的业务逻辑处理
"""

import logging
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from src.project.models import Project
from src.project.repository import ProjectRepositoryBase
from src.exceptions import NotFoundException, ErrorCode
from src.supabase.dependencies import get_supabase_repository
from src.supabase.tables.schemas import TableCreate

logger = logging.getLogger(__name__)


@dataclass
class TableInfo:
    """表信息"""
    id: int
    name: str
    rows: Optional[int] = None


@dataclass
class FolderImportResult:
    """文件夹导入结果"""
    table_id: int
    table_name: str
    etl_task_ids: List[int]
    binary_file_count: int


class ProjectService:
    """封装项目的业务逻辑层"""

    def __init__(self, repo: ProjectRepositoryBase):
        self.repo = repo

    def get_by_id(self, project_id: int) -> Optional[Project]:
        """
        根据ID获取项目

        Args:
            project_id: 项目ID

        Returns:
            Project对象，如果不存在则返回None
        """
        return self.repo.get_by_id(project_id)

    def get_by_id_with_access_check(self, project_id: int, user_id: str) -> Project:
        """
        获取项目并验证用户权限

        检查 project.user_id 是否等于用户ID

        Args:
            project_id: 项目ID
            user_id: 用户ID

        Returns:
            已验证的 Project 对象

        Raises:
            NotFoundException: 如果项目不存在或用户无权限
        """
        project = self.get_by_id(project_id)
        if not project:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

        has_access = self.repo.verify_project_access(project_id, user_id)
        if not has_access:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

        return project

    def get_by_user_id(self, user_id: str) -> List[Project]:
        """
        获取用户的所有项目

        Args:
            user_id: 用户ID

        Returns:
            项目列表
        """
        return self.repo.get_by_user_id(user_id)

    def create(
        self,
        name: str,
        description: Optional[str],
        user_id: str,
    ) -> Project:
        """
        创建项目

        Args:
            name: 项目名称
            description: 项目描述
            user_id: 用户ID

        Returns:
            创建的Project对象
        """
        return self.repo.create(
            name=name,
            description=description,
            user_id=user_id,
        )

    def update(
        self,
        project_id: int,
        name: Optional[str],
        description: Optional[str],
    ) -> Project:
        """
        更新项目

        Args:
            project_id: 项目ID
            name: 项目名称（可选）
            description: 项目描述（可选）

        Returns:
            更新后的Project对象

        Raises:
            NotFoundException: 如果项目不存在
        """
        updated = self.repo.update(
            project_id=project_id,
            name=name,
            description=description,
        )
        if not updated:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )
        return updated

    def delete(self, project_id: int) -> None:
        """
        删除项目

        Args:
            project_id: 项目ID

        Raises:
            NotFoundException: 如果项目不存在
        """
        success = self.repo.delete(project_id)
        if not success:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

    async def import_folder_as_table(
        self,
        project_id: str,
        table_name: str,
        folder_structure: Dict[str, Any],
        binary_files: Optional[List[Dict[str, Any]]] = None,
        user_id: Optional[str] = None,
        etl_service=None,
        rule_repository=None,
    ) -> FolderImportResult:
        """
        导入文件夹结构作为表，支持二进制文件的 ETL 处理。

        Args:
            project_id: 项目ID
            table_name: 表名
            folder_structure: 文件夹结构数据
            binary_files: 需要 ETL 处理的二进制文件列表
            user_id: 用户 ID（用于 ETL 任务）
            etl_service: ETL 服务实例（可选）
            rule_repository: 规则仓库实例（可选）

        Returns:
            文件夹导入结果，包括 table_id 和 etl_task_ids

        Raises:
            NotFoundException: 如果项目不存在
        """
        # 验证项目存在
        project = self.repo.get_by_id(int(project_id))
        if not project:
            raise NotFoundException(
                f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
            )

        # 如果有二进制文件需要处理，标记它们为 pending
        etl_task_ids = []
        if binary_files:
            logger.info(f"Marking {len(binary_files)} binary files as pending")
            for binary_file in binary_files:
                file_path = binary_file.get("path")
                if file_path:
                    # Update folder_structure to mark file as pending
                    self._mark_file_as_pending(folder_structure, file_path)

        # 创建表数据
        supabase_repo = get_supabase_repository()
        table_data = TableCreate(
            name=table_name,
            project_id=int(project_id),
            description="Imported from folder structure",
            data=folder_structure
        )

        # 保存到 Supabase
        table_response = supabase_repo.create_table(table_data)
        table_id = table_response.id

        logger.info(f"Created table {table_id} for folder import")

        # 如果有二进制文件且提供了 ETL service，提交 ETL 任务
        if binary_files and etl_service and user_id:
            try:
                # Get or create default rule
                from src.etl.rules.default_rules import get_default_rule_id
                
                if rule_repository is None:
                    from src.etl.rules.repository_supabase import RuleRepositorySupabase
                    from src.supabase.dependencies import get_supabase_client
                    supabase_client = get_supabase_client()
                    rule_repository = RuleRepositorySupabase(
                        supabase_client=supabase_client,
                        user_id=user_id
                    )
                
                default_rule_id = get_default_rule_id(rule_repository)
                logger.info(f"Using default ETL rule: {default_rule_id}")

                # Submit ETL tasks for each binary file
                for binary_file in binary_files:
                    try:
                        filename = binary_file.get("filename")
                        file_path = binary_file.get("path")
                        s3_key = binary_file.get("s3_key")
                        
                        if not filename or not s3_key:
                            logger.warning(f"Binary file missing filename or s3_key, skipping")
                            continue

                        # Submit ETL task (filename is for display, s3_key is for access)
                        task = await etl_service.submit_etl_task(
                            user_id=user_id,
                            project_id=int(project_id),
                            filename=filename,
                            rule_id=default_rule_id,
                            s3_key=s3_key,
                        )

                        # Add metadata for callback and S3 access
                        task.metadata["table_id"] = table_id
                        task.metadata["file_path"] = file_path
                        task.metadata["s3_key"] = s3_key  # Store actual S3 key for file access
                        
                        # Persist metadata updates to repository
                        etl_service.task_repository.update_task(task)

                        etl_task_ids.append(task.task_id)
                        logger.info(
                            f"Submitted ETL task {task.task_id} for {filename}"
                        )

                    except Exception as e:
                        logger.error(
                            f"Failed to submit ETL task for {binary_file}: {e}",
                            exc_info=True
                        )

                logger.info(
                    f"Submitted {len(etl_task_ids)} ETL tasks for table {table_id}"
                )

            except Exception as e:
                logger.error(
                    f"Error submitting ETL tasks: {e}",
                    exc_info=True
                )

        return FolderImportResult(
            table_id=table_id,
            table_name=table_response.name or table_name,
            etl_task_ids=etl_task_ids,
            binary_file_count=len(binary_files) if binary_files else 0
        )

    def _mark_file_as_pending(
        self,
        data: Dict[str, Any],
        path: str
    ) -> None:
        """
        在文件夹结构中标记文件为 pending 状态。

        Args:
            data: 文件夹结构数据
            path: 文件路径，如 "root/docs/file.pdf"
        """
        path_parts = path.split("/")
        current = data

        # Navigate to the parent of the target
        for i, part in enumerate(path_parts[:-1]):
            if part not in current:
                logger.warning(f"Path component not found: {part} in path {path}")
                return

            current = current[part]

            # Navigate into children if it's a folder
            if isinstance(current, dict) and current.get("type") == "folder":
                if "children" not in current:
                    logger.warning(f"Folder {part} has no children")
                    return
                current = current["children"]
            elif i < len(path_parts) - 2:  # Not the parent yet
                logger.warning(f"Expected folder at {part}, got: {type(current)}")
                return

        # Mark the target file as pending
        filename = path_parts[-1]
        if filename in current and isinstance(current[filename], dict):
            if current[filename].get("type") == "file":
                current[filename]["content"] = {
                    "status": "pending",
                    "message": "Parsing in background..."
                }
                current[filename]["needs_etl"] = True
                logger.debug(f"Marked file as pending: {path}")
            else:
                logger.warning(f"Target {filename} is not a file")
        else:
            logger.warning(f"File not found: {filename} in path {path}")

    def verify_project_access(self, project_id: int, user_id: str) -> bool:
        """
        验证用户是否有权限访问指定的项目

        Args:
            project_id: 项目ID
            user_id: 用户ID

        Returns:
            如果用户有权限返回True，否则返回False
        """
        return self.repo.verify_project_access(project_id, user_id)

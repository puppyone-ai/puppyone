"""
负责项目管理业务逻辑
"""

from typing import List, Optional
from app.models.project import Project, TableInfo
from app.repositories.base import ProjectRepositoryBase
from app.core.exceptions import NotFoundException, BusinessException, ErrorCode

class ProjectService:
    """封装项目管理业务逻辑层"""

    def __init__(self, repo: ProjectRepositoryBase):
        self.repo = repo

    def get_all(self) -> List[Project]:
        """获取所有项目"""
        return self.repo.get_all()

    def get_by_id(self, project_id: str) -> Optional[Project]:
        """根据ID获取项目"""
        return self.repo.get_by_id(project_id)

    def create(self, name: str, description: Optional[str] = None) -> Project:
        """创建项目"""
        if not name or not name.strip():
            raise BusinessException("Project name cannot be empty", code=ErrorCode.VALIDATION_ERROR)
        return self.repo.create(name.strip(), description.strip() if description else None)

    def update(self, project_id: str, name: Optional[str] = None, description: Optional[str] = None) -> Project:
        """更新项目"""
        if name is not None and not name.strip():
            raise BusinessException("Project name cannot be empty", code=ErrorCode.VALIDATION_ERROR)
        
        updated = self.repo.update(
            project_id,
            name.strip() if name else None,
            description.strip() if description else None
        )
        if not updated:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
        return updated

    def delete(self, project_id: str) -> None:
        """删除项目"""
        success = self.repo.delete(project_id)
        if not success:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)

    def create_table(self, project_id: str, name: str, data: Optional[List[dict]] = None) -> TableInfo:
        """创建表"""
        # 验证项目是否存在
        project = self.repo.get_by_id(project_id)
        if not project:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
        
        if not name or not name.strip():
            raise BusinessException("Table name cannot be empty", code=ErrorCode.VALIDATION_ERROR)
        
        return self.repo.create_table(project_id, name.strip(), data)

    def update_table(self, project_id: str, table_id: str, name: Optional[str] = None) -> TableInfo:
        """更新表"""
        if name is not None and not name.strip():
            raise BusinessException("Table name cannot be empty", code=ErrorCode.VALIDATION_ERROR)
        
        updated = self.repo.update_table(
            project_id,
            table_id,
            name.strip() if name else None
        )
        if not updated:
            raise NotFoundException(f"Table not found: {project_id}/{table_id}", code=ErrorCode.NOT_FOUND)
        return updated

    def delete_table(self, project_id: str, table_id: str) -> None:
        """删除表"""
        success = self.repo.delete_table(project_id, table_id)
        if not success:
            raise NotFoundException(f"Table not found: {project_id}/{table_id}", code=ErrorCode.NOT_FOUND)

    def get_table_data(self, project_id: str, table_id: str) -> List[dict]:
        """获取表数据"""
        project = self.repo.get_by_id(project_id)
        if not project:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
        
        data = self.repo.get_table_data(project_id, table_id)
        if data is None:
            raise NotFoundException(f"Table not found: {project_id}/{table_id}", code=ErrorCode.NOT_FOUND)
        return data

    def update_table_data(self, project_id: str, table_id: str, data: List[dict]) -> None:
        """更新表数据"""
        project = self.repo.get_by_id(project_id)
        if not project:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
        
        success = self.repo.update_table_data(project_id, table_id, data)
        if not success:
            raise NotFoundException(f"Table not found: {project_id}/{table_id}", code=ErrorCode.NOT_FOUND)
    
    def import_folder_as_table(self, project_id: str, table_name: str, folder_structure: dict) -> TableInfo:
        """导入文件夹结构作为表"""
        # 验证项目是否存在
        project = self.repo.get_by_id(project_id)
        if not project:
            raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
        
        if not table_name or not table_name.strip():
            raise BusinessException("Table name cannot be empty", code=ErrorCode.VALIDATION_ERROR)
        
        if not isinstance(folder_structure, dict):
            raise BusinessException("Folder structure must be a dictionary", code=ErrorCode.VALIDATION_ERROR)
        
        return self.repo.import_folder_as_table(project_id, table_name.strip(), folder_structure)


"""
Project API Schemas

定义前端 API 请求/响应模型，匹配前端 ProjectInfo 类型。
"""

from typing import Optional, List, Any, Dict
from pydantic import BaseModel


class TableInfo(BaseModel):
    """表信息（简化版，用于项目列表）"""
    id: str
    name: str
    rows: Optional[int] = None


class ProjectOut(BaseModel):
    """项目输出模型 - 匹配前端 ProjectInfo 类型"""
    id: str
    name: str
    description: Optional[str] = None
    tables: List[TableInfo] = []


class ProjectCreate(BaseModel):
    """创建项目请求"""
    name: str
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    """更新项目请求"""
    name: Optional[str] = None
    description: Optional[str] = None


class BinaryFileInfo(BaseModel):
    """二进制文件信息"""
    path: str  # 在folder_structure中的路径，如 "root/docs/file.pdf"
    filename: str  # 文件名
    s3_key: str  # S3存储路径
    file_type: str  # 文件类型：pdf, docx, jpg等


class FolderImportRequest(BaseModel):
    """文件夹导入请求"""
    table_name: str
    folder_structure: Dict[str, Any]
    binary_files: Optional[List[BinaryFileInfo]] = []  # 需要ETL处理的二进制文件列表


class FolderImportResponse(BaseModel):
    """文件夹导入响应"""
    table_id: str
    table_name: str
    etl_task_ids: Optional[List[int]] = []  # 提交的ETL任务ID列表
    binary_file_count: int = 0  # 二进制文件数量


class TableOut(BaseModel):
    """表输出模型"""
    id: str
    name: str
    rows: Optional[int] = None
    data: Optional[List[Any]] = None


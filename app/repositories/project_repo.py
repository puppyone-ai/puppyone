import json
import shutil
from pathlib import Path
from typing import List, Optional
from app.models.project import Project, TableInfo
from app.repositories.base import ProjectRepositoryBase
from app.core.config import settings
from app.utils.logger import log_error, log_info
import re

PROJECTS_DATA_PATH = Path(settings.DATA_PATH) / "projects"

class ProjectRepositoryJSON(ProjectRepositoryBase):
    """基于文件系统的项目仓库实现"""
    
    def __init__(self):
        PROJECTS_DATA_PATH.mkdir(parents=True, exist_ok=True)
    
    def _get_project_dir(self, project_id: str) -> Path:
        """获取项目目录路径"""
        return PROJECTS_DATA_PATH / project_id
    
    def _get_project_meta_path(self, project_id: str) -> Path:
        """获取项目元数据文件路径"""
        return self._get_project_dir(project_id) / "meta.json"
    
    def _get_table_path(self, project_id: str, table_id: str) -> Path:
        """获取表数据文件路径"""
        return self._get_project_dir(project_id) / f"{table_id}.json"
    
    def _sanitize_id(self, name: str) -> str:
        """将名称转换为有效的ID（小写，替换空格为连字符，移除特殊字符）"""
        # 转换为小写
        id_str = name.lower()
        # 替换空格和特殊字符为连字符
        id_str = re.sub(r'[^\w\s-]', '', id_str)
        id_str = re.sub(r'[-\s]+', '-', id_str)
        # 移除首尾连字符
        id_str = id_str.strip('-')
        return id_str
    
    def _generate_project_id(self, name: str) -> str:
        """生成项目ID"""
        base_id = self._sanitize_id(name)
        # 检查是否已存在，如果存在则添加数字后缀
        counter = 1
        project_id = base_id
        while self._get_project_dir(project_id).exists():
            project_id = f"{base_id}-{counter}"
            counter += 1
        return project_id
    
    def _generate_table_id(self, project_id: str, name: str) -> str:
        """生成表ID"""
        base_id = self._sanitize_id(name)
        # 检查是否已存在，如果存在则添加数字后缀
        counter = 1
        table_id = base_id
        while self._get_table_path(project_id, table_id).exists():
            table_id = f"{base_id}-{counter}"
            counter += 1
        return table_id
    
    def _read_project_meta(self, project_id: str) -> Optional[dict]:
        """读取项目元数据"""
        meta_path = self._get_project_meta_path(project_id)
        if not meta_path.exists():
            return None
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log_error(f"Failed to read project meta {meta_path}: {e}")
            return None
    
    def _write_project_meta(self, project_id: str, meta: dict) -> None:
        """写入项目元数据"""
        meta_path = self._get_project_meta_path(project_id)
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_error(f"Failed to write project meta {meta_path}: {e}")
            raise
    
    def _read_table_data(self, project_id: str, table_id: str) -> Optional[List[dict]]:
        """读取表数据"""
        table_path = self._get_table_path(project_id, table_id)
        if not table_path.exists():
            return None
        try:
            with open(table_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # 如果是字典（文件夹结构），包装成数组
                if isinstance(data, dict):
                    return [data]
                # 确保返回的是列表
                if isinstance(data, list):
                    return data
                return []
        except Exception as e:
            log_error(f"Failed to read table data {table_path}: {e}")
            return None
    
    def _write_table_data(self, project_id: str, table_id: str, data: List[dict]) -> None:
        """写入表数据"""
        table_path = self._get_table_path(project_id, table_id)
        table_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(table_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_error(f"Failed to write table data {table_path}: {e}")
            raise
    
    def _write_table_json(self, project_id: str, table_id: str, json_data: dict) -> None:
        """直接写入JSON对象到表文件（用于文件夹导入）"""
        table_path = self._get_table_path(project_id, table_id)
        table_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(table_path, "w", encoding="utf-8") as f:
                json.dump(json_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_error(f"Failed to write table JSON {table_path}: {e}")
            raise
    
    def get_all(self) -> List[Project]:
        """获取所有项目"""
        projects = []
        if not PROJECTS_DATA_PATH.exists():
            return projects
        
        for project_dir in PROJECTS_DATA_PATH.iterdir():
            if not project_dir.is_dir():
                continue
            
            project_id = project_dir.name
            meta = self._read_project_meta(project_id)
            if not meta:
                continue
            
            # 读取表列表
            tables = []
            for table_file in project_dir.glob("*.json"):
                if table_file.name == "meta.json":
                    continue
                table_id = table_file.stem
                table_data = self._read_table_data(project_id, table_id)
                rows = len(table_data) if table_data else 0
                # 尝试从meta中获取表名，如果没有则使用table_id
                table_name = meta.get("tables", {}).get(table_id, {}).get("name", table_id)
                tables.append(TableInfo(id=table_id, name=table_name, rows=rows))
            
            projects.append(Project(
                id=project_id,
                name=meta.get("name", project_id),
                description=meta.get("description"),
                tables=tables
            ))
        
        return projects
    
    def get_by_id(self, project_id: str) -> Optional[Project]:
        """根据ID获取项目"""
        meta = self._read_project_meta(project_id)
        if not meta:
            return None
        
        # 读取表列表
        tables = []
        project_dir = self._get_project_dir(project_id)
        if project_dir.exists():
            for table_file in project_dir.glob("*.json"):
                if table_file.name == "meta.json":
                    continue
                table_id = table_file.stem
                table_data = self._read_table_data(project_id, table_id)
                rows = len(table_data) if table_data else 0
                table_name = meta.get("tables", {}).get(table_id, {}).get("name", table_id)
                tables.append(TableInfo(id=table_id, name=table_name, rows=rows))
        
        return Project(
            id=project_id,
            name=meta.get("name", project_id),
            description=meta.get("description"),
            tables=tables
        )
    
    def create(self, name: str, description: Optional[str] = None) -> Project:
        """创建项目"""
        project_id = self._generate_project_id(name)
        project_dir = self._get_project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)
        
        meta = {
            "id": project_id,
            "name": name,
            "description": description,
            "tables": {}
        }
        self._write_project_meta(project_id, meta)
        
        return Project(
            id=project_id,
            name=name,
            description=description,
            tables=[]
        )
    
    def update(self, project_id: str, name: Optional[str] = None, description: Optional[str] = None) -> Optional[Project]:
        """更新项目"""
        meta = self._read_project_meta(project_id)
        if not meta:
            return None
        
        if name is not None:
            meta["name"] = name
        if description is not None:
            meta["description"] = description
        
        self._write_project_meta(project_id, meta)
        return self.get_by_id(project_id)
    
    def delete(self, project_id: str) -> bool:
        """删除项目"""
        project_dir = self._get_project_dir(project_id)
        if not project_dir.exists():
            return False
        
        try:
            shutil.rmtree(project_dir)
            return True
        except Exception as e:
            log_error(f"Failed to delete project {project_id}: {e}")
            return False
    
    def create_table(self, project_id: str, name: str, data: Optional[List[dict]] = None) -> TableInfo:
        """创建表"""
        if not self._read_project_meta(project_id):
            raise ValueError(f"Project {project_id} not found")
        
        table_id = self._generate_table_id(project_id, name)
        table_data = data if data is not None else []
        self._write_table_data(project_id, table_id, table_data)
        
        # 更新项目元数据中的表信息
        meta = self._read_project_meta(project_id)
        if meta:
            if "tables" not in meta:
                meta["tables"] = {}
            meta["tables"][table_id] = {"name": name}
            self._write_project_meta(project_id, meta)
        
        return TableInfo(id=table_id, name=name, rows=len(table_data))
    
    def update_table(self, project_id: str, table_id: str, name: Optional[str] = None) -> Optional[TableInfo]:
        """更新表"""
        if not self._read_project_meta(project_id):
            return None
        
        table_data = self._read_table_data(project_id, table_id)
        if table_data is None:
            return None
        
        # 如果重命名，需要更新meta.json
        if name is not None:
            meta = self._read_project_meta(project_id)
            if meta and "tables" in meta and table_id in meta["tables"]:
                meta["tables"][table_id]["name"] = name
                self._write_project_meta(project_id, meta)
        
        rows = len(table_data)
        table_name = name if name is not None else table_id
        return TableInfo(id=table_id, name=table_name, rows=rows)
    
    def delete_table(self, project_id: str, table_id: str) -> bool:
        """删除表"""
        table_path = self._get_table_path(project_id, table_id)
        if not table_path.exists():
            return False
        
        try:
            table_path.unlink()
            # 从项目元数据中移除表信息
            meta = self._read_project_meta(project_id)
            if meta and "tables" in meta and table_id in meta["tables"]:
                del meta["tables"][table_id]
                self._write_project_meta(project_id, meta)
            return True
        except Exception as e:
            log_error(f"Failed to delete table {project_id}/{table_id}: {e}")
            return False
    
    def get_table_data(self, project_id: str, table_id: str) -> Optional[List[dict]]:
        """获取表数据"""
        return self._read_table_data(project_id, table_id)
    
    def update_table_data(self, project_id: str, table_id: str, data: List[dict]) -> bool:
        """更新表数据"""
        if not self._read_project_meta(project_id):
            return False
        try:
            # 如果数据是数组且只有一个元素，且该元素是对象（可能是文件夹结构），则提取该对象并保存为JSON对象
            if len(data) == 1 and isinstance(data[0], dict):
                # 检查是否是文件夹结构（对象的所有值都是字符串或对象）
                first_item = data[0]
                is_folder_structure = all(
                    isinstance(v, (str, dict)) for v in first_item.values()
                )
                if is_folder_structure:
                    # 保存为JSON对象
                    self._write_table_json(project_id, table_id, first_item)
                    return True
            # 否则，保存为数组
            self._write_table_data(project_id, table_id, data)
            return True
        except Exception:
            return False
    
    def import_folder_as_table(self, project_id: str, table_name: str, folder_structure: dict) -> TableInfo:
        """导入文件夹结构作为表"""
        if not self._read_project_meta(project_id):
            raise ValueError(f"Project {project_id} not found")
        
        table_id = self._generate_table_id(project_id, table_name)
        self._write_table_json(project_id, table_id, folder_structure)
        
        # 更新项目元数据中的表信息
        meta = self._read_project_meta(project_id)
        if meta:
            if "tables" not in meta:
                meta["tables"] = {}
            meta["tables"][table_id] = {"name": table_name}
            self._write_project_meta(project_id, meta)
        
        # 计算"行数"（这里使用文件夹结构中的文件数量作为近似值）
        def count_files(obj: dict) -> int:
            count = 0
            for value in obj.values():
                if isinstance(value, str):
                    count += 1
                elif isinstance(value, dict):
                    count += count_files(value)
            return count
        
        rows = count_files(folder_structure)
        return TableInfo(id=table_id, name=table_name, rows=rows)


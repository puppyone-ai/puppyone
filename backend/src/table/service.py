"""
负责Table（知识库）内容的管理
"""

from typing import List, Optional, Dict, Any
from jsonpointer import resolve_pointer
import json
import jmespath
from src.table.models import Table
from src.table.repository import TableRepositoryBase
from src.table.schemas import ProjectWithTables
from src.exceptions import NotFoundException, BusinessException, ErrorCode


class TableService:
    """封装业务逻辑层"""

    def __init__(self, repo: TableRepositoryBase):
        self.repo = repo

    def get_projects_with_tables_by_user_id(
        self, user_id: str
    ) -> List[ProjectWithTables]:
        """
        获取用户的所有项目及其下的所有表格

        Args:
            user_id: 用户ID（字符串类型）

        Returns:
            包含项目信息和其下所有表格的列表
        """
        return self.repo.get_projects_with_tables_by_user_id(user_id)

    def get_by_id(self, table_id: int) -> Optional[Table]:
        return self.repo.get_by_id(table_id)

    def get_by_id_with_access_check(self, table_id: int, user_id: str) -> Table:
        """
        获取表格并验证用户权限

        通过 table.project_id 关联到 project 表，检查 project.user_id 是否等于用户ID

        Args:
            table_id: 表格ID
            user_id: 用户ID

        Returns:
            已验证的 Table 对象

        Raises:
            NotFoundException: 如果表格不存在、没有关联项目、项目不存在或用户无权限
        """
        table = self.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        has_access = self.repo.verify_table_access(table_id, user_id)
        if not has_access:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        return table

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

    def create(
        self,
        user_id: str,
        name: str,
        description: str,
        data: dict,
        project_id: Optional[int] = None,
    ) -> Table:
        return self.repo.create(
            user_id=user_id,
            name=name,
            description=description,
            data=data,
            project_id=project_id,
        )

    def get_orphan_tables_by_user_id(self, user_id: str) -> List[Table]:
        """获取用户的所有裸 Table（不属于任何 Project）"""
        return self.repo.get_orphan_tables_by_user_id(user_id)

    def update(
        self,
        table_id: int,
        name: Optional[str],
        description: Optional[str],
        data: Optional[dict],
    ) -> Table:
        updated = self.repo.update(table_id, name, description, data)
        if not updated:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )
        return updated

    def delete(self, table_id: int) -> None:
        success = self.repo.delete(table_id)
        if not success:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

    def create_context_data(
        self, table_id: int, mounted_json_pointer_path: str, elements: List[Dict]
    ) -> Any:
        """
        在 data 字段的指定路径下创建新数据

        Args:
            table_id: Table ID
            mounted_json_pointer_path: JSON指针路径，数据将挂载到此路径下
            elements: 要创建的元素数组，每个元素包含 key 和 content


        """
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = (table.data or {}).copy()

        # 获取挂载点的父节点
        try:
            parent = resolve_pointer(data, mounted_json_pointer_path, None)
        except Exception as e:
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

        if parent is None:
            raise BusinessException(
                f"Path not found: {mounted_json_pointer_path}",
                code=ErrorCode.BAD_REQUEST,
            )

        # dict 挂载点：按 key 写入；list 挂载点：按顺序 append content
        if isinstance(parent, dict):
            # 检查是否有重复的 key
            for element in elements:
                if "key" not in element:
                    raise BusinessException(
                        "Element missing 'key' field", code=ErrorCode.VALIDATION_ERROR
                    )
                key = element["key"]
                if key in parent:
                    raise BusinessException(
                        f"Key '{key}' already exists", code=ErrorCode.VALIDATION_ERROR
                    )

            # 检查 content 是否重复（深度比较）
            existing_content_strs = {
                json.dumps(parent[k], sort_keys=True) for k in parent.keys()
            }
            for element in elements:
                if "content" not in element:
                    raise BusinessException(
                        "Element missing 'content' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                content = element["content"]
                # 深度比较：序列化后比较字符串
                content_str = json.dumps(content, sort_keys=True)
                if content_str in existing_content_strs:
                    raise BusinessException(
                        f"Content already exists for key: {element['key']}",
                        code=ErrorCode.VALIDATION_ERROR,
                    )

            # 创建新数据
            for element in elements:
                key = element["key"]
                content = element["content"]
                parent[key] = content
        elif isinstance(parent, list):
            # list 挂载点：忽略 key，追加 content
            for element in elements:
                if "content" not in element:
                    raise BusinessException(
                        "Element missing 'content' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                parent.append(element["content"])
        else:
            raise BusinessException(
                "Path points to non-dict/list node", code=ErrorCode.BAD_REQUEST
            )

        # 更新 data 字段
        updated_table = self.repo.update_context_data(table_id, data)
        if not updated_table:
            raise BusinessException(
                "Update failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # 返回创建后的数据
        result = resolve_pointer(updated_table.data or {}, mounted_json_pointer_path)
        return result

    def get_context_data(self, table_id: int, json_pointer_path: str) -> Any:
        """
        获取 data 字段中指定路径的数据
        """
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        try:
            data = resolve_pointer(table.data or {}, json_pointer_path, None)
            if data is None:
                # 为了保险，我们认为如果 resolve 返回 default (None)，就是没找到。
                raise NotFoundException(
                    f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
                )
            return data
        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

    def update_context_data(
        self, table_id: int, json_pointer_path: str, elements: List[Dict]
    ) -> Any:
        """
        更新 data 字段中指定路径的数据
        """
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = (table.data or {}).copy()

        # 获取要更新的父节点
        try:
            parent = resolve_pointer(data, json_pointer_path, None)
        except Exception as e:
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

        if parent is None:
            raise NotFoundException(
                f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
            )

        if isinstance(parent, dict):
            # 检查所有要更新的 key 是否存在
            for element in elements:
                if "key" not in element:
                    raise BusinessException(
                        "Element missing 'key' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                key = element["key"]
                if key not in parent:
                    raise NotFoundException(
                        f"Key '{key}' not found", code=ErrorCode.NOT_FOUND
                    )

            # 更新数据（整值替换，不做深层 merge）
            for element in elements:
                if "content" not in element:
                    raise BusinessException(
                        "Element missing 'content' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                key = element["key"]
                content = element["content"]
                parent[key] = content
        elif isinstance(parent, list):
            # list 挂载点：key 视为下标（支持 str/int），对该位置整值替换
            for element in elements:
                if "key" not in element:
                    raise BusinessException(
                        "Element missing 'key' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                if "content" not in element:
                    raise BusinessException(
                        "Element missing 'content' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                try:
                    idx = int(element["key"])
                except (TypeError, ValueError):
                    raise BusinessException(
                        f"Invalid list index: {element['key']}",
                        code=ErrorCode.BAD_REQUEST,
                    )
                if idx < 0 or idx >= len(parent):
                    raise NotFoundException(
                        f"Index '{idx}' not found", code=ErrorCode.NOT_FOUND
                    )
                parent[idx] = element["content"]
        else:
            raise BusinessException(
                "Path points to non-dict/list node", code=ErrorCode.BAD_REQUEST
            )

        # 更新 data 字段
        updated_table = self.repo.update_context_data(table_id, data)
        if not updated_table:
            raise BusinessException(
                "Update failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # 返回更新后的数据
        result = resolve_pointer(updated_table.data or {}, json_pointer_path)
        return result

    def delete_context_data(
        self, table_id: int, json_pointer_path: str, keys: List[str]
    ) -> Any:
        """
        删除 data 字段中指定路径下的 keys
        """
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = (table.data or {}).copy()

        # 获取要删除的父节点
        try:
            parent = resolve_pointer(data, json_pointer_path, None)
        except Exception as e:
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

        if parent is None:
            raise NotFoundException(
                f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
            )

        if isinstance(parent, dict):
            # 检查所有要删除的 key 是否存在
            for key in keys:
                if key not in parent:
                    raise NotFoundException(
                        f"Key '{key}' not found", code=ErrorCode.NOT_FOUND
                    )

            # 删除数据
            for key in keys:
                del parent[key]
        elif isinstance(parent, list):
            # list 挂载点：key 视为下标（支持 str/int），按倒序删除避免下标位移
            indices: list[int] = []
            for key in keys:
                try:
                    idx = int(key)
                except (TypeError, ValueError):
                    raise BusinessException(
                        f"Invalid list index: {key}", code=ErrorCode.BAD_REQUEST
                    )
                if idx < 0 or idx >= len(parent):
                    raise NotFoundException(
                        f"Index '{idx}' not found", code=ErrorCode.NOT_FOUND
                    )
                indices.append(idx)

            for idx in sorted(set(indices), reverse=True):
                del parent[idx]
        else:
            raise BusinessException(
                "Path points to non-dict/list node", code=ErrorCode.BAD_REQUEST
            )

        # 更新 data 字段
        updated_table = self.repo.update_context_data(table_id, data)
        if not updated_table:
            raise BusinessException(
                "Update failed", code=ErrorCode.INTERNAL_SERVER_ERROR
            )

        # 返回删除后的数据
        result = resolve_pointer(updated_table.data or {}, json_pointer_path)
        return result

    def query_context_data_with_jmespath(
        self, table_id: int, json_pointer_path: str, query: str
    ) -> Optional[Any]:
        """
        使用 JMESPath 查询 data 字段中指定路径的数据
        """
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        try:
            # 先获取指定路径的数据
            base_data = resolve_pointer(table.data or {}, json_pointer_path, None)
            if base_data is None:
                raise NotFoundException(
                    f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
                )

            # 使用 JMESPath 查询数据
            result = jmespath.search(query, base_data)

            # 处理空结果 (JMESPath returns None if nothing matched)
            # 我们认为这也是一种成功结果，只是数据为空
            return result

        except jmespath.exceptions.ParseError as e:
            raise BusinessException(
                f"JMESPath syntax error: {str(e)}", code=ErrorCode.BAD_REQUEST
            )
        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(
                f"Query failed: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

    def get_context_structure(self, table_id: int, json_pointer_path: str) -> Dict:
        """
        获取 data 字段中指定路径的数据结构（不包含实际数据值）
        """
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        try:
            data = resolve_pointer(table.data or {}, json_pointer_path, None)
            if data is None:
                raise NotFoundException(
                    f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
                )

            # 提取结构信息
            structure = self._extract_structure(data)
            return structure

        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(
                f"Failed to extract structure: {str(e)}",
                code=ErrorCode.INTERNAL_SERVER_ERROR,
            )

    def _extract_structure(self, data: Any) -> Any:
        """
        递归提取数据结构，保留类型信息但不保留实际值
        """
        if isinstance(data, dict):
            structure = {}
            for key, value in data.items():
                structure[key] = self._extract_structure(value)
            return structure
        elif isinstance(data, list):
            if len(data) > 0:
                # 使用第一个元素的结构作为模板
                return [self._extract_structure(data[0])]
            else:
                return []
        else:
            # 对于基本类型，返回类型名称
            type_name = type(data).__name__
            return f"<{type_name}>"

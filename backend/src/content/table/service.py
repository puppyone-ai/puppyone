"""
Table (知识库) 内容管理

写操作走 MUT protocol (MutEphemeralClient)，
读操作从 MUT ObjectStore 读取 JSON 内容。
DB 中的 tables 表仅用于存储元数据和 orphan tables。
"""

import json
from typing import List, Optional, Dict, Any

import jmespath
from jsonpointer import resolve_pointer

from src.content.table.models import Table
from src.content.table.repository import TableRepositoryBase
from src.content.table.schemas import ProjectWithTables
from src.exceptions import NotFoundException, BusinessException, ErrorCode
from src.utils.logger import log_info


class TableService:

    def __init__(
        self,
        repo: TableRepositoryBase,
        mut_write=None,
        repo_manager=None,
        node_repo=None,
    ):
        self.repo = repo
        self._mut = mut_write
        self._repos = repo_manager
        self._node_repo = node_repo

    # ================================================================
    # MUT helpers
    # ================================================================

    def _ensure_mut(self):
        if self._repos is None:
            raise BusinessException(
                "MUT repo_manager not configured",
                code=ErrorCode.INTERNAL_SERVER_ERROR,
            )

    def _make_ephemeral_client(self, project_id: str, operator: str = "system:table"):
        from src.mut_engine.dependencies import create_ephemeral_client
        auth_ctx = {
            "agent": operator,
            "_scope": {"id": "_table", "path": "", "exclude": [], "mode": "rw"},
        }
        return create_ephemeral_client(project_id, auth_ctx)

    def _table_mut_path(self, project_id: str, table_id: str) -> str:
        """Table 在 MUT 树中的标准路径"""
        return f"tables/{table_id}.json"

    def _read_json_from_mut(self, project_id: str, mut_path: str) -> dict:
        """从 MUT ObjectStore 读取 JSON (source of truth)"""
        repo = self._repos.get_repo(project_id)
        root = repo.history.get_root_hash()
        if not root:
            return {}
        from mut.core.tree import tree_to_flat
        flat = tree_to_flat(repo.store, root)
        blob_hash = flat.get(mut_path, "")
        if not blob_hash:
            return {}
        raw = repo.store.get(blob_hash)
        return json.loads(raw.decode("utf-8"))

    def _read_table_data(self, table: Table) -> dict:
        """读取 Table 的 JSON data — 优先从 MUT 读，回退到 DB"""
        if table.project_id and self._repos:
            try:
                mut_path = self._table_mut_path(table.project_id, table.id)
                data = self._read_json_from_mut(table.project_id, mut_path)
                if data:
                    return data
            except Exception:
                pass
        return table.data or {}

    # ================================================================
    # 只读查询 (从 DB index 或 MUT)
    # ================================================================

    def get_projects_with_tables_by_org_id(
        self, org_id: str
    ) -> List[ProjectWithTables]:
        return self.repo.get_projects_with_tables_by_org_id(org_id)

    def get_by_id(self, table_id: str) -> Optional[Table]:
        return self.repo.get_by_id(table_id)

    def get_by_id_with_access_check(self, table_id: str, user_id: str) -> Table:
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

    def verify_project_access(self, project_id: str, user_id: str) -> bool:
        return self.repo.verify_project_access(project_id, user_id)

    def get_orphan_tables_by_created_by(self, user_id: str) -> List[Table]:
        return self.repo.get_orphan_tables_by_created_by(user_id)

    # ================================================================
    # 写操作 — 全部通过 MUT protocol (MutEphemeralClient)
    # ================================================================

    async def create(
        self,
        user_id: str,
        name: str,
        description: str,
        data: dict,
        project_id: Optional[str] = None,
    ) -> Table:
        self._ensure_mut()

        from src.utils.id_generator import generate_uuid_v7
        table_id = generate_uuid_v7()
        mut_path = self._table_mut_path(project_id or "__orphan__", table_id)

        table_blob = {
            "id": table_id,
            "name": name,
            "description": description,
            "data": data,
        }
        content = json.dumps(table_blob, ensure_ascii=False, indent=2).encode("utf-8")

        if project_id:
            client = self._make_ephemeral_client(project_id, f"user:{user_id}")
            client.clone()
            push_result = client.push(
                modified={mut_path: content},
                message=f"create table {name}",
                who=f"user:{user_id}",
            )
            log_info(f"[Table] Created table {table_id} via MUT")
        else:
            self.repo.create(
                created_by=user_id,
                name=name,
                description=description,
                data=data,
                project_id=None,
            )
            log_info(f"[Table] Created orphan table {table_id} (no project, DB direct)")

        table = self.repo.get_by_id(table_id)
        if not table:
            return Table(
                id=table_id,
                name=name,
                project_id=project_id,
                created_by=user_id,
                description=description,
                data=data,
                created_at=__import__("datetime").datetime.now(),
            )
        return table

    async def update(
        self,
        table_id: str,
        name: Optional[str],
        description: Optional[str],
        data: Optional[dict],
    ) -> Table:
        self._ensure_mut()

        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        if table.project_id:
            mut_path = self._table_mut_path(table.project_id, table_id)
            current_data = self._read_table_data(table)

            table_blob = {
                "id": table_id,
                "name": name or table.name,
                "description": description if description is not None else table.description,
                "data": data if data is not None else current_data.get("data", table.data),
            }
            content = json.dumps(table_blob, ensure_ascii=False, indent=2).encode("utf-8")

            client = self._make_ephemeral_client(table.project_id, "system:table_update")
            client.clone()
            push_result = client.push(
                modified={mut_path: content},
                message=f"update table {table_id}",
                who="system:table_update",
            )
            log_info(f"[Table] Updated table {table_id} via MUT")
        else:
            self.repo.update(table_id, name, description, data)

        updated = self.repo.get_by_id(table_id)
        return updated or table

    async def delete(self, table_id: str) -> None:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        if table.project_id and self._repos:
            mut_path = self._table_mut_path(table.project_id, table_id)
            try:
                client = self._make_ephemeral_client(table.project_id, "system:table_delete")
                client.clone()
                client.push(
                    deleted=[mut_path],
                    message=f"delete table {table_id}",
                    who="system:table_delete",
                )
                log_info(f"[Table] Deleted table {table_id} via MUT")
                return
            except Exception:
                pass

        success = self.repo.delete(table_id)
        if not success:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

    # ================================================================
    # Context Data 操作 — JSON Pointer + MUT write
    # ================================================================

    async def create_context_data(
        self, table_id: str, mounted_json_pointer_path: str, elements: List[Dict]
    ) -> Any:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = self._read_table_data(table).copy()
        actual_data = data.get("data", data) if "data" in data else data

        try:
            parent = resolve_pointer(actual_data, mounted_json_pointer_path, None)
        except Exception as e:
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

        if parent is None:
            raise BusinessException(
                f"Path not found: {mounted_json_pointer_path}",
                code=ErrorCode.BAD_REQUEST,
            )

        if isinstance(parent, dict):
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

            existing_content_strs = {
                json.dumps(parent[k], sort_keys=True) for k in parent.keys()
            }
            for element in elements:
                if "content" not in element:
                    raise BusinessException(
                        "Element missing 'content' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                content_str = json.dumps(element["content"], sort_keys=True)
                if content_str in existing_content_strs:
                    raise BusinessException(
                        f"Content already exists for key: {element['key']}",
                        code=ErrorCode.VALIDATION_ERROR,
                    )

            for element in elements:
                parent[element["key"]] = element["content"]
        elif isinstance(parent, list):
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

        await self._write_table_data(table, data)
        return resolve_pointer(actual_data, mounted_json_pointer_path)

    def get_context_data(self, table_id: str, json_pointer_path: str) -> Any:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = self._read_table_data(table)
        actual_data = data.get("data", data) if "data" in data else data

        try:
            result = resolve_pointer(actual_data, json_pointer_path, None)
            if result is None:
                raise NotFoundException(
                    f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
                )
            return result
        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

    async def update_context_data(
        self, table_id: str, json_pointer_path: str, elements: List[Dict]
    ) -> Any:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = self._read_table_data(table).copy()
        actual_data = data.get("data", data) if "data" in data else data

        try:
            parent = resolve_pointer(actual_data, json_pointer_path, None)
        except Exception as e:
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

        if parent is None:
            raise NotFoundException(
                f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
            )

        if isinstance(parent, dict):
            for element in elements:
                if "key" not in element:
                    raise BusinessException(
                        "Element missing 'key' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                if element["key"] not in parent:
                    raise NotFoundException(
                        f"Key '{element['key']}' not found", code=ErrorCode.NOT_FOUND
                    )

            for element in elements:
                if "content" not in element:
                    raise BusinessException(
                        "Element missing 'content' field",
                        code=ErrorCode.VALIDATION_ERROR,
                    )
                parent[element["key"]] = element["content"]
        elif isinstance(parent, list):
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

        await self._write_table_data(table, data)
        return resolve_pointer(actual_data, json_pointer_path)

    async def delete_context_data(
        self, table_id: str, json_pointer_path: str, keys: List[str]
    ) -> Any:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        data = self._read_table_data(table).copy()
        actual_data = data.get("data", data) if "data" in data else data

        try:
            parent = resolve_pointer(actual_data, json_pointer_path, None)
        except Exception as e:
            raise BusinessException(
                f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST
            )

        if parent is None:
            raise NotFoundException(
                f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
            )

        if isinstance(parent, dict):
            for key in keys:
                if key not in parent:
                    raise NotFoundException(
                        f"Key '{key}' not found", code=ErrorCode.NOT_FOUND
                    )

            for key in keys:
                del parent[key]
        elif isinstance(parent, list):
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

        await self._write_table_data(table, data)
        return resolve_pointer(actual_data, json_pointer_path)

    async def _write_table_data(self, table: Table, full_blob: dict) -> None:
        """将完整的 table JSON 写入 MUT (唯一写入点)"""
        if table.project_id and self._repos:
            mut_path = self._table_mut_path(table.project_id, table.id)
            content = json.dumps(full_blob, ensure_ascii=False, indent=2).encode("utf-8")
            client = self._make_ephemeral_client(table.project_id, "system:table_edit")
            client.clone()
            client.push(
                modified={mut_path: content},
                message=f"edit table data {table.id}",
                who="system:table_edit",
            )
        else:
            actual_data = full_blob.get("data", full_blob)
            self.repo.update_context_data(table.id, actual_data)

    # ================================================================
    # 查询操作 (只读)
    # ================================================================

    def query_context_data_with_jmespath(
        self, table_id: str, json_pointer_path: str, query: str
    ) -> Optional[Any]:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        try:
            data = self._read_table_data(table)
            actual_data = data.get("data", data) if "data" in data else data
            base_data = resolve_pointer(actual_data, json_pointer_path, None)
            if base_data is None:
                raise NotFoundException(
                    f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
                )

            result = jmespath.search(query, base_data)
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

    def get_context_structure(self, table_id: str, json_pointer_path: str) -> Dict:
        table = self.repo.get_by_id(table_id)
        if not table:
            raise NotFoundException(
                f"Table not found: {table_id}", code=ErrorCode.NOT_FOUND
            )

        try:
            data = self._read_table_data(table)
            actual_data = data.get("data", data) if "data" in data else data
            target = resolve_pointer(actual_data, json_pointer_path, None)
            if target is None:
                raise NotFoundException(
                    f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND
                )

            return self._extract_structure(target)

        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(
                f"Failed to extract structure: {str(e)}",
                code=ErrorCode.INTERNAL_SERVER_ERROR,
            )

    def _extract_structure(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {key: self._extract_structure(value) for key, value in data.items()}
        elif isinstance(data, list):
            if len(data) > 0:
                return [self._extract_structure(data[0])]
            return []
        else:
            return f"<{type(data).__name__}>"

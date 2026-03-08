"""Content Node Repository - 数据库操作层"""

from typing import Optional, List
from src.supabase.client import SupabaseClient
from src.content_node.models import ContentNode


class ContentNodeRepository:
    """Content Node 数据库操作"""

    TABLE_NAME = "content_nodes"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _row_to_model(self, row: dict) -> ContentNode:
        """将数据库行转换为模型（parent_id 由 model validator 从 id_path 自动派生）"""
        return ContentNode(
            id=row["id"],
            project_id=row["project_id"],
            created_by=str(row["created_by"]) if row.get("created_by") else None,
            name=row["name"],
            type=row["type"],
            id_path=row["id_path"],
            depth=row.get("depth") or 1,
            preview_json=row.get("preview_json"),
            preview_md=row.get("preview_md"),
            s3_key=row.get("s3_key"),
            mime_type=row.get("mime_type"),
            size_bytes=row.get("size_bytes", 0),
            permissions=row.get("permissions", {"inherit": True}),
            current_version=row.get("current_version", 0),
            content_hash=row.get("content_hash"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def get_by_id(self, node_id: str) -> Optional[ContentNode]:
        """根据 ID 获取节点"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("id", node_id)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def get_by_ids(self, node_ids: List[str]) -> List[ContentNode]:
        """Batch fetch nodes by a list of IDs (single round-trip)."""
        if not node_ids:
            return []
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .in_("id", node_ids)
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def get_by_id_path(self, project_id: str, id_path: str) -> Optional[ContentNode]:
        """根据 id_path 获取节点"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("project_id", project_id)
            .eq("id_path", id_path)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def list_descendants(self, project_id: str, id_path_prefix: str) -> List[ContentNode]:
        """列出某节点的所有子孙节点（用于导出到沙盒）"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("project_id", project_id)
            .like("id_path", f"{id_path_prefix}/%")
            .order("id_path")
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def delete_by_id_path_prefix(self, project_id: str, id_path_prefix: str) -> int:
        """删除某节点及其所有子孙（用于全量覆盖）"""
        # 先删除子孙
        response = (
            self.client.table(self.TABLE_NAME)
            .delete()
            .eq("project_id", project_id)
            .like("id_path", f"{id_path_prefix}/%")
            .execute()
        )
        count = len(response.data)
        
        # 再删除自身
        response2 = (
            self.client.table(self.TABLE_NAME)
            .delete()
            .eq("project_id", project_id)
            .eq("id_path", id_path_prefix)
            .execute()
        )
        return count + len(response2.data)

    def list_children(
        self,
        project_id: str,
        parent_id_path: Optional[str] = None,
        parent_depth: int = 0,
    ) -> List[ContentNode]:
        """列出直接子节点（基于 id_path + depth，不依赖 parent_id）。

        Args:
            parent_id_path: 父节点的 id_path。None 表示列出根节点。
            parent_depth: 父节点的 depth（根的父 depth 为 0）。
        """
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("project_id", project_id)
            .eq("depth", parent_depth + 1)
        )
        if parent_id_path is not None:
            query = query.like("id_path", f"{parent_id_path}/%")

        response = query.order("type").order("name").execute()
        return [self._row_to_model(row) for row in response.data]

    def list_by_project(self, project_id: str, node_type: Optional[str] = None) -> List[ContentNode]:
        """列出项目的所有节点"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("project_id", project_id)
        )
        if node_type:
            query = query.eq("type", node_type)
        
        response = query.order("id_path").execute()
        return [self._row_to_model(row) for row in response.data]
    
    def create(
        self,
        project_id: str,
        name: str,
        node_type: str,  # folder | json | markdown | file
        id_path: str,
        created_by: Optional[str] = None,
        preview_json: Optional[dict] = None,
        preview_md: Optional[str] = None,
        s3_key: Optional[str] = None,
        mime_type: Optional[str] = None,
        size_bytes: int = 0,
    ) -> ContentNode:
        """创建节点（parent_id 已从 DB 移除，层级关系完全由 id_path 决定）"""
        data = {
            "project_id": project_id,
            "name": name,
            "type": node_type,
            "id_path": id_path,
            "preview_json": preview_json,
            "preview_md": preview_md,
            "s3_key": s3_key,
            "mime_type": mime_type,
            "size_bytes": size_bytes,
            "current_version": 0,
        }
        if created_by is not None:
            data["created_by"] = created_by
        
        response = self.client.table(self.TABLE_NAME).insert(data).execute()
        return self._row_to_model(response.data[0])

    def update(
        self,
        node_id: str,
        name: Optional[str] = None,
        preview_json: Optional[dict] = None,
        preview_md: Optional[str] = None,
        id_path: Optional[str] = None,
        s3_key: Optional[str] = None,
        size_bytes: Optional[int] = None,
        clear_preview_json: bool = False,
        clear_preview_md: bool = False,
        current_version: Optional[int] = None,
        content_hash: Optional[str] = None,
        expected_version: Optional[int] = None,
    ) -> Optional[ContentNode]:
        """更新节点
        
        Args:
            clear_preview_json: 如果为 True，将 preview_json 字段设为 null
            clear_preview_md: 如果为 True，将 preview_md 字段设为 null
            current_version: 版本号（版本管理用）
            content_hash: 内容哈希（版本管理用）
            expected_version: 乐观锁 — 如果指定，只在数据库中 current_version 
                             等于此值时才更新。返回 None 表示版本冲突。
        """
        data = {}
        if name is not None:
            data["name"] = name
        if preview_json is not None:
            data["preview_json"] = preview_json
        elif clear_preview_json:
            data["preview_json"] = None
        if preview_md is not None:
            data["preview_md"] = preview_md
        elif clear_preview_md:
            data["preview_md"] = None
        if id_path is not None:
            data["id_path"] = id_path
        if s3_key is not None:
            data["s3_key"] = s3_key
        if size_bytes is not None:
            data["size_bytes"] = size_bytes
        if current_version is not None:
            data["current_version"] = current_version
        if content_hash is not None:
            data["content_hash"] = content_hash

        if not data:
            return self.get_by_id(node_id)

        query = (
            self.client.table(self.TABLE_NAME)
            .update(data)
            .eq("id", node_id)
        )
        
        if expected_version is not None:
            query = query.eq("current_version", expected_version)
        
        response = query.execute()
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def update_with_type(
        self,
        node_id: str,
        node_type: Optional[str] = None,  # folder | json | markdown | file | github_repo | ...
        name: Optional[str] = None,
        preview_json: Optional[dict] = None,
        preview_md: Optional[str] = None,
        s3_key: Optional[str] = None,
        mime_type: Optional[str] = None,
        size_bytes: Optional[int] = None,
    ) -> Optional[ContentNode]:
        """更新节点（包括类型变更）"""
        data = {}
        if node_type is not None:
            data["type"] = node_type
        if name is not None:
            data["name"] = name
        if preview_json is not None:
            data["preview_json"] = preview_json
        if preview_md is not None:
            data["preview_md"] = preview_md
        if s3_key is not None:
            data["s3_key"] = s3_key
        if mime_type is not None:
            data["mime_type"] = mime_type
        if size_bytes is not None:
            data["size_bytes"] = size_bytes

        if not data:
            return self.get_by_id(node_id)

        response = (
            self.client.table(self.TABLE_NAME)
            .update(data)
            .eq("id", node_id)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def delete(self, node_id: str) -> bool:
        """删除节点"""
        response = (
            self.client.table(self.TABLE_NAME)
            .delete()
            .eq("id", node_id)
            .execute()
        )
        return len(response.data) > 0

    def count_children_batch(self, parent_ids: List[str]) -> dict[str, int]:
        """批量统计多个父节点的直接子节点数量（通过 RPC 使用 id_path + depth）。"""
        if not parent_ids:
            return {}
        response = self.client.rpc("count_children_batch", {
            "p_parent_ids": parent_ids,
        }).execute()
        return {row["parent_id"]: int(row["child_count"]) for row in response.data}

    # === 原子操作（基于 id_path Source of Truth） ===

    def move_node_atomic(
        self,
        node_id: str,
        project_id: str,
        new_id_path: str,
    ) -> None:
        """
        原子移动节点：通过 Supabase RPC 在单个事务中更新节点及其所有子孙的 id_path。
        
        对应 SQL function: move_node_atomic(p_node_id, p_project_id, p_new_id_path)
        """
        self.client.rpc("move_node_atomic", {
            "p_node_id": node_id,
            "p_project_id": project_id,
            "p_new_id_path": new_id_path,
        }).execute()

    def collect_subtree_s3_keys(self, project_id: str, id_path_prefix: str) -> List[str]:
        """收集子树中所有 S3 文件的 key（用于删除前清理 S3）。"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("s3_key")
            .eq("project_id", project_id)
            .like("id_path", f"{id_path_prefix}/%")
            .not_.is_("s3_key", "null")
            .execute()
        )
        root_resp = (
            self.client.table(self.TABLE_NAME)
            .select("s3_key")
            .eq("project_id", project_id)
            .eq("id_path", id_path_prefix)
            .not_.is_("s3_key", "null")
            .execute()
        )
        keys = [row["s3_key"] for row in response.data]
        keys.extend(row["s3_key"] for row in root_resp.data)
        return keys

    def collect_subtree_info(self, project_id: str, id_path_prefix: str) -> List[dict]:
        """收集子树中所有非文件夹节点的信息（用于删除时的 changelog 通知）。"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id, name, type, s3_key")
            .eq("project_id", project_id)
            .like("id_path", f"{id_path_prefix}/%")
            .neq("type", "folder")
            .execute()
        )
        root_resp = (
            self.client.table(self.TABLE_NAME)
            .select("id, name, type, s3_key")
            .eq("project_id", project_id)
            .eq("id_path", id_path_prefix)
            .neq("type", "folder")
            .execute()
        )
        return response.data + root_resp.data

    def get_descendant_ids(self, project_id: str, id_path_prefix: str) -> List[str]:
        """获取子树中所有节点的 ID（基于 id_path 前缀，无递归）。"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id")
            .eq("project_id", project_id)
            .like("id_path", f"{id_path_prefix}/%")
            .execute()
        )
        return [row["id"] for row in response.data]

    def find_names_with_prefix(
        self,
        project_id: str,
        parent_id_path: Optional[str],
        parent_depth: int,
        name_prefix: str,
    ) -> List[str]:
        """查找同一目录下以指定前缀开头的所有名称（基于 id_path + depth）。"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("name")
            .eq("project_id", project_id)
            .eq("depth", parent_depth + 1)
            .ilike("name", f"{name_prefix}%")
        )
        if parent_id_path is not None:
            query = query.like("id_path", f"{parent_id_path}/%")

        response = query.execute()
        return [row["name"] for row in response.data]

    def get_child_by_name(
        self,
        project_id: str,
        parent_id_path: Optional[str],
        parent_depth: int,
        name: str,
    ) -> Optional[ContentNode]:
        """按名称精确查找直接子节点（基于 id_path + depth，大小写敏感）。"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("project_id", project_id)
            .eq("depth", parent_depth + 1)
            .eq("name", name)
        )
        if parent_id_path is not None:
            query = query.like("id_path", f"{parent_id_path}/%")

        response = query.limit(1).execute()
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def count_by_project(self, project_id: str) -> dict[str, int]:
        """Count nodes by type for a project. Returns e.g. {"folder": 5, "json": 10, "markdown": 3}."""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("type")
            .eq("project_id", project_id)
            .execute()
        )
        counts: dict[str, int] = {}
        for row in response.data:
            t = row["type"]
            counts[t] = counts.get(t, 0) + 1
        return counts

    def name_exists_in_parent(
        self,
        project_id: str,
        parent_id_path: Optional[str],
        parent_depth: int,
        name: str,
        exclude_node_id: Optional[str] = None,
    ) -> bool:
        """检查同目录下是否已存在同名节点（基于 id_path + depth）。"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("id")
            .eq("project_id", project_id)
            .eq("depth", parent_depth + 1)
            .eq("name", name)
        )
        if parent_id_path is not None:
            query = query.like("id_path", f"{parent_id_path}/%")

        if exclude_node_id is not None:
            query = query.neq("id", exclude_node_id)

        response = query.limit(1).execute()
        return len(response.data) > 0

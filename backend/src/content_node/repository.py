"""Content Node Repository - 数据库操作层"""

from datetime import datetime
from typing import Optional, List
from src.supabase.client import SupabaseClient
from src.content_node.models import ContentNode


class ContentNodeRepository:
    """Content Node 数据库操作"""

    TABLE_NAME = "content_nodes"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _row_to_model(self, row: dict) -> ContentNode:
        """将数据库行转换为模型"""
        return ContentNode(
            id=row["id"],
            user_id=str(row["user_id"]),
            project_id=row["project_id"],
            parent_id=row.get("parent_id"),
            name=row["name"],
            type=row["type"],
            id_path=row["id_path"],
            content=row.get("content"),
            s3_key=row.get("s3_key"),
            mime_type=row.get("mime_type"),
            size_bytes=row.get("size_bytes", 0),
            permissions=row.get("permissions", {"inherit": True}),
            # 同步相关字段
            sync_url=row.get("sync_url"),
            sync_id=row.get("sync_id"),
            last_synced_at=row.get("last_synced_at"),
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
        self, user_id: str, project_id: str, parent_id: Optional[str] = None
    ) -> List[ContentNode]:
        """列出子节点"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("user_id", user_id)
            .eq("project_id", project_id)
        )
        if parent_id is None:
            query = query.is_("parent_id", "null")
        else:
            query = query.eq("parent_id", parent_id)
        
        response = query.order("type").order("name").execute()
        return [self._row_to_model(row) for row in response.data]

    def list_by_user(self, user_id: str, node_type: Optional[str] = None) -> List[ContentNode]:
        """列出用户的所有节点"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("user_id", user_id)
        )
        if node_type:
            query = query.eq("type", node_type)
        
        response = query.order("path").execute()
        return [self._row_to_model(row) for row in response.data]

    def create(
        self,
        user_id: str,
        project_id: str,
        name: str,
        node_type: str,
        id_path: str,
        parent_id: Optional[str] = None,
        content: Optional[dict] = None,
        s3_key: Optional[str] = None,
        mime_type: Optional[str] = None,
        size_bytes: int = 0,
        sync_url: Optional[str] = None,
        sync_id: Optional[str] = None,
        last_synced_at: Optional[datetime] = None,
    ) -> ContentNode:
        """创建节点"""
        data = {
            "user_id": user_id,
            "project_id": project_id,
            "parent_id": parent_id,
            "name": name,
            "type": node_type,
            "id_path": id_path,
            "content": content,
            "s3_key": s3_key,
            "mime_type": mime_type,
            "size_bytes": size_bytes,
        }
        # 添加同步相关字段（仅当有值时）
        if sync_url is not None:
            data["sync_url"] = sync_url
        if sync_id is not None:
            data["sync_id"] = sync_id
        if last_synced_at is not None:
            data["last_synced_at"] = last_synced_at.isoformat()
        
        response = self.client.table(self.TABLE_NAME).insert(data).execute()
        return self._row_to_model(response.data[0])

    def update(
        self,
        node_id: str,
        name: Optional[str] = None,
        content: Optional[dict] = None,
        id_path: Optional[str] = None,
        parent_id: Optional[str] = None,
        s3_key: Optional[str] = None,
        size_bytes: Optional[int] = None,
        clear_content: bool = False,
    ) -> Optional[ContentNode]:
        """更新节点
        
        Args:
            clear_content: 如果为 True，将 content 字段设为 null
        """
        data = {}
        if name is not None:
            data["name"] = name
        if content is not None:
            data["content"] = content
        elif clear_content:
            data["content"] = None
        if id_path is not None:
            data["id_path"] = id_path
        if parent_id is not None:
            data["parent_id"] = parent_id
        if s3_key is not None:
            data["s3_key"] = s3_key
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

    def update_sync_info(
        self,
        node_id: str,
        sync_url: Optional[str] = None,
        sync_id: Optional[str] = None,
        last_synced_at: Optional[datetime] = None,
    ) -> Optional[ContentNode]:
        """更新节点的同步信息
        
        用于将普通节点（如 markdown）标记为可同步，
        或更新已有同步节点的同步元数据。
        """
        data = {}
        if sync_url is not None:
            data["sync_url"] = sync_url
        if sync_id is not None:
            data["sync_id"] = sync_id
        if last_synced_at is not None:
            data["last_synced_at"] = last_synced_at.isoformat()

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

    def update_with_type(
        self,
        node_id: str,
        type: Optional[str] = None,
        name: Optional[str] = None,
        content: Optional[dict] = None,
        s3_key: Optional[str] = None,
        mime_type: Optional[str] = None,
        size_bytes: Optional[int] = None,
    ) -> Optional[ContentNode]:
        """更新节点（包括类型变更，用于 ETL 完成后将 pending 转为 markdown）"""
        data = {}
        if type is not None:
            data["type"] = type
        if name is not None:
            data["name"] = name
        if content is not None:
            data["content"] = content
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

    def get_children_ids(self, node_id: str) -> List[str]:
        """获取所有子节点 ID（用于递归删除）"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id")
            .eq("parent_id", node_id)
            .execute()
        )
        return [row["id"] for row in response.data]

    def update_children_id_path_prefix(
        self, 
        project_id: str, 
        old_prefix: str, 
        new_prefix: str
    ) -> int:
        """批量更新子节点的 id_path 前缀（用于移动操作）"""
        # 获取所有需要更新的节点
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id, id_path")
            .eq("project_id", project_id)
            .like("id_path", f"{old_prefix}/%")
            .execute()
        )
        
        count = 0
        for row in response.data:
            new_id_path = new_prefix + row["id_path"][len(old_prefix):]
            self.client.table(self.TABLE_NAME).update({"id_path": new_id_path}).eq("id", row["id"]).execute()
            count += 1
        
        return count

    def find_names_with_prefix(
        self,
        project_id: str,
        parent_id: Optional[str],
        name_prefix: str,
    ) -> List[str]:
        """查找同一目录下以指定前缀开头的所有名称（用于生成唯一名称）"""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("name")
            .eq("project_id", project_id)
            .ilike("name", f"{name_prefix}%")
        )
        if parent_id is None:
            query = query.is_("parent_id", "null")
        else:
            query = query.eq("parent_id", parent_id)
        
        response = query.execute()
        return [row["name"] for row in response.data]


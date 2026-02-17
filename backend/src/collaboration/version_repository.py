"""
L2 Collaboration — Repository 层

FileVersionRepository: file_versions 表的 CRUD
FolderSnapshotRepository: folder_snapshots 表的 CRUD

迁移自 content_node/version_repository.py（逻辑完全保留）
"""

from typing import Optional, List
from src.supabase.client import SupabaseClient
from src.collaboration.schemas import FileVersion, FolderSnapshot


class FileVersionRepository:
    """file_versions 表的数据访问"""

    TABLE_NAME = "file_versions"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _row_to_model(self, row: dict) -> FileVersion:
        return FileVersion(**row)

    # === CREATE ===

    def create(
        self,
        node_id: str,
        version: int,
        content_hash: str,
        operator_type: str,
        operation: str,
        content_json: Optional[dict] = None,
        content_text: Optional[str] = None,
        s3_key: Optional[str] = None,
        size_bytes: int = 0,
        snapshot_id: Optional[int] = None,
        operator_id: Optional[str] = None,
        session_id: Optional[str] = None,
        merge_strategy: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> FileVersion:
        """创建新版本记录"""
        data = {
            "node_id": node_id,
            "version": version,
            "content_hash": content_hash,
            "size_bytes": size_bytes,
            "operator_type": operator_type,
            "operation": operation,
        }
        if content_json is not None:
            data["content_json"] = content_json
        if content_text is not None:
            data["content_text"] = content_text
        if s3_key is not None:
            data["s3_key"] = s3_key
        if snapshot_id is not None:
            data["snapshot_id"] = snapshot_id
        if operator_id is not None:
            data["operator_id"] = operator_id
        if session_id is not None:
            data["session_id"] = session_id
        if merge_strategy is not None:
            data["merge_strategy"] = merge_strategy
        if summary is not None:
            data["summary"] = summary

        response = self.client.table(self.TABLE_NAME).insert(data).execute()
        return self._row_to_model(response.data[0])

    # === READ ===

    def get_by_node_and_version(self, node_id: str, version: int) -> Optional[FileVersion]:
        """获取指定文件的指定版本"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("node_id", node_id)
            .eq("version", version)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def get_latest_by_node(self, node_id: str) -> Optional[FileVersion]:
        """获取指定文件的最新版本"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("node_id", node_id)
            .order("version", desc=True)
            .limit(1)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def list_by_node(
        self, node_id: str, limit: int = 50, offset: int = 0
    ) -> List[FileVersion]:
        """获取文件的版本历史（按版本号倒序）"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("node_id", node_id)
            .order("version", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def count_by_node(self, node_id: str) -> int:
        """获取文件的版本总数"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id", count="exact")
            .eq("node_id", node_id)
            .execute()
        )
        return response.count or 0

    def find_by_hash(self, node_id: str, content_hash: str) -> Optional[FileVersion]:
        """根据 content_hash 查找版本（用于 S3 去重）"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("node_id", node_id)
            .eq("content_hash", content_hash)
            .order("version", desc=True)
            .limit(1)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def list_by_snapshot(self, snapshot_id: int) -> List[FileVersion]:
        """获取某个快照关联的所有文件版本"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("snapshot_id", snapshot_id)
            .order("node_id")
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def update_snapshot_id(self, version_id: int, snapshot_id: int) -> None:
        """更新版本的 snapshot_id（关联到文件夹快照）"""
        self.client.table(self.TABLE_NAME).update(
            {"snapshot_id": snapshot_id}
        ).eq("id", version_id).execute()

    def bulk_update_snapshot_id(self, version_ids: List[int], snapshot_id: int) -> None:
        """批量更新 snapshot_id"""
        for vid in version_ids:
            self.update_snapshot_id(vid, snapshot_id)


class FolderSnapshotRepository:
    """folder_snapshots 表的数据访问"""

    TABLE_NAME = "folder_snapshots"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _row_to_model(self, row: dict) -> FolderSnapshot:
        return FolderSnapshot(**row)

    # === CREATE ===

    def create(
        self,
        folder_node_id: str,
        file_versions_map: dict,
        operator_type: str,
        operation: str,
        changed_files: Optional[list] = None,
        files_count: int = 0,
        changed_count: int = 0,
        operator_id: Optional[str] = None,
        session_id: Optional[str] = None,
        summary: Optional[str] = None,
        base_snapshot_id: Optional[int] = None,
    ) -> FolderSnapshot:
        """创建文件夹快照"""
        data = {
            "folder_node_id": folder_node_id,
            "file_versions_map": file_versions_map,
            "operator_type": operator_type,
            "operation": operation,
            "files_count": files_count,
            "changed_count": changed_count,
        }
        if changed_files is not None:
            data["changed_files"] = changed_files
        if operator_id is not None:
            data["operator_id"] = operator_id
        if session_id is not None:
            data["session_id"] = session_id
        if summary is not None:
            data["summary"] = summary
        if base_snapshot_id is not None:
            data["base_snapshot_id"] = base_snapshot_id

        response = self.client.table(self.TABLE_NAME).insert(data).execute()
        return self._row_to_model(response.data[0])

    # === READ ===

    def get_by_id(self, snapshot_id: int) -> Optional[FolderSnapshot]:
        """获取指定快照"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("id", snapshot_id)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def get_latest_by_folder(self, folder_node_id: str) -> Optional[FolderSnapshot]:
        """获取文件夹的最新快照"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("folder_node_id", folder_node_id)
            .order("id", desc=True)
            .limit(1)
            .execute()
        )
        if response.data:
            return self._row_to_model(response.data[0])
        return None

    def list_by_folder(
        self, folder_node_id: str, limit: int = 50, offset: int = 0
    ) -> List[FolderSnapshot]:
        """获取文件夹的快照历史"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("folder_node_id", folder_node_id)
            .order("id", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return [self._row_to_model(row) for row in response.data]

    def count_by_folder(self, folder_node_id: str) -> int:
        """获取文件夹的快照总数"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id", count="exact")
            .eq("folder_node_id", folder_node_id)
            .execute()
        )
        return response.count or 0

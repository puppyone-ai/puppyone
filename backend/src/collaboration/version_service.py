"""
L2 Collaboration — VersionService 版本管理

核心职责：
- create_version()       创建新版本（每次内容变更都调用）
- rollback_file()        单文件回滚
- rollback_folder()      文件夹回滚
- create_folder_snapshot()  创建文件夹快照
- get_version_history()  查看文件版本历史
- get_version_content()  获取某个版本内容
- compute_diff()         对比两个版本

迁移自 content_node/version_service.py（逻辑完全保留）
"""

import hashlib
import json
from typing import Optional, Any, List

from src.content_node.repository import ContentNodeRepository
from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
from src.collaboration.schemas import (
    FileVersion, FolderSnapshot, FileVersionInfo, FileVersionDetail,
    VersionHistoryResponse, FolderSnapshotInfo, FolderSnapshotHistoryResponse,
    RollbackResponse, FolderRollbackResponse, DiffItem, DiffResponse,
)
from src.s3.service import S3Service
from src.exceptions import NotFoundException, BusinessException, VersionConflictException, ErrorCode
from src.utils.logger import log_info, log_debug, log_error


class VersionService:
    """版本管理核心服务"""

    def __init__(
        self,
        node_repo: ContentNodeRepository,
        version_repo: FileVersionRepository,
        snapshot_repo: FolderSnapshotRepository,
        s3_service: S3Service,
    ):
        self.node_repo = node_repo
        self.version_repo = version_repo
        self.snapshot_repo = snapshot_repo
        self.s3 = s3_service

    # ============================================================
    # 核心：创建新版本
    # ============================================================

    def create_version(
        self,
        node_id: str,
        operator_type: str,
        operation: str,
        content_json: Optional[Any] = None,
        content_text: Optional[str] = None,
        s3_key: Optional[str] = None,
        size_bytes: int = 0,
        operator_id: Optional[str] = None,
        session_id: Optional[str] = None,
        merge_strategy: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> Optional[FileVersion]:
        """
        创建新版本记录。

        流程：
          1. 获取当前节点
          2. 计算新内容的 content_hash
          3. 如果 hash 没变 → 跳过
          4. 原子递增版本号
          5. S3 文件去重
          6. 创建 file_version 记录
          7. 更新 content_nodes 的 current_version 和 content_hash
        """
        try:
            node = self.node_repo.get_by_id(node_id)
            if not node:
                log_error(f"[Version] Node not found: {node_id}")
                return None

            new_hash = self._compute_content_hash(
                content_json=content_json,
                content_text=content_text,
                s3_key=s3_key,
            )

            if operation != "delete" and node.content_hash and new_hash == node.content_hash:
                log_debug(f"[Version] Content unchanged for {node_id}, skipping")
                return None

            # 原子递增版本号：基于 content_nodes.current_version 而非 file_versions 表查询
            # 避免并发 commit 拿到相同版本号的竞态条件
            current_ver = node.current_version or 0
            new_version = current_ver + 1

            actual_s3_key = s3_key
            if s3_key and new_hash:
                existing = self.version_repo.find_by_hash(node_id, new_hash)
                if existing and existing.s3_key:
                    actual_s3_key = existing.s3_key
                    log_debug(f"[Version] S3 dedup: reusing {actual_s3_key}")

            if size_bytes == 0:
                if content_json is not None:
                    size_bytes = len(json.dumps(content_json, ensure_ascii=False).encode("utf-8"))
                elif content_text is not None:
                    size_bytes = len(content_text.encode("utf-8"))

            version = self.version_repo.create(
                node_id=node_id,
                version=new_version,
                content_json=content_json,
                content_text=content_text,
                s3_key=actual_s3_key,
                content_hash=new_hash,
                size_bytes=size_bytes,
                operator_type=operator_type,
                operator_id=operator_id,
                session_id=session_id,
                operation=operation,
                merge_strategy=merge_strategy,
                summary=summary,
            )

            updated_node = self.node_repo.update(
                node_id=node_id,
                current_version=new_version,
                content_hash=new_hash,
                expected_version=current_ver,
            )

            if updated_node is None:
                # 乐观锁冲突：另一个并发写入已更新了 current_version
                # 版本记录已插入但 content_node 未更新 → 需调用方重试
                log_error(
                    f"[Version] Optimistic lock conflict for {node_id}: "
                    f"expected v{current_ver}, likely updated by concurrent write"
                )
                raise VersionConflictException(
                    f"Version conflict for node {node_id}: expected v{current_ver}, "
                    f"concurrent update detected"
                )

            log_info(
                f"[Version] Created v{new_version} for {node_id} "
                f"(op={operation}, by={operator_type}:{operator_id or 'N/A'})"
            )
            return version

        except (VersionConflictException, BusinessException):
            raise
        except Exception as e:
            log_error(f"[Version] Failed to create version for {node_id}: {e}")
            raise

    # ============================================================
    # 回滚：单文件
    # ============================================================

    def rollback_file(
        self,
        node_id: str,
        target_version: int,
        operator_id: Optional[str] = None,
    ) -> RollbackResponse:
        """
        回滚文件到指定版本。
        不是"倒回去"，而是"基于历史版本创建一个新版本"。
        版本号只增不减。
        """
        old_version = self.version_repo.get_by_node_and_version(node_id, target_version)
        if not old_version:
            raise NotFoundException(
                f"Version {target_version} not found for node {node_id}",
                code=ErrorCode.NOT_FOUND,
            )

        node = self.node_repo.get_by_id(node_id)
        if not node:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)

        new_version_num = (node.current_version or 0) + 1

        self.version_repo.create(
            node_id=node_id,
            version=new_version_num,
            content_json=old_version.content_json,
            content_text=old_version.content_text,
            s3_key=old_version.s3_key,
            content_hash=old_version.content_hash,
            size_bytes=old_version.size_bytes,
            operator_type="user",
            operator_id=operator_id,
            operation="rollback",
            summary=f"Rollback to v{target_version}",
        )

        update_kwargs = {
            "node_id": node_id,
            "current_version": new_version_num,
            "content_hash": old_version.content_hash,
        }
        if old_version.content_json is not None:
            update_kwargs["preview_json"] = old_version.content_json
        if old_version.content_text is not None:
            update_kwargs["preview_md"] = old_version.content_text
        if old_version.s3_key is not None:
            update_kwargs["s3_key"] = old_version.s3_key

        self.node_repo.update(**update_kwargs)

        log_info(f"[Version] Rolled back {node_id} to v{target_version} (new: v{new_version_num})")

        return RollbackResponse(
            node_id=node_id,
            new_version=new_version_num,
            rolled_back_to=target_version,
        )

    # ============================================================
    # 回滚：文件夹
    # ============================================================

    def rollback_folder(
        self,
        folder_node_id: str,
        target_snapshot_id: int,
        operator_id: Optional[str] = None,
    ) -> FolderRollbackResponse:
        """回滚整个文件夹到指定快照"""
        target_snapshot = self.snapshot_repo.get_by_id(target_snapshot_id)
        if not target_snapshot:
            raise NotFoundException(
                f"Snapshot {target_snapshot_id} not found",
                code=ErrorCode.NOT_FOUND,
            )

        if target_snapshot.folder_node_id != folder_node_id:
            raise BusinessException(
                "Snapshot does not belong to this folder",
                code=ErrorCode.BAD_REQUEST,
            )

        current_versions = {}
        for nid in target_snapshot.file_versions_map:
            n = self.node_repo.get_by_id(nid)
            if n:
                current_versions[nid] = n.current_version or 0

        files_to_rollback = {}
        for nid, target_ver in target_snapshot.file_versions_map.items():
            current_ver = current_versions.get(nid, 0)
            if current_ver != target_ver:
                files_to_rollback[nid] = target_ver

        if not files_to_rollback:
            raise BusinessException(
                "All files are already at the target snapshot state",
                code=ErrorCode.BAD_REQUEST,
            )

        new_version_ids = []
        new_version_map = dict(target_snapshot.file_versions_map)

        for nid, target_ver in files_to_rollback.items():
            result = self.rollback_file(nid, target_ver, operator_id)
            new_version_map[nid] = result.new_version
            latest = self.version_repo.get_latest_by_node(nid)
            if latest:
                new_version_ids.append(latest.id)

        for nid in target_snapshot.file_versions_map:
            if nid not in files_to_rollback:
                n = self.node_repo.get_by_id(nid)
                if n:
                    new_version_map[nid] = n.current_version or 0

        snapshot = self.snapshot_repo.create(
            folder_node_id=folder_node_id,
            file_versions_map=new_version_map,
            changed_files=list(files_to_rollback.keys()),
            files_count=len(new_version_map),
            changed_count=len(files_to_rollback),
            operator_type="user",
            operator_id=operator_id,
            operation="rollback",
            base_snapshot_id=target_snapshot_id,
            summary=f"Rollback to snapshot #{target_snapshot_id}, {len(files_to_rollback)} files restored",
        )

        if new_version_ids:
            self.version_repo.bulk_update_snapshot_id(new_version_ids, snapshot.id)

        log_info(
            f"[Version] Rolled back folder {folder_node_id} to snapshot #{target_snapshot_id}, "
            f"{len(files_to_rollback)} files restored"
        )

        return FolderRollbackResponse(
            folder_node_id=folder_node_id,
            new_snapshot_id=snapshot.id,
            rolled_back_to_snapshot=target_snapshot_id,
            files_restored=len(files_to_rollback),
        )

    # ============================================================
    # 文件夹快照
    # ============================================================

    def create_folder_snapshot(
        self,
        folder_node_id: str,
        changed_node_ids: List[str],
        operator_type: str,
        operation: str,
        operator_id: Optional[str] = None,
        session_id: Optional[str] = None,
        summary: Optional[str] = None,
        base_snapshot_id: Optional[int] = None,
        file_version_ids: Optional[List[int]] = None,
    ) -> Optional[FolderSnapshot]:
        """创建文件夹快照（Agent 批量修改后调用）"""
        try:
            folder = self.node_repo.get_by_id(folder_node_id)
            if not folder:
                log_error(f"[Version] Folder not found: {folder_node_id}")
                return None

            descendants = self.node_repo.list_descendants(folder.project_id, folder.id_path)

            file_versions_map = {}
            for child in descendants:
                if child.type != "folder":
                    file_versions_map[child.id] = child.current_version or 0

            snapshot = self.snapshot_repo.create(
                folder_node_id=folder_node_id,
                file_versions_map=file_versions_map,
                changed_files=changed_node_ids,
                files_count=len(file_versions_map),
                changed_count=len(changed_node_ids),
                operator_type=operator_type,
                operator_id=operator_id,
                session_id=session_id,
                operation=operation,
                summary=summary,
                base_snapshot_id=base_snapshot_id,
            )

            if file_version_ids:
                self.version_repo.bulk_update_snapshot_id(file_version_ids, snapshot.id)

            log_info(
                f"[Version] Created folder snapshot #{snapshot.id} for {folder_node_id} "
                f"({len(changed_node_ids)} changed, {len(file_versions_map)} total)"
            )
            return snapshot

        except Exception as e:
            log_error(f"[Version] Failed to create folder snapshot: {e}")
            return None

    # ============================================================
    # 查询
    # ============================================================

    def get_version_history(
        self, node_id: str, limit: int = 50, offset: int = 0
    ) -> VersionHistoryResponse:
        """获取文件的版本历史"""
        node = self.node_repo.get_by_id(node_id)
        if not node:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)

        versions = self.version_repo.list_by_node(node_id, limit, offset)
        total = self.version_repo.count_by_node(node_id)

        version_infos = [
            FileVersionInfo(
                id=v.id, version=v.version, content_hash=v.content_hash,
                size_bytes=v.size_bytes, snapshot_id=v.snapshot_id,
                operator_type=v.operator_type, operator_id=v.operator_id,
                operation=v.operation, merge_strategy=v.merge_strategy,
                summary=v.summary, created_at=v.created_at,
            )
            for v in versions
        ]

        return VersionHistoryResponse(
            node_id=node_id,
            node_name=node.name,
            current_version=node.current_version or 0,
            versions=version_infos,
            total=total,
        )

    def get_version_content(self, node_id: str, version: int) -> FileVersionDetail:
        """获取某个版本的完整内容"""
        v = self.version_repo.get_by_node_and_version(node_id, version)
        if not v:
            raise NotFoundException(
                f"Version {version} not found for node {node_id}",
                code=ErrorCode.NOT_FOUND,
            )

        return FileVersionDetail(
            id=v.id, node_id=v.node_id, version=v.version,
            content_json=v.content_json, content_text=v.content_text,
            s3_key=v.s3_key, content_hash=v.content_hash,
            size_bytes=v.size_bytes, snapshot_id=v.snapshot_id,
            operator_type=v.operator_type, operator_id=v.operator_id,
            operation=v.operation, merge_strategy=v.merge_strategy,
            summary=v.summary, created_at=v.created_at,
        )

    def get_snapshot_history(
        self, folder_node_id: str, limit: int = 50, offset: int = 0
    ) -> FolderSnapshotHistoryResponse:
        """获取文件夹的快照历史"""
        folder = self.node_repo.get_by_id(folder_node_id)
        if not folder:
            raise NotFoundException(f"Folder not found: {folder_node_id}", code=ErrorCode.NOT_FOUND)

        snapshots = self.snapshot_repo.list_by_folder(folder_node_id, limit, offset)
        total = self.snapshot_repo.count_by_folder(folder_node_id)

        snapshot_infos = [
            FolderSnapshotInfo(
                id=s.id, file_versions_map=s.file_versions_map,
                changed_files=s.changed_files, files_count=s.files_count,
                changed_count=s.changed_count, operator_type=s.operator_type,
                operator_id=s.operator_id, operation=s.operation,
                summary=s.summary, base_snapshot_id=s.base_snapshot_id,
                created_at=s.created_at,
            )
            for s in snapshots
        ]

        return FolderSnapshotHistoryResponse(
            folder_node_id=folder_node_id,
            folder_name=folder.name,
            snapshots=snapshot_infos,
            total=total,
        )

    # ============================================================
    # Diff
    # ============================================================

    def compute_diff(self, node_id: str, v1: int, v2: int) -> DiffResponse:
        """对比两个版本的差异"""
        ver1 = self.version_repo.get_by_node_and_version(node_id, v1)
        ver2 = self.version_repo.get_by_node_and_version(node_id, v2)

        if not ver1:
            raise NotFoundException(f"Version {v1} not found", code=ErrorCode.NOT_FOUND)
        if not ver2:
            raise NotFoundException(f"Version {v2} not found", code=ErrorCode.NOT_FOUND)

        changes: List[DiffItem] = []

        if ver1.content_json is not None and ver2.content_json is not None:
            changes = self._diff_json(ver1.content_json, ver2.content_json)
        elif ver1.content_text is not None and ver2.content_text is not None:
            if ver1.content_text != ver2.content_text:
                changes = [DiffItem(
                    path="/",
                    old_value=f"({len(ver1.content_text)} chars)",
                    new_value=f"({len(ver2.content_text)} chars)",
                    change_type="changed",
                )]
        elif ver1.s3_key != ver2.s3_key:
            changes = [DiffItem(
                path="/",
                old_value=ver1.s3_key,
                new_value=ver2.s3_key,
                change_type="changed",
            )]

        return DiffResponse(node_id=node_id, v1=v1, v2=v2, changes=changes)

    # ============================================================
    # 工具方法
    # ============================================================

    @staticmethod
    def _compute_content_hash(
        content_json: Optional[Any] = None,
        content_text: Optional[str] = None,
        s3_key: Optional[str] = None,
    ) -> str:
        """计算内容的 SHA-256 哈希"""
        if content_json is not None:
            payload = json.dumps(content_json, sort_keys=True, ensure_ascii=False).encode("utf-8")
        elif content_text is not None:
            payload = content_text.encode("utf-8")
        elif s3_key is not None:
            payload = s3_key.encode("utf-8")
        else:
            payload = b""

        return hashlib.sha256(payload).hexdigest()

    @staticmethod
    def _diff_json(
        old: Any, new: Any, path: str = ""
    ) -> List[DiffItem]:
        """递归对比两个 JSON 对象"""
        changes: List[DiffItem] = []

        if isinstance(old, dict) and isinstance(new, dict):
            all_keys = set(list(old.keys()) + list(new.keys()))
            for key in sorted(all_keys):
                key_path = f"{path}/{key}"
                if key not in old:
                    changes.append(DiffItem(path=key_path, new_value=new[key], change_type="added"))
                elif key not in new:
                    changes.append(DiffItem(path=key_path, old_value=old[key], change_type="removed"))
                elif old[key] != new[key]:
                    changes.append(DiffItem(path=key_path, old_value=old[key], new_value=new[key], change_type="changed"))
        elif old != new:
            changes.append(DiffItem(path=path or "/", old_value=old, new_value=new, change_type="changed"))

        return changes

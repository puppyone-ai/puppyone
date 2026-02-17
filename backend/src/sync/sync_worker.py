"""
L2.5 Sync — SyncWorker

同步 PG/S3 数据到本地 Lower 目录。
Lower 目录是所有 Agent 工作区的基准数据来源。

同步策略：
  - 增量同步：比对 content_nodes.updated_at 和 .metadata.json 中的时间戳
  - 只同步有变化的文件
  - JSON → 序列化为 .json 文件
  - Markdown → 写为 .md 文件
  - S3 文件 → 下载到 Lower 目录
  - 保持文件夹层级结构，使用人类可读的文件名

迁移自 workspace/sync_worker.py（逻辑完全保留，依赖 CacheManager 管理文件）
"""

import json
import time
from typing import Optional, Dict, Any, List

from src.content_node.repository import ContentNodeRepository
from src.content_node.models import ContentNode
from src.s3.service import S3Service
from src.supabase.client import SupabaseClient
from src.sync.cache_manager import CacheManager
from src.sync.schemas import SyncResult
from src.utils.logger import log_info, log_error, log_debug


class SyncWorker:
    """同步 PG/S3 数据到本地 Lower 目录"""

    def __init__(
        self,
        node_repo: Optional[ContentNodeRepository] = None,
        s3_service: Optional[S3Service] = None,
        base_dir: str = "/tmp/contextbase",
        cache_manager: Optional[CacheManager] = None,
    ):
        self._node_repo = node_repo or ContentNodeRepository(SupabaseClient())
        self._s3 = s3_service
        self._cache = cache_manager or CacheManager(base_dir=base_dir)

    @property
    def lower_dir(self) -> str:
        return self._cache.lower_dir

    def _build_path_map(self, nodes: List[ContentNode]) -> Dict[str, str]:
        """
        构建 node_id → 文件系统路径 的映射（保持文件夹层级和人类可读名称）

        例如:
          Tool_Configs/              (folder)
            config.json              (json)
            SubFolder/               (folder)
              data.json              (json)

        生成:
          {node_id_of_config: "Tool_Configs/config.json"}
          {node_id_of_data: "Tool_Configs/SubFolder/data.json"}
        """
        id_to_node: Dict[str, ContentNode] = {n.id: n for n in nodes}
        path_cache: Dict[str, str] = {}

        def _get_path(node: ContentNode) -> str:
            if node.id in path_cache:
                return path_cache[node.id]

            name = node.name or node.id

            if node.parent_id and node.parent_id in id_to_node:
                parent_path = _get_path(id_to_node[node.parent_id])
                full_path = f"{parent_path}/{name}"
            else:
                full_path = name

            path_cache[node.id] = full_path
            return full_path

        result: Dict[str, str] = {}
        for node in nodes:
            if node.type == "folder":
                _get_path(node)
                continue
            path = _get_path(node)
            result[node.id] = path

        return result

    # ============================================================
    # 核心同步
    # ============================================================

    async def sync_project(self, project_id: str, force: bool = False) -> SyncResult:
        """
        同步一个项目的所有内容节点到 Lower 目录

        Args:
            project_id: 项目 ID
            force: True = 忽略增量标记，全量重新同步

        Returns:
            SyncResult
        """
        start_time = time.time()

        nodes = self._node_repo.list_by_project(project_id)
        path_map = self._build_path_map(nodes)
        metadata = {} if force else self._cache.read_metadata(project_id)

        synced = 0
        skipped = 0
        failed = 0
        new_metadata: Dict[str, Any] = {}

        for node in nodes:
            if node.type == "folder":
                continue

            node_meta = metadata.get(node.id, {})
            last_sync = node_meta.get("updated_at", "")
            node_updated = node.updated_at.isoformat() if node.updated_at else ""

            if not force and last_sync and last_sync >= node_updated:
                skipped += 1
                new_metadata[node.id] = node_meta
                continue

            file_path = path_map.get(node.id, node.name or node.id)
            success = await self._sync_node(project_id, node, file_path)

            if success:
                synced += 1
                new_metadata[node.id] = {
                    "updated_at": node_updated,
                    "name": node.name,
                    "type": node.type,
                    "file_path": file_path,
                    "version": getattr(node, "current_version", 0),
                }
            else:
                failed += 1
                new_metadata[node.id] = node_meta

        self._cache.write_metadata(project_id, new_metadata)

        elapsed = time.time() - start_time
        log_info(
            f"[SyncWorker] Project {project_id}: "
            f"synced={synced}, skipped={skipped}, failed={failed}, "
            f"total={len(nodes)}, elapsed={elapsed:.2f}s"
        )

        return SyncResult(
            synced=synced,
            skipped=skipped,
            failed=failed,
            total=len(nodes),
            elapsed_seconds=round(elapsed, 2),
        )

    async def _sync_node(self, project_id: str, node: ContentNode, file_path: str) -> bool:
        """同步单个节点到 Lower 目录"""
        try:
            if node.preview_json is not None:
                content = json.dumps(node.preview_json, ensure_ascii=False, indent=2)
                if not file_path.endswith(".json"):
                    file_path = f"{file_path}.json"
                return self._cache.write_file(project_id, file_path, content)

            elif node.preview_md is not None:
                if not file_path.endswith(".md"):
                    file_path = f"{file_path}.md"
                return self._cache.write_file(project_id, file_path, node.preview_md)

            elif node.s3_key and self._s3:
                try:
                    content_bytes = await self._s3.download_file(node.s3_key)
                    return self._cache.write_bytes(project_id, file_path, content_bytes)
                except Exception as e:
                    log_error(f"[SyncWorker] S3 download failed for {node.id} ({file_path}): {e}")
                    return False

            else:
                log_debug(f"[SyncWorker] Node {node.id} ({file_path}) has no content, skipping")
                return True

        except Exception as e:
            log_error(f"[SyncWorker] Failed to sync node {node.id} ({file_path}): {e}")
            return False

    async def sync_node_by_id(self, project_id: str, node_id: str) -> bool:
        """同步单个节点（用于增量更新）"""
        node = self._node_repo.get_by_id(node_id)
        if not node:
            return False

        nodes = self._node_repo.list_by_project(project_id)
        path_map = self._build_path_map(nodes)
        file_path = path_map.get(node_id, node.name or node_id)

        return await self._sync_node(project_id, node, file_path)

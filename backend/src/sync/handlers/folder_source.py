"""
Sync Handler — FolderSourceService (Collection 包装器)

将本地文件夹作为信息源连接到 PuppyOne。

产品语义：「连接 → 收集」
  用户在本地有一个文件夹（如 ~/Documents/project-context），
  连接后 PuppyOne 持续监听该文件夹的变更，自动导入新内容。

技术路径：
  folder_sync 引擎 (I/O) → ContentNodeService.update_node() (直接覆写)
  本地文件夹是 source of truth，不走 L2 乐观锁。
  ContentNodeService._track_version() 会自动记录历史版本。
"""

import asyncio
import json
from typing import Optional, List, Set, TYPE_CHECKING

from src.folder_sync import (
    scan_directory, scan_paths, read_file,
    FolderWatcher, diff_snapshots, diff_incremental,
    IgnoreRules, FolderSnapshot, FileEntry,
)
from src.sync.repository import SyncSourceRepository, NodeSyncRepository
from src.sync.schemas import SyncSource, SyncMapping
from src.utils.logger import log_info, log_error, log_debug

if TYPE_CHECKING:
    from src.content_node.service import ContentNodeService


class FolderSourceService:
    """
    Collection: 本地文件夹 → PuppyOne

    生命周期：
      connect()  → 扫描 + 创建节点 + 绑定 + 启动监听
      disconnect() → 停止监听 + 解绑

    由 app 生命周期管理（startup 时恢复所有 active 的 folder source）。
    """

    _instance: Optional["FolderSourceService"] = None

    def __init__(
        self,
        node_service: "ContentNodeService",
        source_repo: SyncSourceRepository,
        node_sync_repo: NodeSyncRepository,
    ):
        self._node_svc = node_service
        self._sources = source_repo
        self._node_sync = node_sync_repo
        self._watchers: dict[int, FolderWatcher] = {}
        self._snapshots: dict[int, FolderSnapshot] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @classmethod
    def get_instance(cls) -> Optional["FolderSourceService"]:
        return cls._instance

    # ============================================================
    # Connect / Disconnect
    # ============================================================

    async def connect(
        self,
        project_id: str,
        folder_path: str,
        target_folder_node_id: Optional[str] = None,
        ignore_patterns: Optional[list[str]] = None,
    ) -> SyncSource:
        """
        连接本地文件夹。

        1. 注册 SyncSource
        2. 全量扫描 → 为每个文件创建 content_node → 绑定 sync mapping
        3. 拉取初始内容
        4. 启动 FolderWatcher
        """
        self._loop = asyncio.get_event_loop()

        source = self._sources.create(
            project_id=project_id,
            adapter_type="folder_source",
            config={"path": folder_path},
            trigger_config={"type": "watchdog"},
            sync_mode="pull_only",
            conflict_strategy="external_wins",
        )

        ignore_rules = IgnoreRules()
        if ignore_patterns:
            for p in ignore_patterns:
                ignore_rules.add_pattern(p)

        snapshot = scan_directory(folder_path, ignore_rules)
        self._snapshots[source.id] = snapshot

        bindings = await self._bootstrap_nodes(
            source=source,
            snapshot=snapshot,
            folder_path=folder_path,
            target_folder_node_id=target_folder_node_id,
        )

        await self._pull_initial_content(source, snapshot, folder_path)

        self._start_watcher(source.id, folder_path, ignore_rules)

        log_info(
            f"[FolderSource] Connected: {folder_path} → project {project_id} "
            f"({len(bindings)} files, source #{source.id})"
        )
        return source

    async def disconnect(self, source_id: int) -> None:
        """断开连接：停止监听 + 解绑。"""
        self._stop_watcher(source_id)
        self._snapshots.pop(source_id, None)
        self._node_sync.unbind_by_source(source_id)
        self._sources.delete(source_id)
        log_info(f"[FolderSource] Disconnected source #{source_id}")

    # ============================================================
    # Bootstrap: 首次连接时创建节点
    # ============================================================

    async def _bootstrap_nodes(
        self,
        source: SyncSource,
        snapshot: FolderSnapshot,
        folder_path: str,
        target_folder_node_id: Optional[str],
    ) -> List[SyncMapping]:
        """为快照中的每个文件创建 content_node 并绑定。"""
        bindings: List[SyncMapping] = []

        for rel_path, entry in snapshot.entries.items():
            existing = self._node_sync.find_by_resource(source.id, rel_path)
            if existing:
                bindings.append(existing)
                continue

            node_id = await self._create_node_for_file(
                project_id=source.project_id,
                rel_path=rel_path,
                content_type=entry.content_type,
                parent_id=target_folder_node_id,
            )

            mapping = self._node_sync.bind_node(
                node_id=node_id,
                source_id=source.id,
                external_resource_id=rel_path,
            )
            bindings.append(mapping)

        return bindings

    async def _create_node_for_file(
        self,
        project_id: str,
        rel_path: str,
        content_type: str,
        parent_id: Optional[str],
    ) -> str:
        """根据文件类型创建对应的 content_node。"""
        import os
        name = os.path.splitext(os.path.basename(rel_path))[0]

        if content_type == "json":
            node = self._node_svc.create_json_node(
                project_id=project_id,
                name=name,
                content={},
                parent_id=parent_id,
                created_by="folder_source",
            )
        else:
            node = await self._node_svc.create_markdown_node(
                project_id=project_id,
                name=name,
                content="",
                parent_id=parent_id,
                created_by="folder_source",
            )
        return node.id

    # ============================================================
    # Pull: 本地文件 → PuppyOne
    # ============================================================

    async def _pull_initial_content(
        self,
        source: SyncSource,
        snapshot: FolderSnapshot,
        folder_path: str,
    ) -> None:
        """首次连接时拉取所有文件内容到 PuppyOne。"""
        for rel_path in snapshot.entries:
            mapping = self._node_sync.find_by_resource(source.id, rel_path)
            if not mapping:
                continue
            await self._pull_single_file(source, mapping, folder_path)

    async def _pull_single_file(
        self,
        source: SyncSource,
        mapping: SyncMapping,
        folder_path: str,
    ) -> bool:
        """拉取单个文件内容到 PuppyOne（直接覆写，不走 L2 乐观锁）。"""
        fc = read_file(folder_path, mapping.external_resource_id)
        if fc is None:
            return False

        try:
            if fc.content_type == "json":
                self._node_svc.update_node(
                    node_id=mapping.node_id,
                    project_id=source.project_id,
                    preview_json=fc.content,
                    operator_type="sync",
                    operator_id=f"folder_source:{source.id}",
                )
            else:
                content_str = fc.content if isinstance(fc.content, str) else str(fc.content)
                await self._node_svc.update_markdown_content(
                    node_id=mapping.node_id,
                    project_id=source.project_id,
                    content=content_str,
                    operator_type="sync",
                    operator_id=f"folder_source:{source.id}",
                )

            self._node_sync.update_sync_point(
                node_id=mapping.node_id,
                last_sync_version=0,
                remote_hash=fc.content_hash,
            )
            return True

        except Exception as e:
            log_error(f"[FolderSource] Pull failed for {mapping.external_resource_id}: {e}")
            self._node_sync.update_error(mapping.node_id, str(e))
            return False

    # ============================================================
    # Watcher integration
    # ============================================================

    def _start_watcher(
        self, source_id: int, folder_path: str, ignore_rules: IgnoreRules,
    ) -> None:
        """启动 FolderWatcher。"""
        if source_id in self._watchers:
            return

        watcher = FolderWatcher(
            watch_path=folder_path,
            ignore_rules=ignore_rules,
        )

        def on_change(changed: Set[str]) -> None:
            if self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._handle_changes(source_id, changed),
                    self._loop,
                )

        watcher.start(on_change=on_change)
        self._watchers[source_id] = watcher
        log_info(f"[FolderSource] Watcher started for source #{source_id}")

    def _stop_watcher(self, source_id: int) -> None:
        """停止 FolderWatcher。"""
        watcher = self._watchers.pop(source_id, None)
        if watcher:
            watcher.stop()
            log_info(f"[FolderSource] Watcher stopped for source #{source_id}")

    def start_for_source(self, source_id: int) -> None:
        """外部调用：为指定 source 启动 watcher。"""
        source = self._sources.get_by_id(source_id)
        if not source or source.adapter_type != "folder_source":
            return
        folder_path = source.config.get("path", "")
        if folder_path:
            self._start_watcher(source_id, folder_path, IgnoreRules())

    def stop_for_source(self, source_id: int) -> None:
        """外部调用：停止指定 source 的 watcher。"""
        self._stop_watcher(source_id)

    async def _handle_changes(self, source_id: int, changed_paths: Set[str]) -> None:
        """
        Watcher 回调：处理文件变更。

        1. scan_paths() 获取变更文件的最新状态
        2. diff_incremental() 对比快照
        3. 对 created/modified 执行 pull
        """
        source = self._sources.get_by_id(source_id)
        if not source or source.status != "active":
            return

        folder_path = source.config.get("path", "")
        snapshot = self._snapshots.get(source_id)
        if not snapshot:
            snapshot = FolderSnapshot(root_path=folder_path)

        scanned = scan_paths(folder_path, changed_paths)
        changes = diff_incremental(snapshot, scanned)

        if changes.is_empty:
            return

        log_debug(
            f"[FolderSource] source #{source_id}: "
            f"+{len(changes.created)} ~{len(changes.modified)} -{len(changes.deleted)}"
        )

        for entry in changes.created:
            await self._handle_new_file(source, entry, folder_path)

        for entry in changes.modified:
            mapping = self._node_sync.find_by_resource(source_id, entry.rel_path)
            if mapping:
                await self._pull_single_file(source, mapping, folder_path)

        for entry in changes.created + changes.modified:
            snapshot.entries[entry.rel_path] = entry
        for rel_path in changes.deleted:
            snapshot.entries.pop(rel_path, None)
        self._snapshots[source_id] = snapshot

    async def _handle_new_file(
        self, source: SyncSource, entry: FileEntry, folder_path: str,
    ) -> None:
        """处理新文件：创建节点 + 绑定 + 拉取内容。"""
        existing = self._node_sync.find_by_resource(source.id, entry.rel_path)
        if existing:
            return

        node_id = await self._create_node_for_file(
            project_id=source.project_id,
            rel_path=entry.rel_path,
            content_type=entry.content_type,
            parent_id=None,
        )

        mapping = self._node_sync.bind_node(
            node_id=node_id,
            source_id=source.id,
            external_resource_id=entry.rel_path,
        )

        await self._pull_single_file(source, mapping, folder_path)
        log_info(f"[FolderSource] New file: {entry.rel_path} → node {node_id}")

    # ============================================================
    # Lifecycle: 应用启动/关闭
    # ============================================================

    async def start(self) -> None:
        """应用启动时恢复所有 active 的 folder source。"""
        self._loop = asyncio.get_event_loop()
        FolderSourceService._instance = self
        sources = self._sources.list_active("folder_source")
        started = 0

        for source in sources:
            folder_path = source.config.get("path", "")
            if not folder_path:
                continue

            snapshot = scan_directory(folder_path)
            self._snapshots[source.id] = snapshot
            self._start_watcher(source.id, folder_path, IgnoreRules())
            started += 1

        if started:
            log_info(f"[FolderSource] Restored {started} folder sources")

    async def stop(self) -> None:
        """应用关闭时停止所有 watcher。"""
        for source_id in list(self._watchers.keys()):
            self._stop_watcher(source_id)
        self._snapshots.clear()
        FolderSourceService._instance = None
        log_info("[FolderSource] All watchers stopped")

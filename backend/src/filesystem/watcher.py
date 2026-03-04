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
from src.sync.repository import SyncRepository
from src.sync.schemas import Sync
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
        sync_repo: SyncRepository,
    ):
        self._node_svc = node_service
        self._sync_repo = sync_repo
        self._watchers: dict[str, FolderWatcher] = {}
        self._snapshots: dict[str, FolderSnapshot] = {}
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
    ) -> Sync:
        """
        连接本地文件夹。

        1. 创建 root Sync
        2. 全量扫描 → 为每个文件创建 content_node → 绑定 Sync
        3. 拉取初始内容
        4. 启动 FolderWatcher
        """
        self._loop = asyncio.get_event_loop()

        root_sync = self._sync_repo.create(
            project_id=project_id,
            node_id=target_folder_node_id or "",
            direction="inbound",
            provider="folder_source",
            config={"path": folder_path},
            trigger={"type": "watchdog"},
            conflict_strategy="external_wins",
        )

        ignore_rules = IgnoreRules()
        if ignore_patterns:
            for p in ignore_patterns:
                ignore_rules.add_pattern(p)

        snapshot = scan_directory(folder_path, ignore_rules)
        self._snapshots[root_sync.id] = snapshot

        bindings = await self._bootstrap_nodes(
            root_sync=root_sync,
            snapshot=snapshot,
            folder_path=folder_path,
            target_folder_node_id=target_folder_node_id,
        )

        await self._pull_initial_content(root_sync, snapshot, folder_path)

        self._start_watcher(root_sync.id, folder_path, ignore_rules)

        log_info(
            f"[FolderSource] Connected: {folder_path} → project {project_id} "
            f"({len(bindings)} files, sync #{root_sync.id})"
        )
        return root_sync

    async def disconnect(self, sync_id: str) -> None:
        """断开连接：停止监听 + 解绑。"""
        self._stop_watcher(sync_id)
        self._snapshots.pop(sync_id, None)
        sync = self._sync_repo.get_by_id(sync_id)
        if sync:
            related = self._sync_repo.list_by_provider(sync.project_id, "folder_source")
            for s in related:
                self._sync_repo.delete(s.id)
        log_info(f"[FolderSource] Disconnected sync #{sync_id}")

    # ============================================================
    # Bootstrap: 首次连接时创建节点
    # ============================================================

    async def _bootstrap_nodes(
        self,
        root_sync: Sync,
        snapshot: FolderSnapshot,
        folder_path: str,
        target_folder_node_id: Optional[str],
    ) -> List[Sync]:
        """为快照中的每个文件创建 content_node 并绑定。"""
        bindings: List[Sync] = []

        for rel_path, entry in snapshot.entries.items():
            existing = self._sync_repo.find_by_config_key(
                "folder_source", "external_resource_id", rel_path,
            )
            if existing:
                bindings.append(existing)
                continue

            node_id = await self._create_node_for_file(
                project_id=root_sync.project_id,
                rel_path=rel_path,
                content_type=entry.content_type,
                parent_id=target_folder_node_id,
            )

            node_sync = self._sync_repo.create(
                project_id=root_sync.project_id,
                node_id=node_id,
                direction="inbound",
                provider="folder_source",
                config={
                    "external_resource_id": rel_path,
                    "path": folder_path,
                },
            )
            bindings.append(node_sync)

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
        root_sync: Sync,
        snapshot: FolderSnapshot,
        folder_path: str,
    ) -> None:
        """首次连接时拉取所有文件内容到 PuppyOne。"""
        for rel_path in snapshot.entries:
            node_sync = self._sync_repo.find_by_config_key(
                "folder_source", "external_resource_id", rel_path,
            )
            if not node_sync:
                continue
            await self._pull_single_file(root_sync, node_sync, folder_path)

    async def _pull_single_file(
        self,
        root_sync: Sync,
        node_sync: Sync,
        folder_path: str,
    ) -> bool:
        """拉取单个文件内容到 PuppyOne（直接覆写，不走 L2 乐观锁）。"""
        external_resource_id = node_sync.config.get("external_resource_id", "")
        fc = read_file(folder_path, external_resource_id)
        if fc is None:
            return False

        try:
            if fc.content_type == "json":
                self._node_svc.update_node(
                    node_id=node_sync.node_id,
                    project_id=root_sync.project_id,
                    preview_json=fc.content,
                    operator_type="sync",
                    operator_id=f"folder_source:{root_sync.id}",
                )
            else:
                content_str = fc.content if isinstance(fc.content, str) else str(fc.content)
                await self._node_svc.update_markdown_content(
                    node_id=node_sync.node_id,
                    project_id=root_sync.project_id,
                    content=content_str,
                    operator_type="sync",
                    operator_id=f"folder_source:{root_sync.id}",
                )

            self._sync_repo.update_sync_point(
                sync_id=node_sync.id,
                last_sync_version=0,
                remote_hash=fc.content_hash,
            )
            return True

        except Exception as e:
            log_error(f"[FolderSource] Pull failed for {external_resource_id}: {e}")
            self._sync_repo.update_error(node_sync.id, str(e))
            return False

    # ============================================================
    # Watcher integration
    # ============================================================

    def _start_watcher(
        self, sync_id: str, folder_path: str, ignore_rules: IgnoreRules,
    ) -> None:
        """启动 FolderWatcher。"""
        if sync_id in self._watchers:
            return

        watcher = FolderWatcher(
            watch_path=folder_path,
            ignore_rules=ignore_rules,
        )

        def on_change(changed: Set[str]) -> None:
            if self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._handle_changes(sync_id, changed),
                    self._loop,
                )

        watcher.start(on_change=on_change)
        self._watchers[sync_id] = watcher
        log_info(f"[FolderSource] Watcher started for sync #{sync_id}")

    def _stop_watcher(self, sync_id: str) -> None:
        """停止 FolderWatcher。"""
        watcher = self._watchers.pop(sync_id, None)
        if watcher:
            watcher.stop()
            log_info(f"[FolderSource] Watcher stopped for sync #{sync_id}")

    def start_for_sync(self, sync_id: str) -> None:
        """外部调用：为指定 sync 启动 watcher。"""
        sync = self._sync_repo.get_by_id(sync_id)
        if not sync or sync.provider != "folder_source":
            return
        folder_path = sync.config.get("path", "")
        if folder_path:
            self._start_watcher(sync_id, folder_path, IgnoreRules())

    def stop_for_sync(self, sync_id: str) -> None:
        """外部调用：停止指定 sync 的 watcher。"""
        self._stop_watcher(sync_id)

    async def _handle_changes(self, root_sync_id: str, changed_paths: Set[str]) -> None:
        """
        Watcher 回调：处理文件变更。

        1. scan_paths() 获取变更文件的最新状态
        2. diff_incremental() 对比快照
        3. 对 created/modified 执行 pull
        """
        root_sync = self._sync_repo.get_by_id(root_sync_id)
        if not root_sync or root_sync.status != "active":
            return

        folder_path = root_sync.config.get("path", "")
        snapshot = self._snapshots.get(root_sync_id)
        if not snapshot:
            snapshot = FolderSnapshot(root_path=folder_path)

        scanned = scan_paths(folder_path, changed_paths)
        changes = diff_incremental(snapshot, scanned)

        if changes.is_empty:
            return

        log_debug(
            f"[FolderSource] sync #{root_sync_id}: "
            f"+{len(changes.created)} ~{len(changes.modified)} -{len(changes.deleted)}"
        )

        for entry in changes.created:
            await self._handle_new_file(root_sync, entry, folder_path)

        for entry in changes.modified:
            node_sync = self._sync_repo.find_by_config_key(
                "folder_source", "external_resource_id", entry.rel_path,
            )
            if node_sync:
                await self._pull_single_file(root_sync, node_sync, folder_path)

        for entry in changes.created + changes.modified:
            snapshot.entries[entry.rel_path] = entry
        for rel_path in changes.deleted:
            snapshot.entries.pop(rel_path, None)
        self._snapshots[root_sync_id] = snapshot

    async def _handle_new_file(
        self, root_sync: Sync, entry: FileEntry, folder_path: str,
    ) -> None:
        """处理新文件：创建节点 + 绑定 + 拉取内容。"""
        existing = self._sync_repo.find_by_config_key(
            "folder_source", "external_resource_id", entry.rel_path,
        )
        if existing:
            return

        node_id = await self._create_node_for_file(
            project_id=root_sync.project_id,
            rel_path=entry.rel_path,
            content_type=entry.content_type,
            parent_id=None,
        )

        node_sync = self._sync_repo.create(
            project_id=root_sync.project_id,
            node_id=node_id,
            direction="inbound",
            provider="folder_source",
            config={
                "external_resource_id": entry.rel_path,
                "path": folder_path,
            },
        )

        await self._pull_single_file(root_sync, node_sync, folder_path)
        log_info(f"[FolderSource] New file: {entry.rel_path} → node {node_id}")

    # ============================================================
    # Lifecycle: 应用启动/关闭
    # ============================================================

    async def start(self) -> None:
        """应用启动时恢复所有 active 的 folder source。"""
        self._loop = asyncio.get_event_loop()
        FolderSourceService._instance = self
        syncs = self._sync_repo.list_active("folder_source")
        started = 0

        seen_paths: set[str] = set()
        for sync in syncs:
            folder_path = sync.config.get("path", "")
            if not folder_path or folder_path in seen_paths:
                continue
            seen_paths.add(folder_path)

            snapshot = scan_directory(folder_path)
            self._snapshots[sync.id] = snapshot
            self._start_watcher(sync.id, folder_path, IgnoreRules())
            started += 1

        if started:
            log_info(f"[FolderSource] Restored {started} folder sources")

    async def stop(self) -> None:
        """应用关闭时停止所有 watcher。"""
        for sync_id in list(self._watchers.keys()):
            self._stop_watcher(sync_id)
        self._snapshots.clear()
        FolderSourceService._instance = None
        log_info("[FolderSource] All watchers stopped")

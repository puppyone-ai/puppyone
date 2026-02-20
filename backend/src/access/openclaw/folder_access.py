"""
Access — FolderAccessService (Distribution 包装器)

将 PuppyOne 数据分发到本地工作区文件夹，供 Agent 读写。

产品语义：「分发 → 使用」
  OpenClaw / Cursor / Claude Code 等 Agent 通过一个本地文件夹
  与 PuppyOne 数据交互。PuppyOne 把数据推送到该文件夹，
  Agent 在文件夹内的修改会被同步回 PuppyOne。

技术路径：
  PuppyOne → folder:  folder_sync.write_file()  (推送)
  folder → PuppyOne:  folder_sync.read_file() → CollaborationService.commit()  (版本管理)

与 FolderSourceService 的核心区别：
  - FolderSource (Collection): 本地是 source of truth → ContentNodeService (直接覆写)
  - FolderAccess (Distribution): PuppyOne 是 source of truth → CollaborationService (乐观锁)
"""

import asyncio
import json
from typing import Optional, Any, Set, TYPE_CHECKING

from src.folder_sync import (
    scan_directory, scan_paths, read_file, write_file, delete_file,
    FolderWatcher, diff_incremental,
    IgnoreRules, FolderSnapshot, FileEntry,
)
from src.sync.repository import SyncSourceRepository, NodeSyncRepository
from src.sync.schemas import SyncSource, SyncMapping
from src.utils.logger import log_info, log_error, log_debug

if TYPE_CHECKING:
    from src.collaboration.service import CollaborationService
    from src.content_node.service import ContentNodeService


class FolderAccessService:
    """
    Distribution: PuppyOne ↔ Agent Workspace 双向同步

    双向数据流：
      PUSH (PuppyOne → 文件夹):
        当 PuppyOne 数据变更 → write_file() 写入工作区文件夹
      PULL (文件夹 → PuppyOne):
        Agent 修改文件 → read_file() → CollaborationService.commit()

    回声抑制：
      PUSH 写入文件后更新本地 snapshot 的 hash，
      Watcher 触发时 diff_incremental 发现 hash 未变 → 跳过。

    生命周期：
      setup_workspace()    → 导出数据 + 启动监听
      teardown_workspace() → 停止监听 + 可选清理
    """

    _instance: Optional["FolderAccessService"] = None

    def __init__(
        self,
        collab_service: "CollaborationService",
        node_service: "ContentNodeService",
        source_repo: SyncSourceRepository,
        node_sync_repo: NodeSyncRepository,
    ):
        self._collab = collab_service
        self._node_svc = node_service
        self._sources = source_repo
        self._node_sync = node_sync_repo
        self._watchers: dict[int, FolderWatcher] = {}
        self._snapshots: dict[int, FolderSnapshot] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @classmethod
    def get_instance(cls) -> Optional["FolderAccessService"]:
        return cls._instance

    # ============================================================
    # Setup / Teardown
    # ============================================================

    async def setup_workspace(
        self,
        project_id: str,
        workspace_path: str,
        node_ids: Optional[list[str]] = None,
        agent_name: str = "openclaw",
        ignore_patterns: Optional[list[str]] = None,
    ) -> SyncSource:
        """
        为 Agent 创建工作区分发。

        1. 注册 SyncSource
        2. 导出 PuppyOne 数据到工作区文件夹
        3. 拍摄初始快照
        4. 启动 FolderWatcher 监听 Agent 修改
        """
        self._loop = asyncio.get_event_loop()

        source = self._sources.create(
            project_id=project_id,
            adapter_type="folder_access",
            config={
                "path": workspace_path,
                "agent_name": agent_name,
            },
            trigger_config={"type": "watchdog"},
            sync_mode="bidirectional",
            conflict_strategy="three_way_merge",
        )

        ignore_rules = IgnoreRules()
        if ignore_patterns:
            for p in ignore_patterns:
                ignore_rules.add_pattern(p)

        await self._export_to_workspace(source, workspace_path, node_ids)

        snapshot = scan_directory(workspace_path, ignore_rules)
        self._snapshots[source.id] = snapshot

        self._start_watcher(source.id, workspace_path, ignore_rules)

        log_info(
            f"[FolderAccess] Workspace ready: {workspace_path} "
            f"(agent={agent_name}, source #{source.id}, "
            f"{len(snapshot.entries)} files)"
        )
        return source

    async def teardown_workspace(self, source_id: int) -> None:
        """拆除工作区分发。"""
        self._stop_watcher(source_id)
        self._snapshots.pop(source_id, None)
        self._node_sync.unbind_by_source(source_id)
        self._sources.delete(source_id)
        log_info(f"[FolderAccess] Workspace torn down: source #{source_id}")

    # ============================================================
    # PUSH: PuppyOne → 工作区文件夹
    # ============================================================

    async def _export_to_workspace(
        self,
        source: SyncSource,
        workspace_path: str,
        node_ids: Optional[list[str]] = None,
    ) -> int:
        """
        首次导出：把 PuppyOne 数据写入工作区文件夹。

        如果 node_ids 为空，导出项目下所有可导出的节点。
        """
        nodes = self._get_exportable_nodes(source.project_id, node_ids)
        exported = 0

        for node in nodes:
            rel_path = self._node_to_rel_path(node)
            content, content_type = self._extract_content(node)
            if content is None:
                continue

            entry = write_file(workspace_path, rel_path, content, content_type)

            self._node_sync.bind_node(
                node_id=node.id,
                source_id=source.id,
                external_resource_id=rel_path,
            )

            version = getattr(node, "current_version", 0) or 0
            self._node_sync.update_sync_point(
                node_id=node.id,
                last_sync_version=version,
                remote_hash=entry.content_hash,
            )
            exported += 1

        return exported

    async def push_node_to_workspace(
        self,
        source_id: int,
        node_id: str,
        version: int,
        content: Any,
        node_type: str,
    ) -> bool:
        """
        当 PuppyOne 数据变更时，推送到工作区文件夹。

        在 L2.commit() 成功后调用（类似现有 SyncService.push_node）。
        写入后更新快照以抑制 watcher 回声。
        """
        mapping = self._node_sync.get_by_node(node_id)
        if not mapping or mapping.source_id != source_id:
            return False

        if mapping.last_sync_version >= version:
            return False

        source = self._sources.get_by_id(source_id)
        if not source or source.status != "active":
            return False

        workspace_path = source.config.get("path", "")
        content_type = "json" if node_type == "json" else "markdown"

        try:
            entry = write_file(
                workspace_path, mapping.external_resource_id,
                content, content_type,
            )

            # 更新快照（回声抑制的关键）
            snapshot = self._snapshots.get(source_id)
            if snapshot:
                snapshot.entries[mapping.external_resource_id] = entry

            self._node_sync.update_sync_point(
                node_id=node_id,
                last_sync_version=version,
                remote_hash=entry.content_hash,
            )

            log_info(
                f"[FolderAccess] PUSH node {node_id} v{version} → "
                f"{mapping.external_resource_id}"
            )
            return True

        except Exception as e:
            log_error(f"[FolderAccess] PUSH failed for node {node_id}: {e}")
            return False

    # ============================================================
    # PULL: 工作区文件夹 → PuppyOne (经 L2 版本管理)
    # ============================================================

    async def _pull_agent_change(
        self,
        source: SyncSource,
        mapping: SyncMapping,
        workspace_path: str,
    ) -> bool:
        """
        Agent 修改了文件 → 经 L2 CollaborationService.commit() 写回 PuppyOne。

        commit() 内部会：
          1. 乐观锁检查 (base_version vs current_version)
          2. 冲突则三方合并
          3. 创建版本记录
          4. 审计日志
        """
        fc = read_file(workspace_path, mapping.external_resource_id)
        if fc is None:
            return False

        if mapping.remote_hash and fc.content_hash == mapping.remote_hash:
            return False

        try:
            base_content = self._get_base_content(mapping)

            commit_result = self._collab.commit(
                node_id=mapping.node_id,
                new_content=fc.content,
                base_version=mapping.last_sync_version,
                node_type=fc.content_type,
                base_content=base_content,
                operator_type="agent",
                operator_id=source.config.get("agent_name", "folder_access"),
                summary=f"Agent edit: {mapping.external_resource_id}",
            )

            self._node_sync.update_sync_point(
                node_id=mapping.node_id,
                last_sync_version=commit_result.version,
                remote_hash=fc.content_hash,
            )

            log_info(
                f"[FolderAccess] PULL {mapping.external_resource_id} → "
                f"node {mapping.node_id} v{commit_result.version} "
                f"({commit_result.status})"
            )
            return True

        except Exception as e:
            log_error(
                f"[FolderAccess] PULL failed for "
                f"{mapping.external_resource_id}: {e}"
            )
            self._node_sync.update_error(mapping.node_id, str(e))
            return False

    def _get_base_content(self, mapping: SyncMapping) -> Optional[str]:
        """获取三方合并的 base content（上次同步版本的内容）。"""
        if mapping.last_sync_version <= 0:
            return None
        try:
            ver = self._collab.get_version_content(
                mapping.node_id, mapping.last_sync_version,
            )
            if ver.content_text:
                return ver.content_text
            if ver.content_json is not None:
                return json.dumps(ver.content_json, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return None

    # ============================================================
    # Watcher integration
    # ============================================================

    def _start_watcher(
        self, source_id: int, workspace_path: str, ignore_rules: IgnoreRules,
    ) -> None:
        if source_id in self._watchers:
            return

        watcher = FolderWatcher(
            watch_path=workspace_path,
            ignore_rules=ignore_rules,
        )

        def on_change(changed: Set[str]) -> None:
            if self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._handle_agent_changes(source_id, changed),
                    self._loop,
                )

        watcher.start(on_change=on_change)
        self._watchers[source_id] = watcher

    def _stop_watcher(self, source_id: int) -> None:
        watcher = self._watchers.pop(source_id, None)
        if watcher:
            watcher.stop()

    async def _handle_agent_changes(
        self, source_id: int, changed_paths: Set[str],
    ) -> None:
        """
        Watcher 回调：Agent 修改了工作区文件。

        1. scan_paths() 获取变更文件最新状态
        2. diff_incremental() 对比快照（回声抑制在这里生效）
        3. 对真正有变化的文件执行 PULL → CollaborationService.commit()
        """
        source = self._sources.get_by_id(source_id)
        if not source or source.status != "active":
            return

        workspace_path = source.config.get("path", "")
        snapshot = self._snapshots.get(source_id)
        if not snapshot:
            snapshot = FolderSnapshot(root_path=workspace_path)

        scanned = scan_paths(workspace_path, changed_paths)
        changes = diff_incremental(snapshot, scanned)

        if changes.is_empty:
            return

        log_debug(
            f"[FolderAccess] source #{source_id}: "
            f"+{len(changes.created)} ~{len(changes.modified)} -{len(changes.deleted)}"
        )

        for entry in changes.created:
            await self._handle_new_agent_file(source, entry, workspace_path)

        for entry in changes.modified:
            mapping = self._node_sync.find_by_resource(source_id, entry.rel_path)
            if mapping:
                await self._pull_agent_change(source, mapping, workspace_path)

        # 更新快照
        for entry in changes.created + changes.modified:
            snapshot.entries[entry.rel_path] = entry
        for rel_path in changes.deleted:
            snapshot.entries.pop(rel_path, None)
        self._snapshots[source_id] = snapshot

    async def _handle_new_agent_file(
        self,
        source: SyncSource,
        entry: FileEntry,
        workspace_path: str,
    ) -> None:
        """Agent 在工作区创建了新文件 → 创建节点 + commit。"""
        import os

        existing = self._node_sync.find_by_resource(source.id, entry.rel_path)
        if existing:
            return

        name = os.path.splitext(os.path.basename(entry.rel_path))[0]
        agent_name = source.config.get("agent_name", "folder_access")

        if entry.content_type == "json":
            node = self._node_svc.create_json_node(
                project_id=source.project_id,
                name=name,
                content={},
                parent_id=None,
                created_by=agent_name,
            )
        else:
            node = await self._node_svc.create_markdown_node(
                project_id=source.project_id,
                name=name,
                content="",
                parent_id=None,
                created_by=agent_name,
            )

        mapping = self._node_sync.bind_node(
            node_id=node.id,
            source_id=source.id,
            external_resource_id=entry.rel_path,
        )

        await self._pull_agent_change(source, mapping, workspace_path)
        log_info(
            f"[FolderAccess] Agent created: {entry.rel_path} → node {node.id}"
        )

    # ============================================================
    # Helpers
    # ============================================================

    def _get_exportable_nodes(self, project_id: str, node_ids: Optional[list[str]]):
        """获取可导出的节点列表。"""
        from src.content_node.repository import ContentNodeRepository
        from src.supabase.client import SupabaseClient

        repo = ContentNodeRepository(SupabaseClient())

        if node_ids:
            nodes = []
            for nid in node_ids:
                node = repo.get_by_id(nid)
                if node and node.project_id == project_id:
                    nodes.append(node)
            return nodes

        all_nodes = repo.list_by_project(project_id)
        return [n for n in all_nodes if n.type in ("json", "markdown")]

    @staticmethod
    def _node_to_rel_path(node) -> str:
        """节点 → 文件系统相对路径。"""
        name = node.name or node.id
        if node.type == "json" or (node.preview_json is not None):
            return f"{name}.json" if not name.endswith(".json") else name
        return f"{name}.md" if not name.endswith(".md") else name

    @staticmethod
    def _extract_content(node) -> tuple[Any, str]:
        """从节点提取可写入的内容和类型。"""
        if node.preview_json is not None:
            return node.preview_json, "json"
        if node.preview_md is not None:
            return node.preview_md, "markdown"
        return None, "binary"

    # ============================================================
    # Lifecycle
    # ============================================================

    async def start(self) -> None:
        """应用启动时恢复所有 active 的 folder access。"""
        self._loop = asyncio.get_event_loop()
        FolderAccessService._instance = self
        sources = self._sources.list_active("folder_access")
        started = 0

        for source in sources:
            workspace_path = source.config.get("path", "")
            if not workspace_path:
                continue

            snapshot = scan_directory(workspace_path)
            self._snapshots[source.id] = snapshot
            self._start_watcher(source.id, workspace_path, IgnoreRules())
            started += 1

        if started:
            log_info(f"[FolderAccess] Restored {started} workspace accesses")

    async def stop(self) -> None:
        """应用关闭时停止所有 watcher。"""
        for source_id in list(self._watchers.keys()):
            self._stop_watcher(source_id)
        self._snapshots.clear()
        FolderAccessService._instance = None
        log_info("[FolderAccess] All watchers stopped")

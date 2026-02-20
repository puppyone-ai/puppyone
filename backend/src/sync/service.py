"""
L2.5 Sync — SyncService (bidirectional sync orchestrator)

Responsibilities:
  - add_source / remove_source:  Manage data source lifecycle
  - bootstrap:                   First-connect scan → bind nodes to source
  - pull_source / pull_all:      External → PuppyOne (via L2.commit)
  - push_node:                   PuppyOne → external (after L2.commit)

All writes go through L2. L2.5 is a background conveyor belt, not a write gate.
"""

import json
from typing import Optional, List, Any, TYPE_CHECKING

from src.sync.adapter import SyncAdapter
from src.sync.repository import SyncSourceRepository, NodeSyncRepository
from src.sync.schemas import SyncSource, SyncMapping, PullResult
from src.utils.logger import log_info, log_error, log_debug

if TYPE_CHECKING:
    from src.collaboration.service import CollaborationService


class SyncService:
    """L2.5 bidirectional sync orchestrator."""

    def __init__(
        self,
        collab_service: Optional["CollaborationService"],
        source_repo: SyncSourceRepository,
        node_sync_repo: NodeSyncRepository,
    ):
        self.collab = collab_service
        self.sources = source_repo
        self.node_sync = node_sync_repo
        self._adapters: dict[str, SyncAdapter] = {}

    def register_adapter(self, adapter: SyncAdapter) -> None:
        self._adapters[adapter.adapter_type] = adapter

    def _get_adapter(self, adapter_type: str) -> Optional[SyncAdapter]:
        return self._adapters.get(adapter_type)

    # ============================================================
    # Source lifecycle
    # ============================================================

    def add_source(
        self,
        project_id: str,
        adapter_type: str,
        config: dict,
        trigger_config: Optional[dict] = None,
        sync_mode: str = "bidirectional",
        conflict_strategy: str = "three_way_merge",
        credentials_ref: Optional[str] = None,
    ) -> SyncSource:
        source = self.sources.create(
            project_id=project_id,
            adapter_type=adapter_type,
            config=config,
            trigger_config=trigger_config,
            sync_mode=sync_mode,
            conflict_strategy=conflict_strategy,
            credentials_ref=credentials_ref,
        )
        log_info(f"[L2.5] Added source #{source.id}: {adapter_type} for project {project_id}")
        return source

    def remove_source(self, source_id: int) -> None:
        self.node_sync.unbind_by_source(source_id)
        self.sources.delete(source_id)
        log_info(f"[L2.5] Removed source #{source_id}")

    def pause_source(self, source_id: int) -> None:
        self.sources.update_status(source_id, "paused")

    def resume_source(self, source_id: int) -> None:
        self.sources.update_status(source_id, "active")

    # ============================================================
    # Bootstrap: first-connect scan → bind nodes
    # ============================================================

    async def bootstrap(
        self, source_id: int, target_folder_node_id: Optional[str] = None,
    ) -> List[SyncMapping]:
        """
        First connect: scan external source, create nodes in PuppyOne,
        and bind them via sync fields on content_nodes.
        """
        source = self.sources.get_by_id(source_id)
        if not source:
            raise ValueError(f"Source #{source_id} not found")

        adapter = self._get_adapter(source.adapter_type)
        if not adapter:
            raise ValueError(f"No adapter for type: {source.adapter_type}")

        resources = await adapter.list_resources(source)
        created_bindings: List[SyncMapping] = []

        for res in resources:
            existing = self.node_sync.find_by_resource(source_id, res.external_resource_id)
            if existing:
                continue

            node_id = await self._ensure_node_exists(
                source=source,
                resource=res,
                folder_node_id=target_folder_node_id,
            )

            mapping = self.node_sync.bind_node(
                node_id=node_id,
                source_id=source_id,
                external_resource_id=res.external_resource_id,
            )
            created_bindings.append(mapping)
            log_info(f"[L2.5] Bound {res.external_resource_id} → node {node_id}")

        log_info(f"[L2.5] Bootstrap complete: {len(created_bindings)} nodes bound")
        return created_bindings

    async def _ensure_node_exists(
        self, source: SyncSource, resource, folder_node_id: Optional[str],
    ) -> str:
        """Ensure a corresponding node exists in PuppyOne. Create if missing."""
        from src.content_node.repository import ContentNodeRepository
        from src.content_node.service import ContentNodeService
        from src.s3.service import S3Service
        from src.supabase.client import SupabaseClient

        supabase = SupabaseClient()
        node_repo = ContentNodeRepository(supabase)
        s3_service = S3Service()
        node_svc = ContentNodeService(repo=node_repo, s3_service=s3_service)

        name = resource.name
        if resource.node_type == "json":
            new_node = node_svc.create_json_node(
                project_id=source.project_id,
                name=name,
                content={},
                parent_id=folder_node_id,
                created_by="sync_bootstrap",
            )
        else:
            new_node = await node_svc.create_markdown_node(
                project_id=source.project_id,
                name=name,
                content="",
                parent_id=folder_node_id,
                created_by="sync_bootstrap",
            )
        return new_node.id

    # ============================================================
    # PULL: External → PuppyOne
    # ============================================================

    async def pull_source(self, source_id: int) -> List[dict]:
        """Pull changes for all nodes bound to a source."""
        if not self.collab:
            raise RuntimeError("collab_service required for PULL")

        source = self.sources.get_by_id(source_id)
        if not source or source.status != "active":
            return []
        if source.sync_mode == "push_only":
            return []

        adapter = self._get_adapter(source.adapter_type)
        if not adapter:
            return []

        mappings = self.node_sync.list_by_source(source_id)
        results = []

        for mapping in mappings:
            result = await self._pull_mapping(source, mapping, adapter)
            if result:
                results.append(result)

        return results

    async def pull_all(self, adapter_type: Optional[str] = None) -> List[dict]:
        """Pull changes for all active sources."""
        sources = self.sources.list_active(adapter_type)
        results = []
        for source in sources:
            results.extend(await self.pull_source(source.id))
        if results:
            log_info(f"[L2.5] pull_all: {len(results)} nodes synced")
        return results

    async def _pull_mapping(
        self, source: SyncSource, mapping: SyncMapping, adapter: SyncAdapter,
    ) -> Optional[dict]:
        """Pull changes for a single node binding."""
        try:
            pull_result = await adapter.pull(source, mapping)
            if not pull_result:
                return None

            base_content = self._get_base_content(mapping)

            commit_result = self.collab.commit(
                node_id=mapping.node_id,
                new_content=pull_result.content,
                base_version=mapping.last_sync_version,
                node_type=pull_result.node_type,
                base_content=base_content,
                operator_type="sync",
                operator_id=f"{source.adapter_type}:{mapping.external_resource_id}",
                summary=pull_result.summary or f"Sync from {source.adapter_type}",
            )

            self.node_sync.update_sync_point(
                node_id=mapping.node_id,
                last_sync_version=commit_result.version,
                remote_hash=pull_result.remote_hash,
            )

            log_info(
                f"[L2.5] PULL {source.adapter_type}:{mapping.external_resource_id} → "
                f"node {mapping.node_id} v{commit_result.version} ({commit_result.status})"
            )

            return {
                "source_id": source.id,
                "node_id": mapping.node_id,
                "version": commit_result.version,
                "status": commit_result.status,
            }

        except Exception as e:
            log_error(f"[L2.5] PULL failed for node {mapping.node_id}: {e}")
            self.node_sync.update_error(mapping.node_id, str(e))
            return None

    # ============================================================
    # PUSH: PuppyOne → External
    # ============================================================

    async def push_node(
        self,
        node_id: str,
        version: int,
        content: Any,
        node_type: str,
    ) -> List[dict]:
        """
        Called after L2.commit() succeeds.
        Push changes to the external system bound to this node.
        """
        mapping = self.node_sync.get_by_node(node_id)
        if not mapping:
            return []

        if mapping.last_sync_version >= version:
            return []

        source = self.sources.get_by_id(mapping.source_id)
        if not source or source.status != "active" or source.sync_mode == "pull_only":
            return []

        adapter = self._get_adapter(source.adapter_type)
        if not adapter:
            return []

        try:
            push_result = await adapter.push(source, mapping, content, node_type)

            if push_result.success:
                self.node_sync.update_sync_point(
                    node_id=mapping.node_id,
                    last_sync_version=version,
                    remote_hash=push_result.remote_hash,
                )
                log_info(
                    f"[L2.5] PUSH node {node_id} v{version} → "
                    f"{source.adapter_type}:{mapping.external_resource_id}"
                )
                return [{
                    "node_id": mapping.node_id,
                    "adapter": source.adapter_type,
                    "success": True,
                }]
            else:
                self.node_sync.update_error(mapping.node_id, push_result.error or "push failed")
                return []

        except Exception as e:
            log_error(f"[L2.5] PUSH failed for node {node_id}: {e}")
            self.node_sync.update_error(mapping.node_id, str(e))
            return []

    # ============================================================
    # Internal helpers
    # ============================================================

    def _get_base_content(self, mapping: SyncMapping) -> Optional[str]:
        """Get base content for three-way merge (content at last sync version)."""
        if mapping.last_sync_version <= 0 or not self.collab:
            return None
        try:
            ver = self.collab.get_version_content(mapping.node_id, mapping.last_sync_version)
            if ver.content_text:
                return ver.content_text
            if ver.content_json is not None:
                return json.dumps(ver.content_json, ensure_ascii=False, indent=2)
        except Exception:
            log_debug(f"[L2.5] Could not load base content for v{mapping.last_sync_version}")
        return None

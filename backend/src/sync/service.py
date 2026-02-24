"""
L2.5 Sync — SyncService (bidirectional sync orchestrator)

Responsibilities:
  - bootstrap:       First-connect scan → create Sync rows
  - pull_sync:       External → PuppyOne (via L2.commit)
  - pull_all:        Pull all active syncs
  - push_node:       PuppyOne → external (after L2.commit)

All writes go through L2. L2.5 is a background conveyor belt, not a write gate.
"""

import json
from typing import Optional, List, Any, TYPE_CHECKING

from src.sync.adapter import SyncAdapter
from src.sync.repository import SyncRepository
from src.sync.schemas import Sync, PullResult
from src.utils.logger import log_info, log_error, log_debug

if TYPE_CHECKING:
    from src.collaboration.service import CollaborationService


class SyncService:
    """L2.5 bidirectional sync orchestrator."""

    def __init__(
        self,
        collab_service: Optional["CollaborationService"],
        sync_repo: SyncRepository,
    ):
        self.collab = collab_service
        self.sync_repo = sync_repo
        self._adapters: dict[str, SyncAdapter] = {}

    def register_adapter(self, adapter: SyncAdapter) -> None:
        self._adapters[adapter.adapter_type] = adapter

    def _get_adapter(self, adapter_type: str) -> Optional[SyncAdapter]:
        return self._adapters.get(adapter_type)

    # ============================================================
    # Sync lifecycle
    # ============================================================

    def remove_sync(self, sync_id: str) -> None:
        self.sync_repo.delete(sync_id)
        log_info(f"[L2.5] Removed sync #{sync_id}")

    def pause_sync(self, sync_id: str) -> None:
        self.sync_repo.update_status(sync_id, "paused")

    def resume_sync(self, sync_id: str) -> None:
        self.sync_repo.update_status(sync_id, "active")

    # ============================================================
    # Bootstrap: first-connect scan → create Sync rows
    # ============================================================

    async def bootstrap(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_node_id: Optional[str] = None,
        credentials_ref: Optional[str] = None,
        direction: str = "bidirectional",
        conflict_strategy: str = "three_way_merge",
    ) -> List[Sync]:
        """
        First connect: scan external source, create nodes in PuppyOne,
        and create Sync rows for each binding.
        """
        adapter = self._get_adapter(provider)
        if not adapter:
            raise ValueError(f"No adapter for type: {provider}")

        temp_sync = Sync(
            id="",
            project_id=project_id,
            node_id="",
            direction=direction,
            provider=provider,
            config=config,
            credentials_ref=credentials_ref,
        )

        resources = await adapter.list_resources(temp_sync)
        created_syncs: List[Sync] = []

        for res in resources:
            existing = self.sync_repo.find_by_config_key(
                provider, "external_resource_id", res.external_resource_id,
            )
            if existing:
                continue

            node_id = await self._ensure_node_exists(
                project_id=project_id,
                resource=res,
                folder_node_id=target_folder_node_id,
            )

            sync = self.sync_repo.create(
                project_id=project_id,
                node_id=node_id,
                direction=direction,
                provider=provider,
                config={
                    **config,
                    "external_resource_id": res.external_resource_id,
                },
                credentials_ref=credentials_ref,
                conflict_strategy=conflict_strategy,
            )
            created_syncs.append(sync)
            log_info(f"[L2.5] Bound {res.external_resource_id} → node {node_id}")

        log_info(f"[L2.5] Bootstrap complete: {len(created_syncs)} syncs created")
        return created_syncs

    async def _ensure_node_exists(
        self, project_id: str, resource, folder_node_id: Optional[str],
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
                project_id=project_id,
                name=name,
                content={},
                parent_id=folder_node_id,
                created_by="sync_bootstrap",
            )
        else:
            new_node = await node_svc.create_markdown_node(
                project_id=project_id,
                name=name,
                content="",
                parent_id=folder_node_id,
                created_by="sync_bootstrap",
            )
        return new_node.id

    # ============================================================
    # PULL: External → PuppyOne
    # ============================================================

    async def pull_sync(self, sync_id: str) -> Optional[dict]:
        """Pull changes for a single sync."""
        if not self.collab:
            raise RuntimeError("collab_service required for PULL")

        sync = self.sync_repo.get_by_id(sync_id)
        if not sync or sync.status != "active":
            return None
        if sync.direction == "outbound":
            return None

        adapter = self._get_adapter(sync.provider)
        if not adapter:
            return None

        return await self._pull_one(sync, adapter)

    async def pull_all(self, provider: Optional[str] = None) -> List[dict]:
        """Pull changes for all active syncs."""
        if not self.collab:
            raise RuntimeError("collab_service required for PULL")

        syncs = self.sync_repo.list_active(provider)
        results = []
        for sync in syncs:
            if sync.direction == "outbound":
                continue
            adapter = self._get_adapter(sync.provider)
            if not adapter:
                continue
            result = await self._pull_one(sync, adapter)
            if result:
                results.append(result)

        if results:
            log_info(f"[L2.5] pull_all: {len(results)} nodes synced")
        return results

    async def _pull_one(
        self, sync: Sync, adapter: SyncAdapter,
    ) -> Optional[dict]:
        """Pull changes for a single sync binding."""
        try:
            pull_result = await adapter.pull(sync)
            if not pull_result:
                return None

            base_content = self._get_base_content(sync)

            external_resource_id = sync.config.get("external_resource_id", "")
            commit_result = self.collab.commit(
                node_id=sync.node_id,
                new_content=pull_result.content,
                base_version=sync.last_sync_version,
                node_type=pull_result.node_type,
                base_content=base_content,
                operator_type="sync",
                operator_id=f"{sync.provider}:{external_resource_id}",
                summary=pull_result.summary or f"Sync from {sync.provider}",
            )

            self.sync_repo.update_sync_point(
                sync_id=sync.id,
                last_sync_version=commit_result.version,
                remote_hash=pull_result.remote_hash,
            )

            log_info(
                f"[L2.5] PULL {sync.provider}:{external_resource_id} → "
                f"node {sync.node_id} v{commit_result.version} ({commit_result.status})"
            )

            return {
                "sync_id": sync.id,
                "node_id": sync.node_id,
                "version": commit_result.version,
                "status": commit_result.status,
            }

        except Exception as e:
            log_error(f"[L2.5] PULL failed for node {sync.node_id}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
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
        sync = self.sync_repo.get_by_node(node_id)
        if not sync:
            return []

        if sync.last_sync_version >= version:
            return []

        if sync.status != "active" or sync.direction == "inbound":
            return []

        adapter = self._get_adapter(sync.provider)
        if not adapter:
            return []

        try:
            push_result = await adapter.push(sync, content, node_type)

            if push_result.success:
                self.sync_repo.update_sync_point(
                    sync_id=sync.id,
                    last_sync_version=version,
                    remote_hash=push_result.remote_hash,
                )
                external_resource_id = sync.config.get("external_resource_id", "")
                log_info(
                    f"[L2.5] PUSH node {node_id} v{version} → "
                    f"{sync.provider}:{external_resource_id}"
                )
                return [{
                    "node_id": sync.node_id,
                    "adapter": sync.provider,
                    "success": True,
                }]
            else:
                self.sync_repo.update_error(sync.id, push_result.error or "push failed")
                return []

        except Exception as e:
            log_error(f"[L2.5] PUSH failed for node {node_id}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
            return []

    # ============================================================
    # Internal helpers
    # ============================================================

    def _get_base_content(self, sync: Sync) -> Optional[str]:
        """Get base content for three-way merge (content at last sync version)."""
        if sync.last_sync_version <= 0 or not self.collab:
            return None
        try:
            ver = self.collab.get_version_content(sync.node_id, sync.last_sync_version)
            if ver.content_text:
                return ver.content_text
            if ver.content_json is not None:
                return json.dumps(ver.content_json, ensure_ascii=False, indent=2)
        except Exception:
            log_debug(f"[L2.5] Could not load base content for v{sync.last_sync_version}")
        return None

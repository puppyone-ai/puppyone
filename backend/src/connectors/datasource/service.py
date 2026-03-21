"""
L2.5 Sync — SyncService (bidirectional sync orchestrator)

Responsibilities:
  - bootstrap:       First-connect scan → create Sync rows
  - pull_sync:       External → PuppyOne (via MUT protocol)
  - pull_all:        Pull all active syncs
  - push_node:       PuppyOne → external (after write completes)

All writes go through MutOps (clone → push under the hood).
"""

import json
from typing import Optional, List, Any, TYPE_CHECKING

from src.connectors.datasource._base import BaseConnector
from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.schemas import Sync, PullResult, ResourceInfo
from src.utils.logger import log_info, log_error, log_debug


class SyncService:
    """L2.5 bidirectional sync orchestrator."""

    def __init__(
        self,
        sync_repo: SyncRepository,
    ):
        self.sync_repo = sync_repo
        self._connectors: dict[str, BaseConnector] = {}

    def register_connector(self, connector: BaseConnector) -> None:
        self._connectors[connector.spec().provider] = connector

    def _get_connector(self, provider: str) -> Optional[BaseConnector]:
        return self._connectors.get(provider)

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
        target_folder_path: Optional[str] = None,
        credentials_ref: Optional[str] = None,
        direction: str = "bidirectional",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "import_once",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> List[Sync]:
        """
        First connect: scan external source, create files in PuppyOne,
        and create Sync rows for each binding.

        sync_mode: 'import_once' | 'manual' | 'scheduled'
        trigger: optional trigger config, e.g. {"type": "scheduled", "schedule": "0 9 * * *", "timezone": "Asia/Shanghai"}
        """
        connector = self._get_connector(provider)
        if not connector:
            raise ValueError(f"No connector for provider: {provider}")
        if connector.spec().creation_mode != "bootstrap":
            raise ValueError(
                f"Connector {provider} must use direct sync creation, not bootstrap"
            )

        trigger_data = trigger or {}
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        temp_sync = Sync(
            id="",
            project_id=project_id,
            path="",
            direction=direction,
            provider=provider,
            config=config,
            credentials_ref=credentials_ref,
        )

        resources = await connector.list_resources(temp_sync)
        created_syncs: List[Sync] = []

        for res in resources:
            existing = self.sync_repo.find_by_config_key(
                provider, "external_resource_id", res.external_resource_id,
            )
            if existing:
                continue

            file_path = await self._ensure_node_exists(
                project_id=project_id,
                resource=res,
                folder_path=target_folder_path,
                user_id=user_id,
            )

            sync_config = {
                **config,
                "external_resource_id": res.external_resource_id,
            }
            if user_id:
                sync_config["user_id"] = user_id

            sync = self.sync_repo.create(
                project_id=project_id,
                path=file_path,
                direction=direction,
                provider=provider,
                config=sync_config,
                credentials_ref=credentials_ref,
                conflict_strategy=conflict_strategy,
                trigger=trigger_data,
            )
            created_syncs.append(sync)
            log_info(f"[L2.5] Bound {res.external_resource_id} → {file_path} (mode={sync_mode})")

        log_info(f"[L2.5] Bootstrap complete: {len(created_syncs)} syncs created (mode={sync_mode})")
        return created_syncs

    async def create_sync(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_path: str,
        *,
        credentials_ref: Optional[str] = None,
        direction: str = "inbound",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "import_once",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> Sync:
        """
        Create exactly one sync binding for connectors that fetch a single
        aggregated resource into one PuppyOne file.
        """
        connector = self._get_connector(provider)
        if not connector:
            raise ValueError(f"No connector for provider: {provider}")

        spec = connector.spec()
        if spec.creation_mode != "direct":
            raise ValueError(
                f"Connector {provider} does not support direct sync creation"
            )

        if not target_folder_path:
            raise ValueError("target_folder_path is required")

        trigger_data = trigger or {}
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        placeholder = ResourceInfo(
            external_resource_id=f"direct:{provider}",
            name=config.get("name") or spec.display_name,
            node_type=spec.default_node_type,
        )
        file_path = await self._ensure_node_exists(
            project_id=project_id,
            resource=placeholder,
            folder_path=target_folder_path,
            user_id=user_id,
        )

        sync_config = {
            **config,
            "external_resource_id": f"direct:{provider}:{file_path}",
        }
        if user_id:
            sync_config["user_id"] = user_id

        sync = self.sync_repo.create(
            project_id=project_id,
            path=file_path,
            direction=direction,
            provider=provider,
            config=sync_config,
            credentials_ref=credentials_ref,
            conflict_strategy=conflict_strategy,
            trigger=trigger_data,
        )
        log_info(
            f"[L2.5] Direct sync created: {provider} → {file_path} "
            f"(mode={sync_mode})"
        )
        return sync

    async def _ensure_node_exists(
        self, project_id: str, resource: ResourceInfo, folder_path: Optional[str],
        user_id: Optional[str] = None,
    ) -> str:
        """Ensure a corresponding file exists in the Mut tree. Create if missing.

        Returns the mut path of the file (stored in sync.path).
        """
        base_folder = folder_path or ""
        name = resource.name
        node_type = resource.node_type if resource.node_type in ("json", "markdown") else "markdown"
        ext = ".json" if node_type == "json" else ".md" if node_type == "markdown" else ""
        file_path = f"{base_folder}/{name}{ext}" if base_folder else f"{name}{ext}"

        initial_content = b"{}" if node_type == "json" else b""
        operator = f"sync:{user_id}" if user_id else "sync"

        from src.mut_engine.dependencies import create_mut_ops
        ops = create_mut_ops()
        await ops.write_file(
            project_id, file_path, initial_content,
            who=operator, message=f"Create sync target: {name}",
        )
        return file_path

    # ============================================================
    # PULL: External → PuppyOne
    # ============================================================

    async def pull_sync(self, sync_id: str) -> Optional[dict]:
        """Pull changes for a single sync."""
        sync = self.sync_repo.get_by_id(sync_id)
        if not sync or sync.status != "active":
            return None
        if sync.direction == "outbound":
            return None

        connector = self._get_connector(sync.provider)
        if not connector:
            return None

        return await self._pull_one(sync, connector)

    async def pull_all(self, provider: Optional[str] = None) -> List[dict]:
        """Pull changes for all active syncs."""
        syncs = self.sync_repo.list_active(provider)
        results = []
        for sync in syncs:
            if sync.direction == "outbound":
                continue
            connector = self._get_connector(sync.provider)
            if not connector:
                continue
            result = await self._pull_one(sync, connector)
            if result:
                results.append(result)

        if results:
            log_info(f"[L2.5] pull_all: {len(results)} files synced")
        return results

    async def _pull_one(
        self, sync: Sync, connector: BaseConnector,
    ) -> Optional[dict]:
        """Pull changes for a single sync binding."""
        try:
            pull_result = await connector.pull(sync)
            if not pull_result:
                return None

            external_resource_id = sync.config.get("external_resource_id", "")
            file_path = sync.path

            content = pull_result.content
            if isinstance(content, dict) or isinstance(content, list):
                content_bytes = json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
            elif isinstance(content, str):
                content_bytes = content.encode("utf-8")
            elif isinstance(content, bytes):
                content_bytes = content
            else:
                content_bytes = str(content).encode("utf-8")

            operator = f"sync:{sync.provider}:{external_resource_id}"

            from src.mut_engine.dependencies import create_mut_ops
            ops = create_mut_ops()
            write_result = await ops.write_file(
                sync.project_id, file_path, content_bytes,
                who=operator,
                message=pull_result.summary or f"Sync from {sync.provider}",
            )

            new_version = write_result.version
            self.sync_repo.update_sync_point(
                sync_id=sync.id,
                last_sync_version=new_version,
                remote_hash=pull_result.remote_hash,
            )

            log_info(
                f"[L2.5] PULL {sync.provider}:{external_resource_id} → "
                f"{file_path} v{new_version}"
            )

            return {
                "sync_id": sync.id,
                "path": file_path,
                "version": new_version,
            }

        except Exception as e:
            log_error(f"[L2.5] PULL failed for {sync.path}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
            return None

    # ============================================================
    # PUSH: PuppyOne → External
    # ============================================================

    async def push_node(
        self,
        path: str,
        version: int,
        content: Any,
        node_type: str,
    ) -> List[dict]:
        """
        Called after a write completes.
        Push changes to the external system bound to this path.
        """
        sync = self.sync_repo.get_by_node(path)
        if not sync:
            return []

        if sync.last_sync_version >= version:
            return []

        if sync.status != "active" or sync.direction == "inbound":
            return []

        connector = self._get_connector(sync.provider)
        if not connector:
            return []

        try:
            push_result = await connector.push(sync, content, node_type)

            if push_result.success:
                self.sync_repo.update_sync_point(
                    sync_id=sync.id,
                    last_sync_version=version,
                    remote_hash=push_result.remote_hash,
                )
                external_resource_id = sync.config.get("external_resource_id", "")
                log_info(
                    f"[L2.5] PUSH {path} v{version} → "
                    f"{sync.provider}:{external_resource_id}"
                )
                return [{
                    "path": sync.path,
                    "provider": sync.provider,
                    "success": True,
                }]
            else:
                self.sync_repo.update_error(sync.id, push_result.error or "push failed")
                return []

        except Exception as e:
            log_error(f"[L2.5] PUSH failed for {path}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
            return []

    # ============================================================
    # Internal helpers
    # ============================================================

    async def _get_base_content(self, sync: Sync) -> Optional[str]:
        """Get base content for three-way merge (content at last sync version)."""
        if sync.last_sync_version <= 0:
            return None
        try:
            from src.mut_engine.dependencies import create_mut_write_service
            admin = create_mut_write_service()
            content_bytes = await admin.get_version_content(
                sync.project_id, sync.path, sync.last_sync_version,
            )
            return content_bytes.decode("utf-8", errors="replace")
        except Exception:
            log_debug(f"[L2.5] Could not load base content for v{sync.last_sync_version}")
        return None

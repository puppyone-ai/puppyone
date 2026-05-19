"""
L2.5 Sync — SyncService (bidirectional sync orchestrator)

Responsibilities:
  - bootstrap:       First-connect scan → create Sync rows
  - pull_sync:       External → PuppyOne through ProductOperationAdapter
  - pull_all:        Pull all active syncs
  - push_node:       PuppyOne → external (after write completes)

All typed writes go through ProductOperationAdapter and the Version Engine
transaction boundary.
"""

from typing import Optional, List, Any

from src.connectors.datasource._base import BaseConnector
from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.schemas import Sync, ResourceInfo
from src.utils.logger import log_info, log_error


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

            conn_folder, data_file = await self._ensure_folder_exists(
                project_id=project_id,
                resource=res,
                folder_path=target_folder_path,
                user_id=user_id,
            )

            sync_config = {
                **config,
                "external_resource_id": res.external_resource_id,
                "data_file": data_file,
            }
            if user_id:
                sync_config["user_id"] = user_id

            sync = self.sync_repo.create(
                project_id=project_id,
                path=conn_folder,
                direction=direction,
                provider=provider,
                config=sync_config,
                credentials_ref=credentials_ref,
                conflict_strategy=conflict_strategy,
                trigger=trigger_data,
            )
            created_syncs.append(sync)
            log_info(f"[L2.5] Bound {res.external_resource_id} → {conn_folder}/ (mode={sync_mode})")

        log_info(f"[L2.5] Bootstrap complete: {len(created_syncs)} syncs created (mode={sync_mode})")
        return created_syncs

    async def create_sync(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_path: Optional[str] = None,
        *,
        credentials_ref: Optional[str] = None,
        direction: str = "inbound",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "import_once",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> Sync:
        """
        Create exactly one sync binding for direct connectors. The connector
        may later write either one aggregate file or a multi-file import under
        the created mount point.
        """
        connector = self._get_connector(provider)
        if not connector:
            raise ValueError(f"No connector for provider: {provider}")

        spec = connector.spec()
        if spec.creation_mode != "direct":
            raise ValueError(
                f"Connector {provider} does not support direct sync creation"
            )

        trigger_data = trigger or {}
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        placeholder = ResourceInfo(
            external_resource_id=f"direct:{provider}",
            name=config.get("name") or spec.display_name,
            node_type=spec.default_node_type,
        )
        conn_folder, data_file = await self._ensure_folder_exists(
            project_id=project_id,
            resource=placeholder,
            folder_path=target_folder_path,
            user_id=user_id,
        )

        sync_config = {
            **config,
            "external_resource_id": f"direct:{provider}:{conn_folder}",
            "data_file": data_file,
        }
        if user_id:
            sync_config["user_id"] = user_id

        sync = self.sync_repo.create(
            project_id=project_id,
            path=conn_folder,
            direction=direction,
            provider=provider,
            config=sync_config,
            credentials_ref=credentials_ref,
            conflict_strategy=conflict_strategy,
            trigger=trigger_data,
        )
        log_info(
            f"[L2.5] Direct sync created: {provider} → {conn_folder}/ "
            f"(mode={sync_mode})"
        )
        return sync

    async def _ensure_folder_exists(
        self, project_id: str, resource: ResourceInfo, folder_path: Optional[str],
        user_id: Optional[str] = None,
    ) -> tuple[str, str]:
        """Create a connection folder with an empty data file in the version tree.

        Returns (folder_path, data_file) where:
          - folder_path is stored in connections.path (the mount point)
          - data_file is stored in connections.config.data_file (relative name)
        """
        base_folder = folder_path or ""
        name = resource.name
        node_type = resource.node_type if resource.node_type in ("json", "markdown") else "markdown"
        ext = ".json" if node_type == "json" else ".md"
        data_file = f"data{ext}"

        conn_folder = f"{base_folder}/{name}" if base_folder else name
        operator = f"sync:{user_id}" if user_id else "sync"

        from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container
        commands = build_worker_version_engine_container().write_commands()

        initial_content = b"{}" if node_type == "json" else b""
        await commands.write_bytes(
            project_id, f"{conn_folder}/{data_file}", initial_content,
            actor=operator, message=f"Create sync target: {name}",
        )
        return conn_folder, data_file

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
        self, sync: Sync, _connector: BaseConnector,
    ) -> Optional[dict]:
        """Pull changes for a single sync binding.

        Delegates to SyncEngine.execute() which handles the full cycle:
        credential resolution → connector.fetch() → hash compare → ProductOperationAdapter.write()
        """
        try:
            from src.connectors.datasource.dependencies import create_sync_engine
            engine = create_sync_engine()
            result = await engine.execute(sync.id)
            if not result:
                return None

            log_info(f"[L2.5] PULL {sync.provider} → {sync.path}")
            return result

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
        commit_id: str,
        content: Any,
        node_type: str,
    ) -> List[dict]:
        """
        Called after a write completes.
        Push changes to the external system bound to this path.
        Idempotency is by ``commit_id`` equality — we skip only if
        the same commit was already pushed.
        """
        sync = self.sync_repo.find_owner_by_path(path)
        if not sync:
            return []

        if commit_id and sync.last_sync_commit_id == commit_id:
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
                    last_sync_commit_id=commit_id,
                    remote_hash=push_result.remote_hash,
                )
                external_resource_id = sync.config.get("external_resource_id", "")
                log_info(
                    f"[L2.5] PUSH {path} commit={commit_id} → "
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

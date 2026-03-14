"""
SyncEngine — Unified execution engine for all sync operations.

Sits at the center of the three-layer architecture:
  Trigger Layer → SyncEngine → Connector Layer + Write Layer

All sync scenarios (bootstrap, manual refresh, scheduled, webhook)
converge into a single execute() call. The engine:

  1. Loads the sync record
  2. Looks up the connector from the Registry
  3. Resolves OAuth credentials
  4. Calls connector.fetch(config, credentials) → FetchResult
  5. Compares content_hash with sync.remote_hash
  6. If changed → constructs Mutation → CollaborationService.commit()
  7. Updates the sync record (remote_hash, last_sync_version)

This ensures ALL data writes — including first import — go through
version management.
"""

from __future__ import annotations

import json
from typing import Optional, TYPE_CHECKING

from src.connectors.datasource._base import FetchResult
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.run_repository import SyncRunRepository
from src.connectors.datasource.schemas import Sync
from src.collaboration.schemas import Mutation, MutationType, Operator
from src.utils.logger import log_info, log_error, log_debug

if TYPE_CHECKING:
    from src.collaboration.service import CollaborationService


class SyncEngine:
    """
    Unified execution engine. Every sync operation — regardless of
    trigger source — goes through execute().
    """

    def __init__(
        self,
        registry: ConnectorRegistry,
        collab_service: "CollaborationService",
        sync_repo: SyncRepository,
        run_repo: Optional[SyncRunRepository] = None,
    ):
        self.registry = registry
        self.collab = collab_service
        self.sync_repo = sync_repo
        self.run_repo = run_repo

    async def execute(
        self, sync_id: str, trigger_type: str = "manual",
    ) -> Optional[dict]:
        """
        Execute a sync: fetch data → compare → write if changed.
        Records execution in sync_runs if run_repo is available.

        Returns a result dict on successful write, None if skipped
        (no changes or error).
        """
        sync = self.sync_repo.get_by_id(sync_id)
        if not sync:
            log_error(f"[SyncEngine] Sync not found: {sync_id}")
            return None

        if sync.status not in ("active", "syncing"):
            log_debug(f"[SyncEngine] Skipping sync {sync_id} (status={sync.status})")
            return None

        connector = self.registry.get(sync.provider)
        if not connector:
            log_error(f"[SyncEngine] No connector registered for provider: {sync.provider}")
            return None

        # Start a run record
        run = None
        if self.run_repo:
            try:
                run = self.run_repo.create(sync_id, trigger_type=trigger_type)
            except Exception as e:
                log_debug(f"[SyncEngine] Could not create run record: {e}")

        try:
            self.sync_repo.update_status(sync_id, "syncing")

            # Resolve credentials (user_id for OAuth comes from created_by or config)
            spec = connector.spec()
            user_id = sync.created_by or (sync.config or {}).get("user_id", "")
            credentials = await self.registry.resolve_credentials(
                oauth_type=spec.oauth_type,
                user_id=user_id,
            )

            # Fetch data from external source
            result = await connector.fetch(sync.config or {}, credentials)

            # Compare hash — skip write if unchanged
            if result.content_hash and result.content_hash == sync.remote_hash:
                self.sync_repo.update_status(sync_id, "active")
                log_debug(
                    f"[SyncEngine] No changes for {sync.provider} sync {sync_id}"
                )
                if run and self.run_repo:
                    self.run_repo.complete(
                        run.id, status="skipped",
                        result_summary="No changes detected",
                    )
                return None

            # Construct mutation and commit through CollaborationService
            base_content = self._get_base_content(sync)
            external_resource_id = (sync.config or {}).get("external_resource_id", "")

            mutation = Mutation(
                type=MutationType.CONTENT_UPDATE,
                operator=Operator(
                    type="sync",
                    id=f"{sync.provider}:{external_resource_id}",
                    summary=result.summary or f"Sync from {sync.provider}",
                ),
                node_id=sync.node_id,
                content=result.content,
                base_version=sync.last_sync_version,
                node_type=result.node_type,
                base_content=base_content,
            )

            # Update node name if connector provides one (e.g. first fetch)
            if result.node_name and sync.last_sync_version == 0:
                mutation.name = result.node_name

            commit_result = await self.collab.commit(mutation)

            # Update sync record
            self.sync_repo.update_sync_point(
                sync_id=sync.id,
                last_sync_version=commit_result.version,
                remote_hash=result.content_hash,
            )

            log_info(
                f"[SyncEngine] {sync.provider}:{external_resource_id} → "
                f"node {sync.node_id} v{commit_result.version} ({commit_result.status})"
            )

            # Complete run record
            if run and self.run_repo:
                self.run_repo.complete(
                    run.id, status="success",
                    result_summary=result.summary,
                )

            return {
                "sync_id": sync.id,
                "node_id": sync.node_id,
                "provider": sync.provider,
                "version": commit_result.version,
                "status": commit_result.status,
                "summary": result.summary,
                "run_id": run.id if run else None,
            }

        except Exception as e:
            log_error(f"[SyncEngine] Failed for sync {sync_id}: {e}")
            self.sync_repo.update_error(sync_id, str(e))
            if run and self.run_repo:
                self.run_repo.complete(
                    run.id, status="failed", error=str(e),
                )
            return None

    async def execute_all(
        self,
        provider: Optional[str] = None,
    ) -> list[dict]:
        """Execute sync for all active inbound syncs."""
        syncs = self.sync_repo.list_active(provider)
        results = []
        for sync in syncs:
            if sync.direction == "outbound":
                continue
            result = await self.execute(sync.id)
            if result:
                results.append(result)

        if results:
            log_info(f"[SyncEngine] execute_all: {len(results)} syncs updated")
        return results

    def _get_base_content(self, sync: Sync) -> Optional[str]:
        """Get base content for three-way merge."""
        if sync.last_sync_version <= 0:
            return None
        try:
            ver = self.collab.get_version_content(
                sync.node_id, sync.last_sync_version
            )
            if ver.content_text:
                return ver.content_text
            if ver.content_json is not None:
                return json.dumps(ver.content_json, ensure_ascii=False, indent=2)
        except Exception:
            log_debug(
                f"[SyncEngine] Could not load base content for v{sync.last_sync_version}"
            )
        return None

"""
SyncEngine — Unified execution engine for all sync operations.

Sits at the center of the three-layer architecture:
  Trigger Layer → SyncEngine → Connector Layer + MUT Protocol Layer

All sync scenarios (bootstrap, manual refresh, scheduled, webhook)
converge into a single execute() call. The engine:

  1. Loads the sync record
  2. Looks up the connector from the Registry
  3. Resolves OAuth credentials
  4. Calls connector.fetch(config, credentials) → FetchResult
  5. Compares content_hash with sync.remote_hash
  6. If changed → MutOps.write_file() at the sync path
  7. Updates the sync record (remote_hash, last_sync_commit_id)

All data writes go through MutOps.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.run_repository import SyncRunRepository
from src.utils.logger import log_info, log_error, log_debug


class SyncEngine:
    """
    Unified execution engine. Every sync operation — regardless of
    trigger source — goes through execute().
    """

    def __init__(
        self,
        registry: ConnectorRegistry,
        sync_repo: SyncRepository,
        run_repo: Optional[SyncRunRepository] = None,
    ):
        self.registry = registry
        self.sync_repo = sync_repo
        self.run_repo = run_repo

    async def execute(
        self, sync_id: str, trigger_type: str = "manual",
    ) -> Optional[dict]:
        """
        Execute a sync: fetch data → compare → write if changed.
        Records execution in sync_runs if run_repo is available.
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

        run = None
        if self.run_repo:
            try:
                run = self.run_repo.create(sync_id, trigger_type=trigger_type)
            except Exception as e:
                log_debug(f"[SyncEngine] Could not create run record: {e}")

        try:
            self.sync_repo.update_status(sync_id, "syncing")

            spec = connector.spec()
            user_id = sync.created_by or (sync.config or {}).get("user_id", "")
            credentials = await self.registry.resolve_credentials(
                oauth_type=spec.oauth_type,
                user_id=user_id,
            )

            result = await connector.fetch(sync.config or {}, credentials)

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

            data_file = (sync.config or {}).get("data_file")
            file_path = f"{sync.path}/{data_file}" if data_file else sync.path
            external_resource_id = (sync.config or {}).get("external_resource_id", "")

            content = result.content
            if isinstance(content, (dict, list)):
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
                message=result.summary or f"Sync from {sync.provider}",
            )

            new_commit_id = write_result.commit_id

            self.sync_repo.update_sync_point(
                sync_id=sync.id,
                last_sync_commit_id=new_commit_id,
                remote_hash=result.content_hash,
            )

            log_info(
                f"[SyncEngine] {sync.provider}:{external_resource_id} → "
                f"{file_path} commit={new_commit_id}"
            )

            if run and self.run_repo:
                self.run_repo.complete(
                    run.id, status="success",
                    result_summary=result.summary,
                )

            return {
                "access_point_id": sync.id,
                "path": file_path,
                "provider": sync.provider,
                "commit_id": new_commit_id,
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

    # ============================================================
    # NEW MODEL (post access-point-redesign): Connector-driven execute
    # ============================================================

    async def execute_for_connector(self, connector) -> Optional[str]:
        """Run a single connector once (manual trigger from connector_router).

        Bridges the new `Connector` row (post-redesign) into the existing
        execute() pipeline by mapping (project_id, scope_id, provider) to
        the still-extant Sync row that backs it during the transition.

        Returns the connector_run_id so the API can echo it back.

        TODO(redesign Q4): once the legacy `syncs` table is dropped, this
        method should be the canonical execute path — the sync_repo
        lookup below goes away and we drive directly off the Connector
        + repo_scopes.path. The Notion `.push()` end-to-end stub lands
        in a follow-up PR (separate `connectors/datasource/notion/` module).
        """
        from src.repo.scope_repository import RepoScopeRepository

        # Built-in cli/agent connectors don't have a third-party "fetch" step
        # — they're conduits for the user's own writes. Refusing here matches
        # the API contract in connector_router.run_connector.
        if connector.provider in ("cli", "agent"):
            log_debug(f"[SyncEngine] cli/agent connectors don't run on demand: {connector.id}")
            return None

        # Resolve the scope so we know where in the tree this connector writes.
        scope = RepoScopeRepository().get(connector.scope_id)
        if scope is None:
            log_error(f"[SyncEngine] connector {connector.id} references missing scope {connector.scope_id}")
            return None

        # Transition-window bridge: find the legacy Sync row this connector
        # was migrated from. Once that path is dropped, replace this with
        # a direct dispatch on connector.provider.
        sync = self.sync_repo.get_by_path(scope.path)
        if sync is None or sync.project_id != connector.project_id:
            log_error(
                f"[SyncEngine] no legacy sync row found for connector "
                f"{connector.id} (project={connector.project_id} path={scope.path}). "
                f"This is expected once the legacy syncs table is dropped — "
                f"replace with direct connector dispatch then."
            )
            return None

        result = await self.execute(sync.id, trigger_type="manual")
        return (result or {}).get("run_id")

    # ============================================================
    # PUSH: PuppyOne → External
    # ============================================================

    async def push_execute(
        self,
        path: str,
        commit_id: str,
        content: Any,
        node_type: str,
    ) -> Optional[dict]:
        """
        Push content from PuppyOne to the external system bound to this path.
        Called after a successful write for bidirectional/outbound syncs.

        ``commit_id`` is the MUT commit just produced by the write; we
        skip only if it matches what we already synced (avoids pushing
        the same commit twice). Unlike the old integer counter we can
        no longer order two unrelated commits, so we use equality as
        the idempotency check and trust the write funnel to serialize.
        """
        sync = self.sync_repo.find_owner_by_path(path)
        if not sync:
            return None

        if sync.direction == "inbound":
            return None

        if sync.status != "active":
            log_debug(f"[SyncEngine] push skipped: sync {sync.id} status={sync.status}")
            return None

        if commit_id and sync.last_sync_commit_id == commit_id:
            return None

        connector = self.registry.get(sync.provider)
        if not connector:
            log_error(f"[SyncEngine] push: no connector for provider {sync.provider}")
            return None

        from src.connectors.datasource._base import Capability
        spec = connector.spec()
        if not (spec.capabilities & Capability.PUSH):
            log_debug(f"[SyncEngine] push skipped: {sync.provider} has no PUSH capability")
            return None

        run = None
        if self.run_repo:
            try:
                run = self.run_repo.create(sync.id, trigger_type="push")
            except Exception as e:
                log_debug(f"[SyncEngine] Could not create push run record: {e}")

        try:
            push_result = await connector.push(sync, content, node_type)

            if push_result.success:
                self.sync_repo.update_sync_point(
                    sync_id=sync.id,
                    last_sync_commit_id=commit_id,
                    remote_hash=push_result.remote_hash,
                )
                external_resource_id = (sync.config or {}).get("external_resource_id", "")
                log_info(
                    f"[SyncEngine] PUSH {path} commit={commit_id} → "
                    f"{sync.provider}:{external_resource_id}"
                )

                if run and self.run_repo:
                    self.run_repo.complete(
                        run.id, status="success",
                        result_summary=f"Pushed commit {commit_id}",
                    )

                return {
                    "access_point_id": sync.id,
                    "path": path,
                    "provider": sync.provider,
                    "commit_id": commit_id,
                    "direction": "push",
                    "status": "success",
                    "run_id": run.id if run else None,
                }
            else:
                error = push_result.error or "Push returned failure"
                log_error(f"[SyncEngine] push failed for {sync.id}: {error}")
                self.sync_repo.update_error(sync.id, error)
                if run and self.run_repo:
                    self.run_repo.complete(run.id, status="failed", error=error)
                return None

        except NotImplementedError:
            log_debug(f"[SyncEngine] push not implemented for {sync.provider}")
            if run and self.run_repo:
                self.run_repo.complete(run.id, status="skipped", result_summary="Push not implemented")
            return None
        except Exception as e:
            log_error(f"[SyncEngine] push error for sync {sync.id}: {e}")
            self.sync_repo.update_error(sync.id, str(e))
            if run and self.run_repo:
                self.run_repo.complete(run.id, status="failed", error=str(e))
            return None

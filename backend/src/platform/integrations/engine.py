"""Integration execution engine.

This is the durable Integration runtime: trigger -> connector fetch/push ->
project-root Version Engine write -> connection state update.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.datasource._base import AuthRequirement, Capability
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.run_repository import SyncRunRepository
from src.platform.integrations.paths import plan_fetch_result, plan_materialized_result
from src.platform.integrations.repository import IntegrationRepository
from src.utils.logger import log_debug, log_error, log_info


class IntegrationEngine:
    def __init__(
        self,
        registry: ConnectorRegistry,
        repository: IntegrationRepository,
        run_repo: Optional[SyncRunRepository] = None,
    ):
        self.registry = registry
        self.repository = repository
        self.run_repo = run_repo

    def _target_exists_as_file(self, project_id: str, target_path: str | None) -> bool:
        if not target_path:
            return False
        try:
            from src.version_engine.bootstrap.dependencies import (
                build_worker_version_engine_container,
            )

            ops = build_worker_version_engine_container().product_operations()
            ops.read_file(project_id, target_path)
            return True
        except Exception:
            return False

    async def execute(
        self, connection_id: str, trigger_type: str = "manual",
    ) -> Optional[dict]:
        connection = self.repository.get_by_id(connection_id)
        if not connection:
            log_error(f"[IntegrationEngine] Connection not found: {connection_id}")
            return None

        if connection.status not in ("active", "syncing"):
            log_debug(
                f"[IntegrationEngine] Skipping {connection_id} "
                f"(status={connection.status})"
            )
            return None

        connector = self.registry.get(connection.provider)
        if not connector:
            log_error(
                f"[IntegrationEngine] No connector registered for "
                f"provider: {connection.provider}"
            )
            return None

        run = None
        if self.run_repo:
            try:
                run = self.run_repo.create(connection.id, trigger_type=trigger_type)
            except Exception as exc:
                log_debug(f"[IntegrationEngine] Could not create run record: {exc}")

        try:
            self.repository.update_status(connection.id, "syncing")

            spec = connector.spec()
            user_id = connection.created_by or (connection.config or {}).get("user_id", "")
            credentials = await self.registry.resolve_credentials(
                oauth_type=spec.oauth_type,
                user_id=user_id,
                required=spec.auth != AuthRequirement.OPTIONAL_OAUTH,
            )

            result = await connector.fetch(connection.config or {}, credentials)

            if result.content_hash and result.content_hash == connection.remote_hash:
                self.repository.update_status(connection.id, "active")
                if run and self.run_repo:
                    self.run_repo.complete(
                        run.id,
                        status="skipped",
                        result_summary="No changes detected",
                    )
                return None

            materializer = self.registry.resolve_materializer(
                connection.provider,
                (connection.config or {}).get("materialization_schema"),
            )
            if materializer is not None:
                write_plan = plan_materialized_result(
                    sync=connection,
                    materialized=materializer.materialize(result, connection),
                )
            else:
                target_exists_as_file = self._target_exists_as_file(
                    connection.project_id,
                    connection.path,
                )
                write_plan = plan_fetch_result(
                    sync=connection,
                    result=result,
                    target_exists_as_file=target_exists_as_file,
                )

            source = (connection.config or {}).get("source") or {}
            external_resource_id = source.get("resource_id", "")
            actor = f"integration:{connection.provider}:{external_resource_id}"

            from src.version_engine.bootstrap.dependencies import (
                build_worker_version_engine_container,
            )

            commands = build_worker_version_engine_container().write_commands()

            if len(write_plan.files) == 1 and not write_plan.deleted:
                file_path, content = next(iter(write_plan.files.items()))
                outcome = await commands.write_bytes(
                    connection.project_id,
                    file_path,
                    content,
                    actor=actor,
                    message=write_plan.message,
                    source_channel="sync",
                )
            else:
                outcome = await commands.bulk_write(
                    connection.project_id,
                    write_plan.files,
                    actor=actor,
                    deleted=write_plan.deleted,
                    message=write_plan.message,
                    source_channel="sync",
                )

            commit_id = outcome.result.commit_id
            self.repository.update_sync_point(
                sync_id=connection.id,
                last_sync_commit_id=commit_id,
                remote_hash=result.content_hash,
            )

            log_info(
                f"[IntegrationEngine] {connection.provider}:{external_resource_id} "
                f"-> {write_plan.result_path} commit={commit_id}"
            )

            if run and self.run_repo:
                self.run_repo.complete(
                    run.id,
                    status="success",
                    result_summary=result.summary,
                )

            return {
                "access_point_id": connection.id,
                "connection_id": connection.id,
                "path": write_plan.result_path,
                "provider": connection.provider,
                "commit_id": commit_id,
                "status": "success",
                "summary": result.summary,
                "run_id": run.id if run else None,
            }

        except NotImplementedError:
            log_debug(f"[IntegrationEngine] fetch not implemented for {connection.provider}")
            self.repository.update_status(connection.id, "active")
            if run and self.run_repo:
                self.run_repo.complete(
                    run.id,
                    status="skipped",
                    result_summary="Fetch not implemented",
                )
            return None
        except Exception as exc:
            log_error(f"[IntegrationEngine] Failed for {connection_id}: {exc}")
            self.repository.update_error(connection.id, str(exc))
            if run and self.run_repo:
                self.run_repo.complete(run.id, status="failed", error=str(exc))
            return None

    async def execute_all(self, provider: Optional[str] = None) -> list[dict]:
        connections = self.repository.list_active(provider)
        results = []
        for connection in connections:
            if connection.direction == "outbound":
                continue
            result = await self.execute(connection.id)
            if result:
                results.append(result)
        if results:
            log_info(f"[IntegrationEngine] execute_all: {len(results)} connections updated")
        return results

    async def execute_for_connector(self, connector) -> Optional[str]:
        if connector.provider in ("cli", "agent", "sandbox", "git_remote"):
            log_debug(
                f"[IntegrationEngine] access connector cannot run on demand: "
                f"{connector.id}"
            )
            return None
        result = await self.execute(connector.id, trigger_type="manual")
        return (result or {}).get("run_id")

    async def push_execute(
        self,
        path: str,
        commit_id: str,
        content: Any,
        node_type: str,
    ) -> Optional[dict]:
        connection = self.repository.find_owner_by_path(path)
        if not connection:
            return None
        if connection.direction == "inbound" or connection.status != "active":
            return None
        if commit_id and connection.last_sync_commit_id == commit_id:
            return None

        connector = self.registry.get(connection.provider)
        if not connector:
            log_error(
                f"[IntegrationEngine] push: no connector for provider "
                f"{connection.provider}"
            )
            return None

        spec = connector.spec()
        if not (spec.capabilities & Capability.PUSH):
            return None

        run = None
        if self.run_repo:
            try:
                run = self.run_repo.create(connection.id, trigger_type="push")
            except Exception as exc:
                log_debug(f"[IntegrationEngine] Could not create push run record: {exc}")

        try:
            push_result = await connector.push(connection, content, node_type)
            if not push_result.success:
                error = push_result.error or "Push returned failure"
                self.repository.update_error(connection.id, error)
                if run and self.run_repo:
                    self.run_repo.complete(run.id, status="failed", error=error)
                return None

            self.repository.update_sync_point(
                sync_id=connection.id,
                last_sync_commit_id=commit_id,
                remote_hash=push_result.remote_hash,
            )
            if run and self.run_repo:
                self.run_repo.complete(
                    run.id,
                    status="success",
                    result_summary=f"Pushed commit {commit_id}",
                )
            return {
                "access_point_id": connection.id,
                "connection_id": connection.id,
                "path": path,
                "provider": connection.provider,
                "commit_id": commit_id,
                "direction": "push",
                "status": "success",
                "run_id": run.id if run else None,
            }
        except NotImplementedError:
            if run and self.run_repo:
                self.run_repo.complete(
                    run.id, status="skipped", result_summary="Push not implemented",
                )
            return None
        except Exception as exc:
            self.repository.update_error(connection.id, str(exc))
            if run and self.run_repo:
                self.run_repo.complete(run.id, status="failed", error=str(exc))
            return None

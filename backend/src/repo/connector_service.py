"""Business logic for connectors.

Responsibilities:
  - Refuse to create cli/agent connectors via the API (those are auto-created
    by the DB trigger when a scope is INSERTed; this layer enforces that
    they're "claim, don't create" from the user's perspective).
  - Default `name` from provider if not given.
  - Validate direction against provider capabilities (cli/agent must be
    bidirectional; OAuth-backed providers must pick inbound or outbound).
  - Coordinate execution (Step 2-Run-Now): hand off to engine.execute().
"""

from __future__ import annotations

from typing import Any, Optional

from src.exceptions import BusinessException, NotFoundException
from src.repo.connector_repository import ConnectorRepository
from src.repo.models import Connector


PROVIDERS_BIDIRECTIONAL = frozenset({"cli", "agent"})
# Providers we know can both pull and push (today, only filesystem within
# the new scope-binding world; for the redesign we represent CLI=bidirectional).
# OAuth-backed third-party providers must pick inbound OR outbound at create time.
PROVIDERS_OAUTH_BACKED = frozenset({
    "notion", "gmail", "google_sheets", "google_docs",
    "google_calendar", "google_drive", "google_search_console",
    "github", "linear", "airtable",
})

# Self-auth providers (config carries credential / no oauth_connection_id needed).
PROVIDERS_SELF_AUTH = frozenset({"url", "rest_api", "rss", "supabase"})


def _provider_default_name(provider: str) -> str:
    return provider.replace("_", " ").title()


class ConnectorService:
    def __init__(self, repository: Optional[ConnectorRepository] = None):
        self._repo = repository or ConnectorRepository()

    # ── Reads ────────────────────────────────────────────────────────────

    def list(
        self,
        project_id: str,
        *,
        scope_id: Optional[str] = None,
        provider: Optional[str] = None,
        direction: Optional[str] = None,
    ) -> list[Connector]:
        return self._repo.list_by_project(
            project_id, scope_id=scope_id, provider=provider, direction=direction,
        )

    def get(self, connector_id: str) -> Optional[Connector]:
        return self._repo.get(connector_id)

    def get_agent_by_mcp_key(self, mcp_api_key: str) -> Optional[Connector]:
        return self._repo.get_agent_by_mcp_key(mcp_api_key)

    # ── Writes ───────────────────────────────────────────────────────────

    def create(
        self,
        *,
        project_id: str,
        scope_id: str,
        provider: str,
        direction: str,
        name: Optional[str],
        config: Optional[dict[str, Any]],
        oauth_connection_id: Optional[int],
        trigger: Optional[dict[str, Any]],
        created_by: Optional[str],
    ) -> Connector:
        # Built-in cli / agent rows are auto-created by the DB trigger; the
        # API never creates them.
        if provider in PROVIDERS_BIDIRECTIONAL:
            raise BusinessException(
                f"'{provider}' connectors are auto-created per scope. "
                "Edit the auto-created row instead of creating a new one."
            )

        # Direction validation.
        if direction == "bidirectional":
            raise BusinessException(
                "Only built-in 'cli' and 'agent' connectors are "
                "bidirectional. Third-party providers must choose "
                "'inbound' (import) or 'outbound' (export)."
            )

        if provider in PROVIDERS_OAUTH_BACKED and not oauth_connection_id:
            raise BusinessException(
                f"Provider '{provider}' requires an oauth_connection_id. "
                "Connect this provider via the /connections page first, "
                "then re-create this connector."
            )

        # Verify scope exists and belongs to the same project before INSERT.
        # Without this, an invalid scope_id surfaces as a raw FK violation
        # that the global handler turns into a generic 500.
        from src.repo.scope_repository import RepoScopeRepository
        scope = RepoScopeRepository().get(scope_id)
        if scope is None or scope.project_id != project_id:
            raise NotFoundException(f"Scope {scope_id!r} not found in this project")

        return self._repo.insert(
            project_id=project_id,
            scope_id=scope_id,
            provider=provider,
            name=name or _provider_default_name(provider),
            direction=direction,
            config=config or {},
            oauth_connection_id=oauth_connection_id,
            trigger=trigger or {"type": "manual"},
            created_by=created_by,
        )

    def update(self, connector_id: str, patch: dict[str, Any]) -> Optional[Connector]:
        existing = self._repo.get(connector_id)
        if existing is None:
            return None
        # Refuse to flip a builtin's direction.
        if existing.is_builtin and "direction" in patch:
            raise BusinessException(
                "Built-in connector direction is fixed at 'bidirectional'."
            )
        # Don't let updates change provider or scope_id (those are immutable
        # post-create — re-create the connector if that's what you want).
        for forbidden in ("provider", "scope_id", "project_id"):
            patch.pop(forbidden, None)
        return self._repo.update(connector_id, patch)

    def delete(self, connector_id: str) -> None:
        existing = self._repo.get(connector_id)
        if existing is None:
            raise NotFoundException("Connector not found")
        if existing.is_builtin:
            raise BusinessException(
                "Built-in cli/agent connectors are managed by their scope. "
                "Delete the scope to remove them, or pause the connector instead."
            )
        self._repo.delete(connector_id)

    def pause(self, connector_id: str) -> None:
        self._repo.update(connector_id, {"status": "paused"})

    def resume(self, connector_id: str) -> None:
        self._repo.update(connector_id, {"status": "active"})

    # ── Run orchestration ────────────────────────────────────────────────

    async def run_now(self, connector_id: str) -> Optional[str]:
        """Manually trigger a connector run. Returns the connector_run_id.

        Heavy lifting lives in connectors/datasource/engine.py — we just
        kick it off here and return the run id.

        Built-in cli/agent connectors don't have a "run now" semantic —
        they're conduits for the user's own writes, not pollers. The
        engine returns None for those; we surface a clear 400 here so
        the UI doesn't render a useless run button.
        """
        connector = self._repo.get(connector_id)
        if connector is None:
            raise NotFoundException("Connector not found")
        if connector.is_builtin:
            raise BusinessException(
                "Built-in cli/agent connectors don't have a manual run."
            )
        if connector.status == "paused":
            raise BusinessException("Connector is paused; resume it first")

        # Lazy imports to avoid pulling the heavy engine module on
        # read-only routes. Use the non-DI factory because we may be
        # called from background contexts (scheduled triggers) too.
        from src.connectors.datasource.dependencies import create_sync_engine
        engine = create_sync_engine()
        run_id = await engine.execute_for_connector(connector)
        return run_id

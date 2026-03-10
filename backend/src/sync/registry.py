"""
ConnectorRegistry — Central registry for all sync connectors.

Responsibilities:
  - Register connector instances by provider name
  - Look up connectors by provider
  - List all registered ConnectorSpecs (for GET /sync/connectors API)
  - Manage OAuth service mapping for credential resolution
"""

from typing import Any, Optional

from src.sync.connectors._base import BaseConnector, ConnectorSpec, Credentials
from src.utils.logger import log_info, log_error


class ConnectorRegistry:
    """
    Central registry for connector instances and OAuth services.

    SyncEngine uses this to look up connectors and resolve credentials.
    The /sync/connectors API uses list_specs() for frontend dynamic rendering.
    """

    def __init__(self) -> None:
        self._connectors: dict[str, BaseConnector] = {}
        self._oauth_services: dict[str, Any] = {}

    # ── Connector registration ───────────────────────────────

    def register(self, connector: BaseConnector) -> None:
        provider = connector.spec().provider
        self._connectors[provider] = connector
        log_info(f"[Registry] Registered connector: {provider}")

    def get(self, provider: str) -> Optional[BaseConnector]:
        return self._connectors.get(provider)

    def list_specs(self) -> list[ConnectorSpec]:
        return [c.spec() for c in self._connectors.values()]

    def providers(self) -> list[str]:
        return list(self._connectors.keys())

    # ── OAuth service registration ───────────────────────────

    def register_oauth(self, oauth_type: str, service: Any) -> None:
        """Register an OAuth service for credential resolution."""
        self._oauth_services[oauth_type] = service

    async def resolve_credentials(
        self,
        oauth_type: Optional[str],
        user_id: str,
    ) -> Credentials:
        """
        Resolve credentials for a given oauth_type and user_id.

        Handles token refresh automatically. Returns empty Credentials
        if no OAuth is needed (e.g. URL connector).
        """
        if not oauth_type or oauth_type not in self._oauth_services:
            return Credentials()

        if not user_id:
            raise ValueError(
                f"Cannot resolve {oauth_type} credentials: user_id is empty. "
                f"Please re-create this sync."
            )

        service = self._oauth_services[oauth_type]

        try:
            connection = await service.refresh_token_if_needed(user_id)
            if not connection:
                raise ValueError(
                    f"No {oauth_type} connection found for user. Please authorize first."
                )

            return Credentials(
                access_token=connection.access_token,
                metadata=connection.metadata or {},
            )
        except Exception as e:
            log_error(f"[Registry] Failed to resolve credentials for {oauth_type}: {e}")
            raise

    # ── Serialization (for API response) ─────────────────────

    def specs_to_dicts(self, include_hidden: bool = False) -> list[dict]:
        """Serialize specs to dicts for API response. Filters ui_visible=False by default."""
        result = []
        for connector in self._connectors.values():
            s = connector.spec()
            if not include_hidden and not s.ui_visible:
                continue
            result.append({
                "provider": s.provider,
                "display_name": s.display_name,
                "description": s.description,
                "auth": s.auth.value,
                "oauth_type": s.oauth_type,
                "oauth_ui_type": s.oauth_ui_type,
                "default_node_type": s.default_node_type,
                "supported_sync_modes": list(s.supported_sync_modes),
                "default_sync_mode": s.default_sync_mode,
                "creation_mode": s.creation_mode,
                "supported_directions": s.supported_directions,
                "accept_types": list(s.accept_types),
                "config_fields": [
                    {
                        "key": f.key,
                        "label": f.label,
                        "type": f.type,
                        "required": f.required,
                        "default": f.default,
                        "options": f.options,
                        "placeholder": f.placeholder,
                        "hint": f.hint,
                    }
                    for f in s.config_fields
                ],
                "icon": s.icon,
            })
        return result

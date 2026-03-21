"""
Data Source Providers — One provider per external system.

Each provider lives in its own directory and implements BaseConnector,
declaring its capabilities via ConnectorSpec. Providers are auto-discovered
at startup — no manual registration required.

To add a new connector:
  1. Create  datasource/<provider>/connector.py  with a BaseConnector subclass
  2. Add a  setup(deps) -> ConnectorSetup  function in that file
"""

from src.connectors.datasource._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    Credentials,
    FetchResult,
    ConfigField,
    ConnectorDeps,
    ConnectorSetup,
)

__all__ = [
    "BaseConnector",
    "ConnectorSpec",
    "Capability",
    "AuthRequirement",
    "TriggerMode",
    "Credentials",
    "FetchResult",
    "ConfigField",
    "ConnectorDeps",
    "ConnectorSetup",
]

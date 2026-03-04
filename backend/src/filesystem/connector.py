"""
Re-export OpenClawConnector.

The actual class lives in src.sync.connectors.filesystem.connector to
avoid circular imports with the ConnectorRegistry's __init__.py.
"""
from src.sync.connectors.filesystem.connector import OpenClawConnector  # noqa: F401

__all__ = ["OpenClawConnector"]

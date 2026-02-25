"""
OpenClaw Connector — CLI bidirectional file sync.

- connector.py      ConnectorSpec + BaseConnector stub
- lifecycle.py      Connection lifecycle (bootstrap, connect, status, disconnect)
- folder_access.py  File push/pull logic (PuppyOne ↔ CLI workspace)
- watcher.py        Folder watcher (filesystem events)
- router.py         HTTP endpoints for CLI daemon
"""
from src.sync.connectors.openclaw.connector import OpenClawConnector
from src.sync.connectors.openclaw.lifecycle import OpenClawService

__all__ = ["OpenClawConnector", "OpenClawService"]

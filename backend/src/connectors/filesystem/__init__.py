"""
Filesystem Connector — Folder sync via MUT protocol.

Architecture: Client-side daemon handles all watch/diff/sync via MUT HTTP protocol.
Server provides: MUT protocol endpoints + supplementary read/push APIs.

Components:
  - service.py        FolderSyncService  — server-side read/push helpers
  - lifecycle.py      OpenClawService    — CLI connect/disconnect lifecycle
  - watcher.py        FolderSourceService — stub (client-side now)
  - folder_access.py  FolderAccessService — stub (client-side now)
  - connector.py      OpenClawConnector  — ConnectorSpec declaration
  - router.py         HTTP endpoints     — /api/v1/filesystem/*
"""

from src.connectors.filesystem.service import FolderSyncService
from src.connectors.filesystem.lifecycle import OpenClawService
from src.connectors.filesystem.watcher import FolderSourceService
from src.connectors.filesystem.folder_access import FolderAccessService

__all__ = [
    "FolderSyncService",
    "OpenClawService",
    "FolderSourceService",
    "FolderAccessService",
]

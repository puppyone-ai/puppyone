"""
Filesystem Connector — Bidirectional local folder sync (OpenClaw).

Components:
  - service.py        FolderSyncService  — core pull/push/delete logic
  - lifecycle.py      OpenClawService    — CLI connect/disconnect lifecycle
  - watcher.py        FolderSourceService — one-way local→cloud watcher
  - folder_access.py  FolderAccessService — bidirectional workspace sync
  - connector.py      OpenClawConnector  — ConnectorSpec declaration
  - io/               Pure file I/O engine (scan, diff, write, watch)
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

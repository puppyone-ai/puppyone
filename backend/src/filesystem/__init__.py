"""
Filesystem Module — Bidirectional local folder sync (OpenClaw).

First-class module for managing CLI-driven folder synchronization between
local workspaces and PuppyOne cloud. Separated from the SaaS sync module
because filesystem sync is fundamentally different:

  - Bidirectional (SaaS sync is one-way cloud→PuppyOne)
  - Real-time via daemon (SaaS sync is periodic/manual)
  - Client-side + server-side execution (SaaS is server-only)
  - Requires conflict resolution (SaaS uses external_wins)
  - Maintains local state (.puppyone/)

Components:
  - service.py        FolderSyncService  — core pull/push/delete logic
  - lifecycle.py      OpenClawService    — CLI connect/disconnect lifecycle
  - watcher.py        FolderSourceService — one-way local→cloud watcher
  - folder_access.py  FolderAccessService — bidirectional workspace sync
  - connector.py      OpenClawConnector  — ConnectorSpec declaration (re-export)
  - router.py         HTTP endpoints     — /api/v1/filesystem/*
"""

from src.filesystem.service import FolderSyncService
from src.filesystem.lifecycle import OpenClawService
from src.filesystem.watcher import FolderSourceService
from src.filesystem.folder_access import FolderAccessService

__all__ = [
    "FolderSyncService",
    "OpenClawService",
    "FolderSourceService",
    "FolderAccessService",
]

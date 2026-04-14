"""
Filesystem Connector — Bidirectional local folder sync via MUT protocol.

Architecture:
  - CLI daemon handles all watch/diff/sync using MUT access_point
    (POST /api/v1/mut/ap/{access_key}/clone|push|pull|negotiate)
  - Backend provides connection lifecycle management only

Components:
  - connector.py    FilesystemConnector  — ConnectorSpec declaration
  - service.py      FilesystemService    — connection lifecycle (bootstrap/connect/status/disconnect)
  - router.py       HTTP endpoints       — /api/v1/filesystem/*
"""

from src.connectors.filesystem.service import FilesystemService
from src.connectors.filesystem.connector import FilesystemConnector

__all__ = [
    "FilesystemService",
    "FilesystemConnector",
]

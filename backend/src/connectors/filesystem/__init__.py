"""
Filesystem Connector — Bidirectional local folder sync via version transaction engine.

Architecture:
  - Stock Git clients use /git/ap/{access_key}.git.
  - Puppyone CLI filesystem commands use /api/v1/ap-fs/*.
  - Backend provides connection lifecycle management only.

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

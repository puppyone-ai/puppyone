"""Backward-compat re-export — canonical locations: src.filesystem.*"""
from src.sync.connectors.filesystem.connector import OpenClawConnector  # noqa: F401
from src.filesystem.lifecycle import OpenClawService  # noqa: F401

__all__ = ["OpenClawConnector", "OpenClawService"]

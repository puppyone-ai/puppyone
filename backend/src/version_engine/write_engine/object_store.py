"""Compatibility shim for the L6 storage object-store boundary.

New code should import from ``src.version_engine.storage.object_store``.
"""

from src.version_engine.storage.object_store import *  # noqa: F403

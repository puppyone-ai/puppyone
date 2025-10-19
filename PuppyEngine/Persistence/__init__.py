"""
Persistence Package

Provides different strategies for persisting block data to memory or external storage.
"""

from .ExternalStorageStrategy import ExternalStorageStrategy
from .MemoryStrategy import MemoryStrategy

__all__ = [
    "ExternalStorageStrategy",
    "MemoryStrategy",
]

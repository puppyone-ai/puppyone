"""
Template data model.

Kept separate from the loader so test code, documentation generators, and
future marketplace adapters can import the type without triggering disk I/O.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectTemplate:
    """A project template — metadata + the file tree that gets seeded."""

    id: str
    name: str
    description: str
    icon: str
    files: dict[str, bytes]

    # Optional metadata (forward-compatible with a future marketplace).
    version: str = "1.0.0"
    author: str | None = None
    tags: tuple[str, ...] = ()
    order: int = 100  # lower → appears first in the picker

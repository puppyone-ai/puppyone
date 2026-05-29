"""Data contracts for L5 TreeDelta."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ChangeAction = Literal["add", "update", "delete"]
EntryKind = Literal["blob", "tree"]


@dataclass(frozen=True, slots=True)
class TreeChange:
    """One structural change between two Git trees or file maps."""

    path: str
    action: ChangeAction
    old_type: EntryKind | None = None
    new_type: EntryKind | None = None
    old_oid: str | None = None
    new_oid: str | None = None

    @property
    def legacy_op(self) -> str:
        """Return the historical ``added/deleted/modified`` spelling."""

        return {
            "add": "added",
            "delete": "deleted",
            "update": "modified",
        }[self.action]

    def to_legacy_dict(self) -> dict:
        """Return the compact dict shape older call sites expect."""

        return {"path": self.path, "op": self.legacy_op}


@dataclass(frozen=True, slots=True)
class TreeDelta:
    """Structural write delta.

    The delta is authoritative only for L5 write mechanics. It is not a
    renderer payload and must not parse Markdown, DOCX, images, or other
    human-facing formats.
    """

    changes: tuple[TreeChange, ...] = ()

    def paths(self) -> list[str]:
        return [change.path for change in self.changes if change.path]

    def to_legacy_changes(self) -> list[dict]:
        return [change.to_legacy_dict() for change in self.changes]

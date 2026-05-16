"""Protocol admission (legacy stub).

The legacy MUT wire protocol has been removed. Git smart-HTTP is the
only external protocol surface, and the Product Operation Adapter is
always reachable internally. This module previously consulted a
per-project ``protocol_mode`` (``git``/``mut``/``both``) flag at adapter
admission time; the flag has been retired along with the MUT adapter.

The ``ensure_protocol_enabled`` entry point is kept as a no-op so older
call sites (Git router, AP-FS router) keep their import surface stable
during the migration. Once those callers are simplified, this module
can be deleted entirely.
"""

from __future__ import annotations

from typing import Literal


ProtocolName = Literal["git"]


class ProtocolModeUnavailable(RuntimeError):
    """Retained for backwards-compatible imports; no longer raised."""


async def ensure_protocol_enabled(project_id: str, protocol: ProtocolName) -> None:
    """No-op: only Git is supported now, and it is always enabled."""

    _ = (project_id, protocol)
    return None


def get_project_protocol_mode(project_id: str) -> str:
    """Return ``"git"`` for every project — the field is no longer consulted."""

    _ = project_id
    return "git"

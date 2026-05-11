"""
Filesystem connection lifecycle service.

Manages CLI daemon connect / status / disconnect lifecycle.
Data sync is handled entirely by MUT protocol via access_point.py.
"""

import re
import secrets
from typing import Optional
from datetime import datetime

from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.schemas import Sync
from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_info

_FORBIDDEN_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')
_FORBIDDEN_NAMES = frozenset([".", "..", "CON", "PRN", "AUX", "NUL"] +
                              [f"COM{i}" for i in range(1, 10)] +
                              [f"LPT{i}" for i in range(1, 10)])


def _validate_filename(filename: str) -> str | None:
    """Return error message if filename is invalid for the MUT tree, else None."""
    if not filename or not filename.strip():
        return "Filename must not be empty"
    if filename.startswith("/"):
        return f"Absolute path not allowed: {filename}"
    if "\\" in filename:
        return f"Backslash not allowed: {filename}"

    segments = filename.split("/")
    if any(segment == "" for segment in segments):
        return f"Double slash not allowed: {filename}"
    if any(segment == "." for segment in segments):
        return f"Relative path not allowed: {filename}"
    if any(segment == ".." for segment in segments):
        return f"Path traversal not allowed: {filename}"
    if _FORBIDDEN_CHARS.search(filename):
        return f"Filename contains forbidden characters: {filename}"
    basename = filename.rsplit("/", 1)[-1].split(".")[0].upper()
    if basename in _FORBIDDEN_NAMES:
        return f"Reserved filename: {filename}"
    if len(filename) > 255:
        return "Filename too long (max 255)"
    return None


def _generate_cli_key() -> str:
    return f"cli_{secrets.token_urlsafe(32)}"


class FilesystemService:
    """Filesystem connection lifecycle — bootstrap, connect, heartbeat, status, disconnect.

    Data sync is handled entirely by MUT protocol via access_point.py
    (POST /api/v1/mut/ap/{access_key}/clone|push|pull|negotiate).
    This service only manages the access_points table row.
    """

    def __init__(
        self,
        supabase: SupabaseClient,
        sync_repo: SyncRepository,
    ):
        self._supabase = supabase
        self._sync_repo = sync_repo

    # ----------------------------------------------------------
    # Auth: access key → Sync
    # ----------------------------------------------------------

    def authenticate(self, access_key: str) -> Optional[Sync]:
        sync = self._sync_repo.get_by_access_key(access_key)
        if not sync:
            return None
        if sync.provider != "filesystem":
            return None
        return sync

    def touch_heartbeat(self, sync: Sync) -> None:
        self._sync_repo.touch_heartbeat(sync.id)

    # ----------------------------------------------------------
    # Bootstrap — create a new filesystem connection for a folder
    # ----------------------------------------------------------

    def bootstrap(
        self,
        project_id: str,
        path: str,
    ) -> Sync:
        """Create a filesystem connection bound to a folder path.

        Returns the sync with a fresh access_key for CLI auth.
        The CLI uses this key to access the MUT protocol at
        /api/v1/mut/ap/{access_key}/clone|push|pull|negotiate.
        """
        existing = self._sync_repo.get_by_path(path, project_id=project_id)
        if existing and existing.provider == "filesystem":
            return existing

        sync = self._sync_repo.create(
            project_id=project_id,
            path=path,
            direction="bidirectional",
            provider="filesystem",
            access_key=_generate_cli_key(),
            config={
                "scope": {
                    "id": f"fs-{path.replace('/', '-').strip('-') or 'root'}",
                    "path": path,
                    "exclude": [".git", "node_modules", ".DS_Store", "__pycache__"],
                    "mode": "rw",
                },
            },
            trigger={"type": "realtime"},
            conflict_strategy="three_way_merge",
        )
        log_info(f"[Filesystem] Bootstrapped connection #{sync.id} for path {path}")
        return sync

    # ----------------------------------------------------------
    # Connect — CLI daemon calls this on startup
    # ----------------------------------------------------------

    def connect(self, sync: Sync, workspace_path: str) -> Sync:
        if sync.config.get("path") != workspace_path:
            self._sync_repo.update_config(
                sync.id,
                {**sync.config, "path": workspace_path},
            )
        self._sync_repo.touch_heartbeat(sync.id)
        log_info(f"[Filesystem] CLI connected: sync #{sync.id} @ {workspace_path}")
        return sync

    # ----------------------------------------------------------
    # Status
    # ----------------------------------------------------------

    def status(self, sync: Sync) -> dict:
        daemon_active = False
        if sync.updated_at:
            try:
                last_seen = datetime.fromisoformat(
                    sync.updated_at.replace("Z", "+00:00")
                    if isinstance(sync.updated_at, str)
                    else sync.updated_at.isoformat()
                )
                age = (datetime.now(last_seen.tzinfo) - last_seen).total_seconds()
                daemon_active = age < 90
            except Exception:
                pass

        return {
            "connected": daemon_active,
            "access_point_id": sync.id,
            "folder_path": sync.path,
            "workspace_path": sync.config.get("path"),
            "connected_at": sync.created_at,
            "last_seen_at": sync.updated_at,
        }

    # ----------------------------------------------------------
    # Disconnect
    # ----------------------------------------------------------

    def disconnect(self, sync: Sync) -> bool:
        self._sync_repo.delete(sync.id)
        log_info(f"[Filesystem] Disconnected: sync #{sync.id}")
        return True

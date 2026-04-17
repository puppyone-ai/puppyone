"""
Fallback WorkspaceProvider — Full Copy

Used on platforms that do not support APFS Clone or OverlayFS.
Functionally identical, but creates workspaces via full copy (slightly slower).
Merge Daemon code is completely unaffected.
"""

import hashlib
import os
import shutil
import time

from src.connectors.datasource.schemas import SyncResult
from src.platform.workspace.provider import (
    WorkspaceChanges,
    WorkspaceInfo,
    WorkspaceProvider,
)
from src.utils.logger import log_debug, log_info


class FallbackWorkspaceProvider(WorkspaceProvider):
    """Full copy implementation (any platform)"""

    def __init__(self, base_dir: str = "/tmp/contextbase"):
        self._base_dir = base_dir
        self._lower_dir = os.path.join(base_dir, "lower")
        self._workspaces_dir = os.path.join(base_dir, "workspaces")
        self._registry: dict[str, WorkspaceInfo] = {}

        os.makedirs(self._lower_dir, exist_ok=True)
        os.makedirs(self._workspaces_dir, exist_ok=True)

    def get_lower_path(self, project_id: str) -> str:
        return os.path.join(self._lower_dir, project_id)

    async def create_workspace(
        self, agent_id: str, project_id: str, base_commit_id: str | None = None
    ) -> WorkspaceInfo:
        """Create workspace via full copy"""
        lower_path = self.get_lower_path(project_id)
        workspace_path = os.path.join(self._workspaces_dir, agent_id)

        if os.path.exists(workspace_path):
            shutil.rmtree(workspace_path)

        if not os.path.exists(lower_path):
            os.makedirs(workspace_path, exist_ok=True)
            log_info(f"[Fallback] Created empty workspace for {agent_id}")
        else:
            start = time.time()
            shutil.copytree(lower_path, workspace_path, dirs_exist_ok=True)
            elapsed = time.time() - start
            file_count = sum(len(files) for _, _, files in os.walk(workspace_path))
            log_info(f"[Fallback] Copied workspace for {agent_id}: {file_count} files, {elapsed:.3f}s")

        info = WorkspaceInfo(
            path=workspace_path,
            agent_id=agent_id,
            project_id=project_id,
            base_commit_id=base_commit_id,
            lower_path=lower_path,
        )
        self._registry[agent_id] = info
        return info

    async def detect_changes(self, agent_id: str) -> WorkspaceChanges:
        """Same diff logic as the APFS Provider"""
        info = self._registry.get(agent_id)
        if not info:
            return WorkspaceChanges(agent_id=agent_id)

        modified = _collect_modified(info.path, info.lower_path)
        deleted = _collect_deleted(info.lower_path, info.path)

        log_info(f"[Fallback] Changes for {agent_id}: {len(modified)} modified, {len(deleted)} deleted")
        return WorkspaceChanges(
            agent_id=agent_id,
            base_commit_id=info.base_commit_id,
            modified=modified,
            deleted=deleted,
        )

    async def cleanup(self, agent_id: str) -> None:
        info = self._registry.pop(agent_id, None)
        if info and os.path.exists(info.path):
            shutil.rmtree(info.path, ignore_errors=True)
            log_debug(f"[Fallback] Cleaned up workspace for {agent_id}")

    async def sync_lower(self, project_id: str) -> SyncResult:
        lower_path = self.get_lower_path(project_id)
        os.makedirs(lower_path, exist_ok=True)
        return SyncResult()


def _iter_visible_files(directory: str):
    """Yield (absolute_path, relative_path) for non-hidden files."""
    if not os.path.exists(directory):
        return
    for root, _, files in os.walk(directory):
        for fname in files:
            if not fname.startswith("."):
                abs_path = os.path.join(root, fname)
                yield abs_path, os.path.relpath(abs_path, directory)


def _collect_modified(workspace_path: str, lower_path: str) -> dict[str, str]:
    """Find new or modified files in workspace compared to lower."""
    modified = {}
    for ws_file, rel_path in _iter_visible_files(workspace_path):
        lower_file = os.path.join(lower_path, rel_path)
        if not os.path.exists(lower_file) or _file_hash(ws_file) != _file_hash(lower_file):
            modified[rel_path] = _read_file(ws_file)
    return modified


def _collect_deleted(lower_path: str, workspace_path: str) -> list[str]:
    """Find files present in lower but missing from workspace."""
    deleted = []
    for _, rel_path in _iter_visible_files(lower_path):
        if not os.path.exists(os.path.join(workspace_path, rel_path)):
            deleted.append(rel_path)
    return deleted


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
    except OSError:
        return ""
    return h.hexdigest()


def _read_file(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        return ""
    except OSError:
        return ""

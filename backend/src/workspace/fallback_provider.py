"""
Fallback WorkspaceProvider — 全量复制

在不支持 APFS Clone 或 OverlayFS 的平台上使用。
功能完全一样，只是创建工作区时做全量复制（稍慢）。
Merge Daemon 代码完全不受影响。
"""

import hashlib
import os
import shutil
import time
from typing import Optional

from src.workspace.provider import (
    WorkspaceProvider, WorkspaceInfo, WorkspaceChanges,
)
from src.sync.schemas import SyncResult
from src.utils.logger import log_info, log_debug


class FallbackWorkspaceProvider(WorkspaceProvider):
    """全量复制实现（任何平台）"""

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
        self, agent_id: str, project_id: str, base_snapshot_id: Optional[int] = None
    ) -> WorkspaceInfo:
        """全量复制创建工作区"""
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
            base_snapshot_id=base_snapshot_id,
            lower_path=lower_path,
        )
        self._registry[agent_id] = info
        return info

    async def detect_changes(self, agent_id: str) -> WorkspaceChanges:
        """和 APFS Provider 完全相同的 diff 逻辑"""
        info = self._registry.get(agent_id)
        if not info:
            return WorkspaceChanges(agent_id=agent_id)

        lower_path = info.lower_path
        workspace_path = info.path
        modified = {}
        deleted = []

        if os.path.exists(workspace_path):
            for root, _, files in os.walk(workspace_path):
                for fname in files:
                    if fname.startswith("."):
                        continue
                    ws_file = os.path.join(root, fname)
                    rel_path = os.path.relpath(ws_file, workspace_path)
                    lower_file = os.path.join(lower_path, rel_path)

                    ws_hash = _file_hash(ws_file)
                    if not os.path.exists(lower_file):
                        modified[rel_path] = _read_file(ws_file)
                    else:
                        if ws_hash != _file_hash(lower_file):
                            modified[rel_path] = _read_file(ws_file)

        if os.path.exists(lower_path):
            for root, _, files in os.walk(lower_path):
                for fname in files:
                    if fname.startswith("."):
                        continue
                    lower_file = os.path.join(root, fname)
                    rel_path = os.path.relpath(lower_file, lower_path)
                    ws_file = os.path.join(workspace_path, rel_path)
                    if not os.path.exists(ws_file):
                        deleted.append(rel_path)

        log_info(f"[Fallback] Changes for {agent_id}: {len(modified)} modified, {len(deleted)} deleted")
        return WorkspaceChanges(
            agent_id=agent_id,
            base_snapshot_id=info.base_snapshot_id,
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


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
    except (OSError, IOError):
        return ""
    return h.hexdigest()


def _read_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        return ""
    except (OSError, IOError):
        return ""

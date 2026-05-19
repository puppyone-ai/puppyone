"""
OverlayFS Workspace Provider — Linux CoW isolation for agent workspaces.

Uses OverlayFS to create lightweight, copy-on-write workspaces:
  - Shared read-only lower layer (the hash clone base)
  - Per-agent upper layer (only stores modifications)
  - Merged view that looks like a full directory

Resource savings (500MB workspace, 1000 agents):
  OverlayFS: ~501MB (1 lower + small uppers)
  Full copy: ~500GB (1000 × 500MB)

Requires:
  - Linux kernel with OverlayFS support (most modern distros)
  - Root/sudo for mount operations (or user namespaces)
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from src.connectors.datasource.schemas import SyncResult
from src.platform.workspace.provider import (
    WorkspaceChanges,
    WorkspaceInfo,
    WorkspaceProvider,
)
from src.utils.logger import log_debug, log_error, log_info


class OverlayFSWorkspaceProvider(WorkspaceProvider):
    """Linux OverlayFS-based workspace provider with CoW isolation."""

    def __init__(self, base_dir: str = "/tmp/puppyone-workspaces"):
        self._base = Path(base_dir)
        self._lower_dir = self._base / "lower"
        self._base.mkdir(parents=True, exist_ok=True)
        self._lower_dir.mkdir(parents=True, exist_ok=True)
        self._registry: dict[str, WorkspaceInfo] = {}

    def get_lower_path(self, project_id: str) -> str:
        return str(self._lower_dir / project_id)

    async def create_workspace(
        self,
        agent_id: str,
        project_id: str,
        base_commit_id: str | None = None,
    ) -> WorkspaceInfo:
        """Create an OverlayFS workspace for an agent.

        Returns WorkspaceInfo with the path to the merged (usable) directory.
        """
        lower_path = self.get_lower_path(project_id)
        merged_path = self._mount_overlay(agent_id, lower_path)

        info = WorkspaceInfo(
            path=merged_path,
            agent_id=agent_id,
            project_id=project_id,
            base_commit_id=base_commit_id,
            lower_path=lower_path,
        )
        self._registry[agent_id] = info
        return info

    def _mount_overlay(self, workspace_id: str, source_dir: str) -> str:
        """Attempt OverlayFS mount, falling back to copy. Returns merged path."""
        ws_root = self._base / workspace_id
        lower = Path(source_dir)
        upper = ws_root / "upper"
        work = ws_root / "work"
        merged = ws_root / "merged"

        for d in (upper, work, merged):
            d.mkdir(parents=True, exist_ok=True)

        if not lower.exists():
            lower.mkdir(parents=True, exist_ok=True)

        try:
            merged_str = self._try_mount(workspace_id, lower, upper, work, merged)
            if merged_str:
                return merged_str

            # Both failed — fall back to full copy
            return self._fallback_copy(workspace_id, source_dir)

        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            log_error(f"[OverlayFS] mount error, falling back to copy: {e}")
            return self._fallback_copy(workspace_id, source_dir)

    def _try_mount(
        self, workspace_id: str, lower: Path, upper: Path, work: Path, merged: Path,
    ) -> str | None:
        """Try kernel overlayfs then fuse-overlayfs. Return merged path or None."""
        overlay_opts = f"lowerdir={lower},upperdir={upper},workdir={work}"

        result = subprocess.run(
            ["mount", "-t", "overlay", "overlay", "-o", overlay_opts, str(merged)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            log_info(f"[OverlayFS] Created workspace {workspace_id}")
            return str(merged)

        result = subprocess.run(
            ["fuse-overlayfs", "-o", overlay_opts, str(merged)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            log_info(f"[OverlayFS] Created workspace {workspace_id} (fuse)")
            return str(merged)

        log_error(
            f"[OverlayFS] mount failed, falling back to copy: "
            f"{result.stderr.strip()}"
        )
        return None

    async def detect_changes(self, agent_id: str) -> WorkspaceChanges:
        """Detect what the Agent changed by comparing workspace upper layer."""
        info = self._registry.get(agent_id)
        if not info:
            return WorkspaceChanges(agent_id=agent_id)

        # The upper dir contains only modified/new files
        ws_root = self._base / agent_id
        upper = ws_root / "upper"

        modified: dict[str, str] = {}
        deleted: list[str] = []

        if upper.exists():
            for root, _, files in os.walk(upper):
                for fname in files:
                    if fname.startswith("."):
                        continue
                    abs_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(abs_path, str(upper))
                    try:
                        with open(abs_path, encoding="utf-8") as f:
                            modified[rel_path] = f.read()
                    except (UnicodeDecodeError, OSError):
                        modified[rel_path] = ""

        log_info(f"[OverlayFS] Changes for {agent_id}: {len(modified)} modified, {len(deleted)} deleted")
        return WorkspaceChanges(
            agent_id=agent_id,
            base_commit_id=info.base_commit_id,
            modified=modified,
            deleted=deleted,
        )

    async def cleanup(self, agent_id: str) -> None:
        """Unmount and clean up an agent's workspace."""
        info = self._registry.pop(agent_id, None)
        if not info:
            return
        self._unmount_workspace(agent_id)
        log_debug(f"[OverlayFS] Cleaned up workspace for {agent_id}")

    async def sync_lower(self, project_id: str) -> SyncResult:
        lower_path = self.get_lower_path(project_id)
        os.makedirs(lower_path, exist_ok=True)
        return SyncResult()

    def _unmount_workspace(self, workspace_id: str) -> None:
        """Unmount and remove a workspace directory."""
        ws_root = self._base / workspace_id
        merged = ws_root / "merged"

        if merged.exists() and merged.is_mount():
            try:
                subprocess.run(
                    ["umount", str(merged)],
                    capture_output=True, timeout=10,
                )
            except Exception as e:
                log_error(f"[OverlayFS] umount failed: {e}")

        if ws_root.exists():
            shutil.rmtree(ws_root, ignore_errors=True)
        log_info(f"[OverlayFS] Destroyed workspace {workspace_id}")

    def destroy_workspace(self, workspace_id: str) -> None:
        """Unmount and clean up a workspace (legacy interface)."""
        self._registry.pop(workspace_id, None)
        self._unmount_workspace(workspace_id)

    def get_workspace_path(self, workspace_id: str) -> str:
        """Return the merged directory path for a workspace."""
        return str(self._base / workspace_id / "merged")

    def workspace_exists(self, workspace_id: str) -> bool:
        merged = self._base / workspace_id / "merged"
        return merged.exists()

    def _fallback_copy(self, workspace_id: str, source_dir: str) -> str:
        """Full directory copy when OverlayFS is unavailable."""
        dest = self._base / workspace_id / "merged"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source_dir, dest)
        log_info(f"[OverlayFS] Fallback copy for workspace {workspace_id}")
        return str(dest)

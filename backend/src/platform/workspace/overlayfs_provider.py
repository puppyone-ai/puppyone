"""
OverlayFS Workspace Provider — Linux CoW isolation for agent workspaces.

Uses OverlayFS to create lightweight, copy-on-write workspaces:
  - Shared read-only lower layer (the MUT clone base)
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

from src.platform.workspace.provider import WorkspaceProvider
from src.utils.logger import log_info, log_error


class OverlayFSWorkspaceProvider(WorkspaceProvider):
    """Linux OverlayFS-based workspace provider with CoW isolation."""

    def __init__(self, base_dir: str = "/tmp/puppyone-workspaces"):
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)

    def create_workspace(
        self,
        workspace_id: str,
        source_dir: str,
    ) -> str:
        """Create an OverlayFS workspace from a source directory.

        Returns the path to the merged (usable) directory.
        """
        ws_root = self._base / workspace_id
        lower = Path(source_dir)  # shared read-only base
        upper = ws_root / "upper"
        work = ws_root / "work"
        merged = ws_root / "merged"

        for d in (upper, work, merged):
            d.mkdir(parents=True, exist_ok=True)

        try:
            # Try OverlayFS mount
            cmd = [
                "mount", "-t", "overlay", "overlay",
                "-o", f"lowerdir={lower},upperdir={upper},workdir={work}",
                str(merged),
            ]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                log_info(f"[OverlayFS] Created workspace {workspace_id}")
                return str(merged)

            # OverlayFS failed (no root/capability) — try fuse-overlayfs
            fuse_cmd = [
                "fuse-overlayfs",
                "-o", f"lowerdir={lower},upperdir={upper},workdir={work}",
                str(merged),
            ]
            result = subprocess.run(
                fuse_cmd, capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                log_info(f"[OverlayFS] Created workspace {workspace_id} (fuse)")
                return str(merged)

            # Both failed — fall back to full copy
            log_error(
                f"[OverlayFS] mount failed, falling back to copy: "
                f"{result.stderr.strip()}"
            )
            return self._fallback_copy(workspace_id, source_dir)

        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            log_error(f"[OverlayFS] mount error, falling back to copy: {e}")
            return self._fallback_copy(workspace_id, source_dir)

    def destroy_workspace(self, workspace_id: str) -> None:
        """Unmount and clean up a workspace."""
        ws_root = self._base / workspace_id
        merged = ws_root / "merged"

        if merged.is_mount():
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

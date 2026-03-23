"""
L2.5 Sync — CacheManager Local Cache Management

Manages cache metadata for local Lower directories:
- Read/write .metadata.json (records sync timestamps for each node)
- Manage directory structure
- Clean up expired cache

Pure file system operations extracted from workspace/sync_worker.py.
"""

import json
import os
from typing import Dict, Any, Optional

from src.utils.logger import log_error, log_debug


class CacheManager:
    """Local cache directory management."""

    def __init__(self, base_dir: str = "/tmp/contextbase"):
        self._base_dir = base_dir
        self._lower_dir = os.path.join(base_dir, "lower")
        os.makedirs(self._lower_dir, exist_ok=True)

    @property
    def lower_dir(self) -> str:
        return self._lower_dir

    def get_project_dir(self, project_id: str) -> str:
        """Get the Lower directory path for a project (auto-creates)."""
        path = os.path.join(self._lower_dir, project_id)
        os.makedirs(path, exist_ok=True)
        return path

    # ============================================================
    # Metadata Management
    # ============================================================

    def read_metadata(self, project_id: str) -> Dict[str, Any]:
        """Read sync metadata for a project."""
        meta_path = os.path.join(self.get_project_dir(project_id), ".metadata.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {}

    def write_metadata(self, project_id: str, metadata: Dict[str, Any]) -> None:
        """Write sync metadata for a project."""
        meta_path = os.path.join(self.get_project_dir(project_id), ".metadata.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    # ============================================================
    # File Writing
    # ============================================================

    def write_file(self, project_id: str, filename: str, content: str) -> bool:
        """Write a text file to the Lower directory."""
        try:
            file_path = os.path.join(self.get_project_dir(project_id), filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            return True
        except (IOError, OSError) as e:
            log_error(f"[CacheManager] Failed to write {filename}: {e}")
            return False

    def write_bytes(self, project_id: str, filename: str, data: bytes) -> bool:
        """Write a binary file to the Lower directory."""
        try:
            file_path = os.path.join(self.get_project_dir(project_id), filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(data)
            return True
        except (IOError, OSError) as e:
            log_error(f"[CacheManager] Failed to write bytes {filename}: {e}")
            return False

    # ============================================================
    # Cleanup
    # ============================================================

    def clean_project(self, project_id: str) -> None:
        """Clean up the cache directory for a project."""
        import shutil
        project_dir = self.get_project_dir(project_id)
        if os.path.exists(project_dir):
            shutil.rmtree(project_dir, ignore_errors=True)
            log_debug(f"[CacheManager] Cleaned cache for project {project_id}")

    def get_cache_size(self, project_id: str) -> int:
        """Get the total size of the project cache (bytes)."""
        total = 0
        project_dir = self.get_project_dir(project_id)
        for root, _, files in os.walk(project_dir):
            for f in files:
                total += os.path.getsize(os.path.join(root, f))
        return total

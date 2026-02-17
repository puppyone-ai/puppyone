"""
L2.5 Sync — CacheManager 本地缓存管理

负责管理本地 Lower 目录的缓存元数据：
- 读取/写入 .metadata.json（记录每个节点的同步时间戳）
- 管理目录结构
- 清理过期缓存

从 workspace/sync_worker.py 中提取的纯文件系统操作。
"""

import json
import os
from typing import Dict, Any, Optional

from src.utils.logger import log_error, log_debug


class CacheManager:
    """本地缓存目录管理"""

    def __init__(self, base_dir: str = "/tmp/contextbase"):
        self._base_dir = base_dir
        self._lower_dir = os.path.join(base_dir, "lower")
        os.makedirs(self._lower_dir, exist_ok=True)

    @property
    def lower_dir(self) -> str:
        return self._lower_dir

    def get_project_dir(self, project_id: str) -> str:
        """获取项目的 Lower 目录路径（自动创建）"""
        path = os.path.join(self._lower_dir, project_id)
        os.makedirs(path, exist_ok=True)
        return path

    # ============================================================
    # 元数据管理
    # ============================================================

    def read_metadata(self, project_id: str) -> Dict[str, Any]:
        """读取项目的同步元数据"""
        meta_path = os.path.join(self.get_project_dir(project_id), ".metadata.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {}

    def write_metadata(self, project_id: str, metadata: Dict[str, Any]) -> None:
        """写入项目的同步元数据"""
        meta_path = os.path.join(self.get_project_dir(project_id), ".metadata.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    # ============================================================
    # 文件写入
    # ============================================================

    def write_file(self, project_id: str, filename: str, content: str) -> bool:
        """写入文本文件到 Lower 目录"""
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
        """写入二进制文件到 Lower 目录"""
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
    # 清理
    # ============================================================

    def clean_project(self, project_id: str) -> None:
        """清理项目的缓存目录"""
        import shutil
        project_dir = self.get_project_dir(project_id)
        if os.path.exists(project_dir):
            shutil.rmtree(project_dir, ignore_errors=True)
            log_debug(f"[CacheManager] Cleaned cache for project {project_id}")

    def get_cache_size(self, project_id: str) -> int:
        """获取项目缓存的总大小（bytes）"""
        total = 0
        project_dir = self.get_project_dir(project_id)
        for root, _, files in os.walk(project_dir):
            for f in files:
                total += os.path.getsize(os.path.join(root, f))
        return total

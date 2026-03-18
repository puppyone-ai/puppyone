"""
MutRepoManager — per-project Mut repo 工厂

每个 PuppyOne project 对应一个 Mut "repo"，由以下组件构成:
  - ObjectStore (S3StorageBackend)  → 内容存储
  - HistoryManager (Supabase)       → 版本历史
  - AuditLog (Supabase)             → 审计日志

不使用 Mut 的 ServerRepo（它依赖本地文件系统），
而是直接组合 Mut core 模块 + 自定义后端。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from mut.core.object_store import ObjectStore
from mut.core.merge import ConflictResolver

from src.s3.service import S3Service
from src.supabase.client import SupabaseClient
from src.mut_core.backends.s3_storage import S3StorageBackend
from src.mut_core.backends.supabase_history import SupabaseHistoryManager
from src.mut_core.backends.supabase_audit import SupabaseAuditManager


@dataclass
class ProjectRepo:
    """一个 project 的 Mut repo 实例"""
    project_id: str
    store: ObjectStore
    history: SupabaseHistoryManager
    audit: SupabaseAuditManager
    resolver: ConflictResolver


class MutRepoManager:
    """管理所有 project 的 Mut repo 实例"""

    def __init__(self, s3: S3Service, supabase: SupabaseClient):
        self._s3 = s3
        self._supabase = supabase
        self._cache: dict[str, ProjectRepo] = {}
        self._lock = __import__("threading").Lock()

    def get_repo(self, project_id: str) -> ProjectRepo:
        if project_id in self._cache:
            return self._cache[project_id]
        with self._lock:
            if project_id not in self._cache:
                self._cache[project_id] = self._create_repo(project_id)
            return self._cache[project_id]

    def _create_repo(self, project_id: str) -> ProjectRepo:
        backend = S3StorageBackend(self._s3, project_id)
        store = ObjectStore(
            objects_dir=Path(f"/tmp/mut-stub/{project_id}"),
            backend=backend,
        )
        history = SupabaseHistoryManager(self._supabase, project_id)
        audit = SupabaseAuditManager(self._supabase, project_id)
        resolver = ConflictResolver()

        return ProjectRepo(
            project_id=project_id,
            store=store,
            history=history,
            audit=audit,
            resolver=resolver,
        )

    def init_repo(self, project_id: str) -> ProjectRepo:
        """初始化新 project 的 Mut repo 状态"""
        repo = self.get_repo(project_id)
        if repo.history.get_latest_version() == 0:
            repo.history.set_latest_version(0)
            repo.history.set_root_hash("")
        return repo

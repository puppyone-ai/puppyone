"""
MutRepoManager — per-project Mut repo factory

Each PuppyOne project corresponds to one Mut "repo", composed of:
  - ObjectStore (S3StorageBackend)  -> content storage
  - HistoryManager (Supabase)       -> version history
  - AuditLog (Supabase)             -> audit logs

Provides three repo views:
  - ProjectRepo       -> used by MutAdminService (admin/history operations)
  - PuppyOneServerRepo -> used by MUT protocol handlers (clone/push/pull)
  - HostClientHandle  -> long-lived in-process MUT client per (project, scope),
                         bundled with a per-key lock that serialises pushes
                         against the same scope. Cached so the costly clone
                         (full tree walk) only happens on first access; later
                         pushes reuse the cached scope tree state, mirroring
                         how a real `mut` CLI keeps its `.mut/` directory
                         between commits.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from mut.core.merge import ConflictResolver
from mut.core.object_store import ObjectStore

from src.infra.s3.service import S3Service
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data
from src.mut_engine.server.backends.s3_storage import CachedStorageBackend, S3StorageBackend
from src.mut_engine.server.backends.supabase_audit import SupabaseAuditManager
from src.mut_engine.server.backends.supabase_history import SupabaseHistoryManager
from src.mut_engine.server.backends.supabase_scope import SupabaseScopeBackend
from src.mut_engine.server.server_repo import PuppyOneServerRepo
from src.utils.logger import log_error

if TYPE_CHECKING:
    from src.mut_engine.services.ephemeral_client import MutEphemeralClient


@dataclass
class HostClientHandle:
    """A cached host-side MUT client + the lock used to serialise pushes.

    Lifetime: process-wide, per (project_id, scope_path). On first access
    the manager creates the client and runs ``clone_lite`` once to
    populate its ``_file_hashes`` tree map; subsequent accesses return
    the same instance so callers can ``push`` without re-cloning. The
    lock serialises concurrent writes against the same scope (within
    one process) so two requests don't race on the snapshot rebuild.
    """

    client: "MutEphemeralClient"
    lock: threading.Lock


@dataclass
class ProjectRepo:
    """A single project's Mut repo instance"""
    project_id: str
    store: ObjectStore
    history: SupabaseHistoryManager
    audit: SupabaseAuditManager
    resolver: ConflictResolver


class MutRepoManager:
    """Manages Mut repo instances for all projects"""

    def __init__(self, s3: S3Service, supabase: SupabaseClient):
        self._s3 = s3
        self._supabase = supabase
        self._cache: dict[str, ProjectRepo] = {}
        self._name_cache: dict[str, str] = {}
        self._lock = threading.Lock()
        # Host-side MUT clients keyed by (project_id, scope_path).
        # Created lazily on first push to that scope and reused for the
        # rest of the process lifetime. See HostClientHandle.
        self._host_clients: dict[tuple[str, str], HostClientHandle] = {}
        self._host_clients_lock = threading.Lock()

    def get_repo(self, project_id: str) -> ProjectRepo:
        if project_id in self._cache:
            return self._cache[project_id]
        with self._lock:
            if project_id not in self._cache:
                self._cache[project_id] = self._create_repo(project_id)
            return self._cache[project_id]

    def get_server_repo(self, project_id: str) -> PuppyOneServerRepo:
        """Create a PuppyOneServerRepo for MUT protocol handlers.

        Returns a NEW instance every time — PuppyOneServerRepo holds per-request
        mutable state (_pending_scope, _last_scope_build) that must not be shared
        across concurrent pushes. The expensive underlying components (store,
        history, audit) are shared via the cached ProjectRepo.
        """
        proj = self.get_repo(project_id)
        project_name = self._get_project_name(project_id)
        from mut.server.scope_manager import ScopeManager
        scope_backend = SupabaseScopeBackend(self._supabase, project_id)
        return PuppyOneServerRepo(
            project_id=project_id,
            project_name=project_name,
            store=proj.store,
            history=proj.history,
            audit=proj.audit,
            scopes=ScopeManager(scope_backend),
        )

    def get_host_client(
        self, project_id: str, scope_path: str, who: str = "puppyone-host",
    ) -> HostClientHandle:
        """Return the cached host MUT client for ``(project_id, scope_path)``.

        First access for a given key: create a fresh ``MutEphemeralClient``,
        run ``clone_lite`` to seed its ``_file_hashes`` from the scope's
        current tree (one-time cost — bounded by the number of tree
        nodes in the scope, blob bytes never touched), cache it with a
        dedicated lock, and return it.

        Subsequent accesses return the same handle so the caller can push
        modifications without re-cloning. The lock should be held while
        mutating the client (push) so concurrent requests against the
        same scope serialise cleanly within this process.

        Concurrency: uses double-checked locking so the slow
        ``clone_lite`` runs OUTSIDE ``_host_clients_lock``. Holding a
        single global lock during a multi-second clone would freeze
        every other scope's first-time access AND every pre-existing
        cache lookup, plus block uvicorn's graceful shutdown — that
        was the previous behaviour and it is what wedged the server.
        Trade-off: under a rare race two concurrent first-accesses for
        the *same* scope may both clone; the second's work is then
        discarded. That's wasted CPU, not a deadlock.

        ``who`` is used only for the FIRST clone's audit row. Per-push
        audit identity is set separately via
        ``client._set_audit_agent(who)`` inside the lock.
        """
        from src.mut_engine.services.ephemeral_client import MutEphemeralClient

        key = (project_id, scope_path or "")

        # Fast path: cache hit, return immediately under the lock.
        with self._host_clients_lock:
            cached = self._host_clients.get(key)
            if cached is not None:
                return cached

        # Slow path: build + clone OUTSIDE the lock so other scopes can
        # progress concurrently and a stuck clone can never freeze the
        # whole process.
        auth = {
            "agent": who,
            "_scope": {
                "id": who,
                "path": scope_path or "",
                "exclude": [],
                "mode": "rw",
            },
        }
        client = MutEphemeralClient(self, project_id, auth)
        client.clone_lite()
        new_handle = HostClientHandle(client=client, lock=threading.Lock())

        # Re-check under the lock: someone else may have populated the
        # cache while we were cloning. If so, drop our work and return
        # theirs — both clients would have produced equivalent state
        # anyway, but using one keeps the lock semantics correct.
        with self._host_clients_lock:
            existing = self._host_clients.get(key)
            if existing is not None:
                return existing
            self._host_clients[key] = new_handle
            return new_handle

    def invalidate_host_client(self, project_id: str, scope_path: str) -> None:
        """Drop the cached host client for ``(project_id, scope_path)``.

        Call after detecting the cached state is no longer in sync with
        the server (e.g. an external CLI client pushed). Next
        ``get_host_client`` call will re-clone fresh.
        """
        key = (project_id, scope_path or "")
        with self._host_clients_lock:
            self._host_clients.pop(key, None)

    def _create_repo(self, project_id: str) -> ProjectRepo:
        s3_backend = S3StorageBackend(self._s3, project_id)
        cached_backend = CachedStorageBackend(s3_backend)
        store = ObjectStore(
            objects_dir=Path(f"/tmp/mut-stub/{project_id}"),
            backend=cached_backend,
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

    def _get_project_name(self, project_id: str) -> str:
        """Get project name, cached to avoid per-request DB queries."""
        if project_id in self._name_cache:
            return self._name_cache[project_id]
        name = self._lookup_project_name(project_id)
        self._name_cache[project_id] = name
        return name

    def _lookup_project_name(self, project_id: str) -> str:
        try:
            resp = (
                self._supabase.client.table("projects")
                .select("name")
                .eq("id", project_id)
                .maybe_single()
                .execute()
            )
            data = safe_data(resp)
            if data:
                return data.get("name", "project")
            return "project"
        except Exception as e:
            log_error(f"[RepoManager] Failed to lookup project name: {e}")
            return "project"

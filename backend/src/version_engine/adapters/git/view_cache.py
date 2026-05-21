"""Durable per-view Git transport cache identity.

Git view caches are L6 derived protocol resources. They are consumed by the
Git smart-HTTP adapter, but PuppyOne's Version Engine remains the source of
truth for refs, history, audit, and object ownership.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


ProjectionVersion = Literal["git-view-v1"]
HistoryMode = Literal["full", "receive-boundary"]
BlobMode = Literal["included", "omitted"]


@dataclass(frozen=True)
class GitViewCacheKey:
    project_id: str
    object_store: str
    scope_path: str
    scope_excludes: tuple[str, ...]
    projection_version: ProjectionVersion
    history_mode: HistoryMode
    blob_mode: BlobMode

    @classmethod
    def from_repo(
        cls,
        repo,
        scope_path: str,
        scope_excludes: list[str] | None,
        *,
        follow_history: bool,
        include_blobs: bool,
    ) -> "GitViewCacheKey":
        return cls(
            project_id=str(getattr(repo, "_project_id", "") or "unknown-project"),
            object_store=object_store_namespace(repo),
            scope_path=scope_path or "",
            scope_excludes=tuple(sorted(scope_excludes or [])),
            projection_version="git-view-v1",
            history_mode="full" if follow_history else "receive-boundary",
            blob_mode="included" if include_blobs else "omitted",
        )

    @property
    def view_id(self) -> str:
        return hashlib.sha256(
            json.dumps(
                self.metadata_payload(),
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()

    @property
    def safe_project(self) -> str:
        return "".join(
            ch if ch.isalnum() or ch in {"-", "_"} else "_"
            for ch in self.project_id
        )[:80] or "unknown-project"

    def cache_dir(self) -> Path:
        return git_view_cache_root() / self.safe_project / self.view_id

    def metadata_payload(self) -> dict:
        return {
            "project_id": self.project_id,
            "object_store": self.object_store,
            "scope_path": self.scope_path,
            "scope_excludes": list(self.scope_excludes),
            "projection_version": self.projection_version,
            "history_mode": self.history_mode,
            "blob_mode": self.blob_mode,
        }


def git_view_cache_root() -> Path:
    env = os.getenv("PUPPYONE_GIT_VIEW_CACHE_DIR", "").strip()
    if env:
        return Path(env).expanduser()
    try:
        from src.config import settings

        return Path(settings.GIT_VIEW_CACHE_DIR).expanduser()
    except Exception:
        return Path("~/.puppyone/git-view-cache").expanduser()


def write_git_view_cache_metadata(
    cache_dir: Path,
    key: GitViewCacheKey,
    *,
    head: str,
    status: str = "ready",
    view_health: str = "",
    canonical_head: str = "",
    health_reason: str = "",
    history_cut: bool = False,
) -> None:
    metadata = {
        **key.metadata_payload(),
        "view_id": key.view_id,
        "cache_head": head,
        "status": status,
    }
    if view_health:
        metadata["view_health"] = view_health
    if canonical_head:
        metadata["canonical_head"] = canonical_head
    if health_reason:
        metadata["health_reason"] = health_reason
    if history_cut:
        metadata["history_cut"] = True
    (cache_dir / "view.json").write_text(
        json.dumps(metadata, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def invalidate_git_view_cache(key: GitViewCacheKey) -> None:
    cache_dir = key.cache_dir()
    root = git_view_cache_root().resolve()
    try:
        resolved = cache_dir.resolve()
    except FileNotFoundError:
        return
    if root not in {resolved, *resolved.parents}:
        raise ValueError(f"refusing to remove cache outside root: {cache_dir}")
    shutil.rmtree(cache_dir, ignore_errors=True)


def object_store_namespace(repo) -> str:
    store = getattr(repo, "store", None)
    store_dir = getattr(store, "dir", None)
    backend = getattr(store, "_backend", None)
    backend_namespace = _backend_namespace(backend)
    if backend_namespace:
        return backend_namespace
    if store_dir:
        return f"store-dir:{Path(store_dir).expanduser().resolve()}"
    project_id = str(getattr(repo, "_project_id", "") or "unknown-project")
    return f"project:{project_id}"


def _backend_namespace(backend) -> str:
    if backend is None:
        return ""
    inner = getattr(backend, "_inner", None)
    if inner is not None:
        inner_namespace = _backend_namespace(inner)
        if inner_namespace:
            return f"{backend.__class__.__name__}:{inner_namespace}"
    backend_dir = getattr(backend, "dir", None)
    if backend_dir:
        return f"{backend.__class__.__name__}:{Path(backend_dir).expanduser().resolve()}"
    prefix = getattr(backend, "_prefix", "")
    s3 = getattr(backend, "_s3", None)
    if prefix:
        bucket = getattr(s3, "bucket_name", "")
        endpoint = getattr(s3, "endpoint_url", "")
        region = getattr(s3, "region", "")
        return (
            f"{backend.__class__.__name__}:"
            f"{endpoint or region}:{bucket}:{prefix}"
        )
    return ""

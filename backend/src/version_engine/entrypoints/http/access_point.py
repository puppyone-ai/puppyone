"""
Access Point — credential resolution for scoped server access.

An Access Point is a credential (access key) that binds a client to
exactly one project + one scope (path / exclude / mode). The Git
adapter, the AP-FS HTTP API, and other protocol entry points all
resolve an incoming access key through ``resolve_access_point`` before
the engine sees any write intent.

URL surfaces that use access points are owned by the protocol adapters
themselves (see ``adapters/git/router.py`` for Git smart-HTTP and
``routers/access_point_fs.py`` for the FS CLI backend). This module no
longer mounts the old custom wire-protocol surface; access point traffic now
enters through Git smart HTTP or AP-FS.

An access key maps directly to a ``repo_scopes`` row. The row carries
everything the auth context needs:

  - project_id: which project to operate on
  - path / exclude / mode: scope geometry
  - access_key_revoked_at: null if active, timestamp if revoked
"""

from __future__ import annotations

import copy
import threading
import time

from fastapi import HTTPException

from src.utils.logger import log_error

_ACCESS_POINT_CACHE_TTL_SECONDS = 5.0
_access_point_cache: dict[str, tuple[float, str, dict]] = {}
_access_point_cache_lock = threading.Lock()


def _clone_auth_context(auth: dict) -> dict:
    return copy.deepcopy(auth)


def _get_cached_access_point(access_key: str) -> tuple[str, dict] | None:
    now = time.monotonic()
    with _access_point_cache_lock:
        cached = _access_point_cache.get(access_key)
        if cached is None:
            return None
        expires_at, project_id, auth = cached
        if expires_at <= now:
            _access_point_cache.pop(access_key, None)
            return None
        return project_id, _clone_auth_context(auth)


def _set_cached_access_point(access_key: str, project_id: str, auth: dict) -> None:
    with _access_point_cache_lock:
        _access_point_cache[access_key] = (
            time.monotonic() + _ACCESS_POINT_CACHE_TTL_SECONDS,
            project_id,
            _clone_auth_context(auth),
        )


def _resolve_via_repo_scopes(client, access_key: str) -> tuple[str, dict] | None:
    """Path A: post-redesign canonical lookup. Returns (project_id, auth) or
    None if the key isn't in repo_scopes. Raises 401 if the key IS in
    repo_scopes but is revoked (revocation must not silently fall through
    to another policy model)."""
    resp = (
        client.table("repo_scopes")
        .select("id, project_id, path, exclude, mode, access_key_revoked_at")
        .eq("access_key", access_key)
        .maybe_single()
        .execute()
    )
    if not resp or not getattr(resp, "data", None):
        return None
    scope_row = resp.data
    if scope_row.get("access_key_revoked_at"):
        raise HTTPException(status_code=401, detail="Access point key has been revoked")
    project_id = scope_row["project_id"]
    return project_id, {
        "agent": f"scope:{scope_row['id']}",
        "_scope": {
            "id": scope_row["id"],
            "path": scope_row.get("path", ""),
            "exclude": scope_row.get("exclude") or [],
            "mode": scope_row.get("mode", "rw"),
        },
        "_repo_facade": {
            "id": scope_row["id"],
            "kind": "access_point",
            "ref": "refs/heads/main",
            "object_store_scope": "project-shared",
        },
        "_project_id": project_id,
        "_user_identity": "",
    }


def resolve_access_point(access_key: str) -> tuple[str, dict]:
    """Resolve an access_key to (project_id, auth_context).

    ``repo_scopes`` is the canonical Access Point identity table. The old
    config-scope resolution path has been removed so credentials
    cannot resolve through two different policy models.

    Raises:
        HTTPException 401 if key is invalid / revoked / unknown.
    """
    cached = _get_cached_access_point(access_key)
    if cached is not None:
        return cached

    from src.infra.supabase.client import SupabaseClient
    client = SupabaseClient().client

    try:
        result = _resolve_via_repo_scopes(client, access_key)
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[AP] repo_scopes lookup error: {e}")
        raise HTTPException(status_code=401, detail="Invalid access point key") from e

    if result is not None:
        _set_cached_access_point(access_key, result[0], result[1])
        return result

    raise HTTPException(status_code=401, detail="Invalid access point key")

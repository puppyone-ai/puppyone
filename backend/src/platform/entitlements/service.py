from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from src.config import settings
from src.exceptions import AppException, ErrorCode
from src.platform.entitlements.models import EntitlementSnapshot, EntitlementUpsert
from src.platform.entitlements.repository import EntitlementRepository


MB = 1024 * 1024
GB = 1024 * MB

DEFAULT_HOSTED_PLAN_ENTITLEMENTS: dict[str, dict[str, Any]] = {
    "free": {
        "features": {
            "access_surface.agent": False,
            "access_surface.mcp": False,
            "access_surface.sandbox": False,
            "remote_workspace.create": False,
            "scope_sandbox.connect": False,
        },
        "limits": {
            "seats.max": 1,
            "projects.max": 1,
            "repo_scopes.max_per_project": 2,
            "access_surfaces.max_per_scope": 1,
            "access_surfaces.max_per_project": 2,
            "files.max_per_project": 2000,
            "storage.max_bytes": 1 * GB,
            "storage.max_bytes_per_project": 1 * GB,
            "upload.max_single_file_bytes": 50 * MB,
            "upload.max_batch_bytes": 1 * GB,
        },
        "allow": {
            "access_surface_kinds": ["git_remote", "cli", "direct"],
        },
    },
    "plus": {
        "features": {
            "access_surface.agent": False,
            "access_surface.mcp": True,
            "access_surface.sandbox": False,
            "remote_workspace.create": False,
            "scope_sandbox.connect": False,
        },
        "limits": {
            "seats.max": 10,
            "projects.max": 5,
            "repo_scopes.max_per_project": 10,
            "access_surfaces.max_per_scope": -1,
            "access_surfaces.max_per_project": -1,
            "files.max_per_project": 25000,
            "storage.max_bytes": 50 * GB,
            "storage.max_bytes_per_project": 10 * GB,
            "upload.max_single_file_bytes": 200 * MB,
            "upload.max_batch_bytes": 5 * GB,
        },
        "allow": {
            "access_surface_kinds": ["git_remote", "cli", "direct", "mcp"],
        },
    },
    "pro": {
        "features": {
            "access_surface.agent": False,
            "access_surface.mcp": True,
            "access_surface.sandbox": True,
            "remote_workspace.create": True,
            "scope_sandbox.connect": True,
        },
        "limits": {
            "seats.max": 50,
            "projects.max": 50,
            "repo_scopes.max_per_project": -1,
            "access_surfaces.max_per_scope": -1,
            "access_surfaces.max_per_project": -1,
            "files.max_per_project": 250000,
            "storage.max_bytes": 500 * GB,
            "storage.max_bytes_per_project": 50 * GB,
            "upload.max_single_file_bytes": 500 * MB,
            "upload.max_batch_bytes": 20 * GB,
        },
        "allow": {
            "access_surface_kinds": ["git_remote", "cli", "direct", "mcp", "sandbox"],
        },
    },
    "enterprise": {
        "features": {
            "access_surface.agent": False,
            "access_surface.mcp": True,
            "access_surface.sandbox": True,
            "remote_workspace.create": True,
            "scope_sandbox.connect": True,
        },
        "limits": {
            "seats.max": -1,
            "projects.max": -1,
            "repo_scopes.max_per_project": -1,
            "access_surfaces.max_per_scope": -1,
            "access_surfaces.max_per_project": -1,
            "files.max_per_project": -1,
            "storage.max_bytes": -1,
            "storage.max_bytes_per_project": -1,
            "upload.max_single_file_bytes": -1,
            "upload.max_batch_bytes": -1,
        },
        "allow": {
            "access_surface_kinds": "*",
        },
    },
}
DEFAULT_HOSTED_FREE_ENTITLEMENTS = DEFAULT_HOSTED_PLAN_ENTITLEMENTS["free"]


def _default_entitlements_for_plan(plan_id: str | None) -> dict[str, Any]:
    normalized = str(plan_id or "free").strip().lower()
    return DEFAULT_HOSTED_PLAN_ENTITLEMENTS.get(normalized, DEFAULT_HOSTED_FREE_ENTITLEMENTS)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _is_unlimited(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"", "unlimited", "infinite", "none", "-1"}
    return isinstance(value, (int, float)) and value < 0


@lru_cache(maxsize=1)
def _load_local_entitlements() -> dict[str, Any] | None:
    raw_path = (settings.LOCAL_ENTITLEMENTS_FILE or "").strip()
    if not raw_path:
        return None
    path = Path(raw_path).expanduser()
    if not path.exists():
        raise AppException(
            code=ErrorCode.INTERNAL_SERVER_ERROR,
            status_code=500,
            message=f"LOCAL_ENTITLEMENTS_FILE does not exist: {path}",
        )
    with path.open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise AppException(
            code=ErrorCode.INTERNAL_SERVER_ERROR,
            status_code=500,
            message="LOCAL_ENTITLEMENTS_FILE must contain a JSON object",
        )
    return loaded


class EntitlementService:
    def __init__(self, repository: EntitlementRepository | None = None):
        self._repository = repository

    @property
    def enabled(self) -> bool:
        return settings.ENTITLEMENTS_MODE != "disabled"

    @property
    def _repo(self) -> EntitlementRepository:
        if self._repository is None:
            self._repository = EntitlementRepository()
        return self._repository

    def get_snapshot(self, org_id: str) -> EntitlementSnapshot:
        # Per-request memo (set by RequestContextMiddleware): collapse the
        # repeated snapshot fetches that the entitlement gates do within one
        # request (each require_*/limit_value/feature_enabled calls this) down
        # to a single fetch. Falls through to a direct fetch off-request
        # (workers/scripts) where the contextvar is unset.
        from src.utils.request_context import entitlement_snapshot_cache_var

        cache = entitlement_snapshot_cache_var.get()
        if cache is not None and org_id in cache:
            return cache[org_id]
        snapshot = self._compute_snapshot(org_id)
        if cache is not None:
            cache[org_id] = snapshot
        return snapshot

    def _compute_snapshot(self, org_id: str) -> EntitlementSnapshot:
        if not self.enabled:
            return EntitlementSnapshot(
                org_id=org_id,
                plan_id="disabled",
                status="active",
                source="system",
                entitlements={"features": {}, "limits": {}, "allow": {}},
            )

        if settings.ENTITLEMENTS_MODE == "local":
            loaded = _load_local_entitlements() or {}
            org_overrides = loaded.get("orgs", {}).get(org_id, {})
            default_entitlements = loaded.get("default", loaded)
            base_entitlements = _default_entitlements_for_plan(
                str(loaded.get("plan_id", "free")),
            )
            entitlements = _deep_merge(
                base_entitlements,
                _deep_merge(default_entitlements, org_overrides),
            )
            return EntitlementSnapshot(
                org_id=org_id,
                plan_id=str(loaded.get("plan_id", "local")),
                status="active",
                source="local",
                entitlements=entitlements,
            )

        snapshot = self._repo.get_by_org_id(org_id)
        if snapshot is None:
            return EntitlementSnapshot(
                org_id=org_id,
                plan_id="free",
                status="free",
                source="system",
                entitlements=copy.deepcopy(_default_entitlements_for_plan("free")),
            )
        snapshot.entitlements = _deep_merge(
            _default_entitlements_for_plan(snapshot.plan_id),
            snapshot.entitlements,
        )
        return snapshot

    def upsert(self, payload: EntitlementUpsert) -> EntitlementSnapshot:
        return self._repo.upsert(payload)

    def feature_enabled(self, org_id: str, feature_key: str) -> bool:
        if not self.enabled:
            return True
        snapshot = self.get_snapshot(org_id)
        value = (snapshot.entitlements.get("features") or {}).get(feature_key)
        return bool(value)

    def require_feature(self, org_id: str, feature_key: str) -> None:
        if self.feature_enabled(org_id, feature_key):
            return
        snapshot = self.get_snapshot(org_id)
        self._raise_denied(
            org_id=org_id,
            plan_id=snapshot.plan_id,
            reason="feature_not_enabled",
            feature=feature_key,
        )

    def limit_value(self, org_id: str, limit_key: str) -> int | float | None:
        if not self.enabled:
            return None
        snapshot = self.get_snapshot(org_id)
        raw = (snapshot.entitlements.get("limits") or {}).get(limit_key)
        if _is_unlimited(raw):
            return None
        if isinstance(raw, bool):
            return int(raw)
        if isinstance(raw, (int, float)):
            return raw
        if isinstance(raw, str):
            try:
                return int(raw)
            except ValueError:
                try:
                    return float(raw)
                except ValueError as exc:
                    raise AppException(
                        code=ErrorCode.INTERNAL_SERVER_ERROR,
                        status_code=500,
                        message=f"Invalid entitlement limit value for {limit_key}: {raw}",
                    ) from exc
        return None

    def require_capacity(self, org_id: str, limit_key: str, current_count: int) -> None:
        maximum = self.limit_value(org_id, limit_key)
        if maximum is None or current_count < maximum:
            return
        snapshot = self.get_snapshot(org_id)
        self._raise_denied(
            org_id=org_id,
            plan_id=snapshot.plan_id,
            reason="limit_exceeded",
            limit=limit_key,
            current=current_count,
            maximum=maximum,
        )

    def require_allowed(self, org_id: str, allow_key: str, requested_value: str) -> None:
        if not self.enabled:
            return
        snapshot = self.get_snapshot(org_id)
        allowed = (snapshot.entitlements.get("allow") or {}).get(allow_key)
        if allowed == "*" or (isinstance(allowed, list) and requested_value in allowed):
            return
        self._raise_denied(
            org_id=org_id,
            plan_id=snapshot.plan_id,
            reason="value_not_allowed",
            allow=allow_key,
            requested=requested_value,
            allowed=allowed or [],
        )

    def _raise_denied(
        self,
        *,
        org_id: str,
        plan_id: str,
        reason: str,
        **details: Any,
    ) -> None:
        raise AppException(
            code=ErrorCode.FORBIDDEN,
            status_code=403,
            message="Entitlement required",
            details={
                "code": "entitlement_required",
                "org_id": org_id,
                "plan_id": plan_id,
                "reason": reason,
                **details,
            },
        )

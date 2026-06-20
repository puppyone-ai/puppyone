"""Resolve MCP endpoint keys into scoped filesystem contexts."""

from __future__ import annotations

from fastapi import HTTPException

from src.connectors.mcp_endpoint.repository import McpEndpointRepository
from src.infra.supabase.dependencies import get_supabase_client

from .context import ScopedFsContext
from .policy import resolve_mcp_fs_allowed_tools


def _list_project_scopes(project_id: str) -> list[dict]:
    """All scope rows (path only) for the project — input for carved-exclude
    computation. Fail-open to [] on lookup error, matching the admission path."""
    try:
        sb = get_supabase_client()
        resp = sb.table("repo_scopes").select("path").eq("project_id", project_id).execute()
        return resp.data or []
    except Exception as exc:  # noqa: BLE001 — carving must not break reads on a DB hiccup
        from src.utils.logger import log_warning
        log_warning(
            f"[scoped_fs.resolver] scope list lookup failed for project={project_id}: "
            f"{exc}; carved excludes skipped"
        )
        return []


def _merge_scope_excludes(user_excludes, scope_path: str, all_scopes: list[dict]) -> list[str]:
    """Merge user-configured excludes with carved child-scope paths (GAP-4).

    A non-root MCP scope must hide its declared child scopes — the same isolation
    the git/CLI admission path applies via ``compute_carved_excludes``. Without
    this an MCP key bound to a parent scope could ``ls``/``cat``/``grep`` into its
    child scopes' subtrees. The root scope (``scope_path == ""``) is the
    project-wide view and intentionally carves nothing.
    """
    from src.version_engine.admission.repo_facade import compute_carved_excludes
    carved = list(compute_carved_excludes(scope_path, all_scopes))
    return list(dict.fromkeys(list(user_excludes) + carved))


def resolve_mcp_scoped_fs_context(api_key: str) -> ScopedFsContext:
    key = (api_key or "").strip()
    if not key.startswith("mcp_"):
        raise HTTPException(status_code=401, detail="Invalid MCP API key")

    endpoint = McpEndpointRepository().get_by_api_key(key)
    if not endpoint:
        raise HTTPException(status_code=404, detail="MCP endpoint not found")
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="MCP endpoint is not active")

    scope_id = endpoint.get("scope_id")
    if not scope_id:
        raise HTTPException(status_code=403, detail="MCP endpoint is not bound to a scope")

    sb = get_supabase_client()
    scope_resp = (
        sb.table("repo_scopes")
        .select("id, project_id, name, path, exclude, mode")
        .eq("id", scope_id)
        .limit(1)
        .execute()
    )
    scope_rows = scope_resp.data or []
    if not scope_rows:
        raise HTTPException(status_code=403, detail="MCP endpoint scope not found")
    scope = scope_rows[0]

    accesses = endpoint.get("accesses") or []
    access_writable = any(not bool(access.get("readonly", True)) for access in accesses)
    mode = "rw" if scope.get("mode") == "rw" and access_writable else "ro"
    allowed_tools = resolve_mcp_fs_allowed_tools(
        endpoint.get("tools_config"),
        writable=mode == "rw",
    )

    user_id = endpoint.get("created_by") or ""
    if not user_id:
        project_resp = (
            sb.table("projects")
            .select("created_by")
            .eq("id", endpoint["project_id"])
            .limit(1)
            .execute()
        )
        project_rows = project_resp.data or []
        user_id = project_rows[0].get("created_by") if project_rows else ""

    scope_path = (scope.get("path") or "").strip("/")
    exclude = _merge_scope_excludes(
        scope.get("exclude") or [],
        scope_path,
        _list_project_scopes(endpoint["project_id"]),
    )

    return ScopedFsContext(
        api_key=key,
        endpoint_id=endpoint["id"],
        endpoint_name=endpoint.get("name") or "MCP Endpoint",
        project_id=endpoint["project_id"],
        user_id=user_id or "",
        scope_id=scope["id"],
        scope_path=scope_path,
        mode=mode,
        exclude=exclude,
        allowed_tools=allowed_tools,
    )

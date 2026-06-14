"""Resolve MCP endpoint keys into scoped filesystem contexts."""

from __future__ import annotations

from fastapi import HTTPException

from src.infra.supabase.dependencies import get_supabase_client

from .context import ScopedFsContext


def resolve_mcp_scoped_fs_context(api_key: str) -> ScopedFsContext:
    key = (api_key or "").strip()
    if not key.startswith("mcp_"):
        raise HTTPException(status_code=401, detail="Invalid MCP API key")

    sb = get_supabase_client()
    endpoint_resp = (
        sb.table("access_surfaces")
        .select("*")
        .eq("kind", "mcp")
        .filter("config->>api_key", "eq", key)
        .limit(1)
        .execute()
    )
    endpoint_rows = endpoint_resp.data or []
    if not endpoint_rows:
        raise HTTPException(status_code=404, detail="MCP endpoint not found")
    endpoint = endpoint_rows[0]
    if endpoint.get("status") != "active":
        raise HTTPException(status_code=403, detail="MCP endpoint is not active")

    scope_id = endpoint.get("scope_id")
    if not scope_id:
        raise HTTPException(status_code=403, detail="MCP endpoint is not bound to a scope")

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

    config = endpoint.get("config") or {}
    accesses = config.get("accesses") or []
    access_writable = any(not bool(access.get("readonly", True)) for access in accesses)
    mode = "rw" if scope.get("mode") == "rw" and access_writable else "ro"

    user_id = endpoint.get("created_by") or config.get("created_by") or ""
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

    return ScopedFsContext(
        api_key=key,
        endpoint_id=endpoint["id"],
        endpoint_name=endpoint.get("name") or config.get("name") or "MCP Endpoint",
        project_id=endpoint["project_id"],
        user_id=user_id or "",
        scope_id=scope["id"],
        scope_path=(scope.get("path") or "").strip("/"),
        mode=mode,
        exclude=scope.get("exclude") or [],
    )

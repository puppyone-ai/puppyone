"""Workspace Access API.

Access manages scope-bound ways to enter or operate on a workspace:
Git remote, FS CLI, agents, MCP endpoints, and sandboxes.
External source relationships belong to Integration, not this router.
"""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse
from src.exceptions import ErrorCode, NotFoundException
from src.infra.supabase.client import SupabaseClient
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.entitlements.dependencies import get_entitlement_service
from src.platform.entitlements.service import EntitlementService
from src.platform.organization.dependencies import resolve_org_ids
from src.repo.access_surface_repository import AccessSurfaceRepository
from src.repo.scope_service import ScopeService

router = APIRouter(prefix="/access", tags=["access"])


# ── Schemas ─────────────────────────────────────────────────

class ConnectionOut(BaseModel):
    id: str
    project_id: str
    provider: str
    name: str | None = None
    path: str | None = None
    node_name: str | None = None
    direction: str | None = None
    status: str = "active"
    access_key: str | None = None
    gateway_id: str | None = None
    trigger: dict | None = None
    last_synced_at: str | None = None
    error_message: str | None = None
    config: dict | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ConnectionUpdate(BaseModel):
    status: str | None = None
    trigger: dict | None = None
    config: dict | None = None


# ── Helpers ─────────────────────────────────────────────────

def _get_client():
    return SupabaseClient().client


def _count_user_access_surfaces_for_project(sb_client, project_id: str) -> int:
    resp = (
        sb_client.table("access_surfaces")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .not_.in_("kind", ["git_remote", "cli"])
        .execute()
    )
    return resp.count or 0


def _normalize_scope_path(path: str | None) -> str:
    value = (path or "").strip()
    while value.startswith("/"):
        value = value[1:]
    while value.endswith("/"):
        value = value[:-1]
    while "//" in value:
        value = value.replace("//", "/")
    return value


def _scope_rows_for_surfaces(sb_client, rows: list[dict]) -> dict[str, dict]:
    scope_ids = sorted({r.get("scope_id") for r in rows if r.get("scope_id")})
    if not scope_ids:
        return {}
    resp = (
        sb_client.table("repo_scopes")
        .select("*")
        .in_("id", scope_ids)
        .execute()
    )
    return {r["id"]: r for r in (resp.data or [])}


def _scope_for_path(
    project_id: str,
    path: str | None,
    *,
    name: str | None = None,
    exclude: list[str] | None = None,
    mode: str = "rw",
) -> dict:
    target = _normalize_scope_path(path)
    scope_service = ScopeService()
    if target == "":
        scope = scope_service.ensure_root_scope(project_id)
        return {
            "id": scope.id,
            "project_id": scope.project_id,
            "name": scope.name,
            "path": scope.path,
            "access_key": scope.access_key,
        }
    for scope in scope_service.list_for_project(project_id):
        if _normalize_scope_path(scope.path) == target:
            return {
                "id": scope.id,
                "project_id": scope.project_id,
                "name": scope.name,
                "path": scope.path,
                "access_key": scope.access_key,
            }
    scope = scope_service.create(
        project_id=project_id,
        name=name or target.rsplit("/", 1)[-1] or "Scope",
        path=target,
        exclude=exclude or [],
        mode=mode,
    )
    return {
        "id": scope.id,
        "project_id": scope.project_id,
        "name": scope.name,
        "path": scope.path,
        "access_key": scope.access_key,
    }


def _access_key_for(row: dict, scope: dict | None) -> str | None:
    cfg = row.get("config") or {}
    provider = row.get("kind", row.get("provider", ""))
    if provider in {"git_remote", "cli"}:
        return (scope or {}).get("access_key")
    if provider == "agent":
        return cfg.get("mcp_api_key") or cfg.get("access_key")
    if provider == "mcp":
        return None
    if provider == "sandbox":
        return cfg.get("access_key")
    return cfg.get("access_key")


def _created_or_updated(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _enrich(rows: list[dict], sb_client) -> list[ConnectionOut]:
    """Resolve node names from paths and extract config.name for display.

    Auto-disambiguates duplicate display names by appending path or a counter,
    so users can tell apart multiple connections of the same provider type.
    """
    scopes = _scope_rows_for_surfaces(sb_client, rows)
    # First pass: build raw entries
    entries = []
    for r in rows:
        cfg = r.get("config") or {}
        scope = scopes.get(r.get("scope_id"))
        kind = r.get("kind", r.get("provider", ""))
        base_name = r.get("name") or cfg.get("name") or cfg.get("sync_url") or kind
        node_path = _normalize_scope_path((scope or {}).get("path"))
        node_name = node_path.rsplit("/", 1)[-1] if node_path else None
        entries.append({
            "row": r,
            "cfg": cfg,
            "scope": scope,
            "base_name": base_name,
            "node_path": node_path,
            "node_name": node_name,
        })

    # Second pass: detect duplicates and disambiguate names
    from collections import Counter
    name_counts = Counter(e["base_name"] for e in entries)
    name_seen: dict[str, int] = {}

    out: list[ConnectionOut] = []
    for e in entries:
        r = e["row"]
        base_name = e["base_name"]
        node_path = e["node_path"]

        if name_counts[base_name] > 1:
            # Disambiguate: prefer path suffix, fall back to counter
            if node_path:
                display_path = node_path.strip("/")
                disambig = display_path if display_path else "root"
                name = f"{base_name} ({disambig})"
            else:
                name_seen[base_name] = name_seen.get(base_name, 0) + 1
                name = f"{base_name} #{name_seen[base_name]}"
        else:
            name = base_name

        out.append(ConnectionOut(
            id=r["id"],
            project_id=r["project_id"],
            provider=kind,
            name=name,
            path=node_path or None,
            node_name=e["node_name"],
            direction=cfg.get("direction"),
            status=r.get("status", "active"),
            access_key=_access_key_for(r, e["scope"]),
            gateway_id=(e["cfg"].get("gateway_id") if isinstance(e["cfg"], dict) else None),
            trigger=cfg.get("trigger"),
            last_synced_at=_created_or_updated(cfg.get("last_seen_at") or cfg.get("last_run_at")),
            error_message=cfg.get("error_message"),
            config=e["cfg"],
            created_at=_created_or_updated(r.get("created_at")),
            updated_at=_created_or_updated(r.get("updated_at")),
        ))
    return out


def _get_user_project_ids(sb_client, org_ids: list[str]) -> list[str]:
    """Get all project IDs across the user's organizations.

    NOTE: This relies on resolve_org_ids() which queries org_members for the
    user.  If a user was added to an org but their org_members row is missing
    (e.g. RLS policy prevents the service-role read, or the invite flow didn't
    insert a row), they will get zero org_ids and therefore zero project_ids,
    causing 404 on access-point mutations.  This is a data/RLS issue, not a
    code bug — ensure org_members rows exist for all invited users.
    """
    if not org_ids:
        return []
    resp = (
        sb_client.table("projects")
        .select("id")
        .in_("org_id", org_ids)
        .execute()
    )
    return [r["id"] for r in resp.data]


# ── Endpoints ───────────────────────────────────────────────

@router.get(
    "/",
    response_model=ApiResponse[list[ConnectionOut]],
    summary="List all access connections",
    status_code=status.HTTP_200_OK,
)
def list_connections(
    project_id: str | None = Query(None),
    provider: str | None = Query(None),
    connection_status: str | None = Query(None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()
    org_ids = resolve_org_ids(None, current_user.user_id)

    if project_id:
        project_ids = [project_id]
    else:
        project_ids = _get_user_project_ids(sb, org_ids)

    if not project_ids:
        return ApiResponse.success(data=[], message="No access connections")

    query = sb.table("access_surfaces").select("*")

    if len(project_ids) == 1:
        query = query.eq("project_id", project_ids[0])
    else:
        query = query.in_("project_id", project_ids)

    if provider:
        query = query.eq("kind", provider)
    if connection_status:
        query = query.eq("status", connection_status)

    rows = query.order("created_at").execute().data
    return ApiResponse.success(data=_enrich(rows, sb), message="Access connections listed")


@router.get(
    "/{connection_id}",
    response_model=ApiResponse[ConnectionOut],
    summary="Get access connection details",
    status_code=status.HTTP_200_OK,
)
def get_connection(
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()
    resp = sb.table("access_surfaces").select("*").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    # Verify user has access via org membership
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    return ApiResponse.success(data=_enrich([row], sb)[0], message="Access connection found")


@router.patch(
    "/{connection_id}",
    response_model=ApiResponse[ConnectionOut],
    summary="Update access connection (status, trigger, config)",
    status_code=status.HTTP_200_OK,
)
async def update_connection(
    payload: ConnectionUpdate,
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()

    resp = (
        sb.table("access_surfaces")
        .select("*")
        .eq("id", connection_id)
        .execute()
    )
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    fields: dict[str, Any] = {}
    if payload.status is not None:
        fields["status"] = payload.status
    if payload.config is not None:
        cfg = dict(row.get("config") or {})
        cfg.update(payload.config)
        fields["config"] = cfg
    if payload.trigger is not None:
        cfg = dict(fields.get("config") or row.get("config") or {})
        cfg["trigger"] = payload.trigger
        fields["config"] = cfg

    sb.table("access_surfaces").update(fields).eq("id", connection_id).execute()

    updated = sb.table("access_surfaces").select("*").eq("id", connection_id).execute()
    return ApiResponse.success(data=_enrich(updated.data, sb)[0], message="Access connection updated")


@router.delete(
    "/{connection_id}",
    response_model=ApiResponse[None],
    summary="Delete access connection",
    status_code=status.HTTP_200_OK,
)
async def delete_connection(
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()

    resp = sb.table("access_surfaces").select("project_id, kind").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if resp.data[0]["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    if resp.data[0].get("kind") in {"git_remote", "cli"}:
        raise HTTPException(status_code=400, detail="Built-in access surfaces cannot be deleted")
    AccessSurfaceRepository().delete(connection_id)
    return ApiResponse.success(message="Access connection deleted")


@router.patch(
    "/{connection_id}/rename",
    response_model=ApiResponse[ConnectionOut],
    summary="Rename an access connection display name",
    status_code=status.HTTP_200_OK,
)
def rename_connection(
    connection_id: str = Path(...),
    body: dict = Body(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Update only the display name stored in config.name."""
    new_name = (body.get("name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="name must not be empty")

    sb = _get_client()
    resp = sb.table("access_surfaces").select("*").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    cfg = dict(row.get("config") or {})
    cfg["name"] = new_name
    cfg["name"] = new_name
    sb.table("access_surfaces").update({"name": new_name, "config": cfg}).eq("id", connection_id).execute()

    updated = sb.table("access_surfaces").select("*").eq("id", connection_id).execute()
    return ApiResponse.success(data=_enrich(updated.data, sb)[0], message="Access connection renamed")


@router.post(
    "/{connection_id}/regenerate-key",
    response_model=ApiResponse[dict],
    summary="Regenerate access key for an access connection",
    status_code=status.HTTP_200_OK,
)
def regenerate_key(
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()

    resp = sb.table("access_surfaces").select("*").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    provider = row.get("kind", row.get("provider", ""))
    if provider in {"git_remote", "cli"}:
        new_key = ScopeService().regenerate_access_key(row["scope_id"])
        if not new_key:
            raise NotFoundException("Scope not found", code=ErrorCode.NOT_FOUND)
        surfaces = (
            sb.table("access_surfaces")
            .select("*")
            .eq("scope_id", row["scope_id"])
            .in_("kind", ["git_remote", "cli"])
            .execute()
        ).data or []
        for surface in surfaces:
            cfg = dict(surface.get("config") or {})
            cfg["access_key"] = new_key
            sb.table("access_surfaces").update({"config": cfg}).eq("id", surface["id"]).execute()
        return ApiResponse.success(data={"access_key": new_key}, message="Key regenerated")
    if provider == "sandbox":
        prefix = "sbx"
        key_field = "access_key"
    elif provider == "mcp":
        from src.connectors.mcp_endpoint.repository import McpEndpointRepository
        from src.connectors.mcp_endpoint.service import McpEndpointService

        endpoint = McpEndpointService(repository=McpEndpointRepository()).regenerate_key(connection_id)
        if not endpoint or not endpoint.get("api_key"):
            raise NotFoundException("MCP endpoint not found", code=ErrorCode.NOT_FOUND)
        return ApiResponse.success(
            data={
                "access_key": endpoint["api_key"],
                "access_key_hint": endpoint.get("api_key_hint"),
            },
            message="Key regenerated",
        )
    elif provider == "agent":
        prefix = "cli"
        key_field = "mcp_api_key"
    else:
        prefix = "key"
        key_field = "access_key"

    new_key = f"{prefix}_{secrets.token_urlsafe(32)}"
    cfg = dict(row.get("config") or {})
    cfg[key_field] = new_key
    sb.table("access_surfaces").update({"config": cfg}).eq("id", connection_id).execute()

    return ApiResponse.success(data={"access_key": new_key}, message="Key regenerated")


# ── Connection Types (unified) ─────────────────────────────

@router.get(
    "/types",
    response_model=ApiResponse,
    summary="List all available access types",
    status_code=status.HTTP_200_OK,
)
def list_connection_types():
    """
    Returns available workspace Access surface types.
    """
    access_types = [
        {
            "provider": "direct",
            "display_name": "Git Remote",
            "description": "Scoped Git remote and CLI credentials",
            "auth": "access_key",
            "creation_mode": "direct",
            "category": "access",
            "icon": "git-branch",
        },
        {
            "provider": "agent",
            "display_name": "Chat Agent",
            "description": "Interactive AI assistant with data access",
            "auth": "none",
            "creation_mode": "direct",
            "category": "access",
            "icon": "bot",
        },
        {
            "provider": "mcp",
            "display_name": "MCP Server",
            "description": "Model Context Protocol endpoint",
            "auth": "none",
            "creation_mode": "direct",
            "category": "access",
            "icon": "plug",
        },
        {
            "provider": "sandbox",
            "display_name": "Sandbox",
            "description": "Isolated script execution environment",
            "auth": "none",
            "creation_mode": "direct",
            "category": "access",
            "icon": "box",
        },
    ]

    return ApiResponse.success(data=access_types)


# ── Unified Create ─────────────────────────────────────────

class UnifiedConnectionCreate(BaseModel):
    """
    Single request schema for creating ANY access type.
    The `provider` field determines which service handles creation.
    """
    project_id: str = Field(..., description="Project ID")
    provider: str = Field(..., description="Access type: gmail, github, agent, mcp, sandbox, ...")
    name: str | None = Field(None, description="Display name")
    path: str | None = Field(None, description="Target version path")
    config: dict = Field(default_factory=dict, description="Provider-specific configuration")
    gateway_id: str | None = Field(None, description="Gateway ID (required for datasource providers)")
    direction: str | None = Field(None, description="Sync direction (datasource only)")
    trigger: dict | None = Field(None, description="Trigger config (datasource/agent)")
    credentials_ref: str | None = Field(None, description="OAuth credentials reference (datasource)")
    sync_mode: str | None = Field(None, description="Sync mode: manual, scheduled, realtime (datasource)")
    conflict_strategy: str | None = Field(None, description="Conflict strategy (datasource)")
    accesses: list[dict] | None = Field(None, description="Node access bindings (agent/mcp)")
    tools_config: list[dict] | None = Field(None, description="Tool bindings (mcp)")


class UnifiedConnectionOut(BaseModel):
    id: str
    project_id: str
    provider: str
    name: str | None = None
    status: str = "active"
    gateway_id: str | None = None
    access_key: str | None = None
    ap_base: str | None = None


def _create_agent(payload: UnifiedConnectionCreate) -> UnifiedConnectionOut:
    from src.connectors.agent.config.repository import AgentRepository
    from src.connectors.agent.config.schemas import AgentBashCreate
    from src.connectors.agent.config.service import AgentConfigService

    service = AgentConfigService(repository=AgentRepository())

    bash_accesses = []
    if payload.accesses:
        bash_accesses = [
            AgentBashCreate(
                path=a["path"],
                readonly=a.get("readonly", a.get("terminal_readonly", True)),
            )
            for a in payload.accesses
        ]

    cfg = payload.config
    agent = service.create_agent(
        project_id=payload.project_id,
        name=payload.name or cfg.get("name", "Chat Agent"),
        icon=cfg.get("icon", "✨"),
        type=cfg.get("type", "chat"),
        description=cfg.get("description"),
        bash_accesses=bash_accesses,
        trigger_type=cfg.get("trigger_type", "manual"),
        trigger_config=cfg.get("trigger_config"),
        task_content=cfg.get("task_content"),
        task_path=cfg.get("task_path"),
        external_config=cfg.get("external_config"),
    )
    return UnifiedConnectionOut(
        id=agent.id,
        project_id=payload.project_id,
        provider="agent",
        name=agent.name,
        status="active",
    )


def _create_mcp(payload: UnifiedConnectionCreate, *, created_by: str | None = None) -> UnifiedConnectionOut:
    from src.connectors.mcp_endpoint.repository import McpEndpointRepository
    from src.connectors.mcp_endpoint.schemas import McpAccessItem, McpToolItem
    from src.connectors.mcp_endpoint.service import McpEndpointService

    service = McpEndpointService(repository=McpEndpointRepository())

    accesses = [McpAccessItem(**a) for a in (payload.accesses or [])]
    tools = [McpToolItem(**t) for t in (payload.tools_config or [])]

    row = service.create_endpoint(
        project_id=payload.project_id,
        name=payload.name or payload.config.get("name", "MCP Endpoint"),
        path=payload.path,
        description=payload.config.get("description"),
        accesses=accesses,
        tools_config=tools,
        created_by=created_by,
    )
    return UnifiedConnectionOut(
        id=row["id"],
        project_id=row["project_id"],
        provider="mcp",
        name=row["name"],
        status=row["status"],
    )


def _create_sandbox(payload: UnifiedConnectionCreate) -> UnifiedConnectionOut:
    from src.connectors.sandbox_endpoint.repository import SandboxEndpointRepository
    from src.connectors.sandbox_endpoint.schemas import SandboxMountItem, SandboxResourceLimits
    from src.connectors.sandbox_endpoint.service import SandboxEndpointService

    service = SandboxEndpointService(repository=SandboxEndpointRepository())

    cfg = payload.config
    mounts = [SandboxMountItem(**m) for m in cfg.get("mounts", [])] or None
    resource_limits = SandboxResourceLimits(**cfg["resource_limits"]) if cfg.get("resource_limits") else None

    row = service.create_endpoint(
        project_id=payload.project_id,
        name=payload.name or cfg.get("name", "Sandbox"),
        path=payload.path,
        description=cfg.get("description"),
        mounts=mounts,
        runtime=cfg.get("runtime", "alpine"),
        timeout_seconds=cfg.get("timeout_seconds", 30),
        resource_limits=resource_limits,
    )
    return UnifiedConnectionOut(
        id=row["id"],
        project_id=row["project_id"],
        provider="sandbox",
        name=row["name"],
        status=row["status"],
    )


def _create_direct(payload: UnifiedConnectionCreate) -> UnifiedConnectionOut:
    """Return direct Git + FS HTTP API credentials for a scope."""
    sb = _get_client()
    cfg = payload.config
    scope = cfg.get("scope", {})
    scope_path = scope.get("path", payload.path or "") if isinstance(scope, dict) else (payload.path or "")
    mode = scope.get("mode", "rw") if isinstance(scope, dict) else "rw"
    exclude = scope.get("exclude", []) if isinstance(scope, dict) else []
    scope_row = _scope_for_path(
        payload.project_id,
        scope_path,
        name=payload.name or "Direct Access",
        exclude=list(exclude or []),
        mode=mode,
    )
    surface_resp = (
        sb.table("access_surfaces")
        .select("id, status")
        .eq("scope_id", scope_row["id"])
        .eq("kind", "git_remote")
        .limit(1)
        .execute()
    )
    if not surface_resp.data:
        scope_model = ScopeService().get(scope_row["id"])
        if scope_model is None:
            raise RuntimeError("scope disappeared while creating direct access")
        AccessSurfaceRepository().ensure_scope_defaults(scope_model)
        surface_resp = (
            sb.table("access_surfaces")
            .select("id, status")
            .eq("scope_id", scope_row["id"])
            .eq("kind", "git_remote")
            .limit(1)
            .execute()
        )
    if not surface_resp.data:
        raise RuntimeError("git_remote access surface was not created")
    surface = surface_resp.data[0]

    return UnifiedConnectionOut(
        id=surface["id"],
        project_id=payload.project_id,
        provider="direct",
        name=payload.name or "Direct Access",
        status=surface.get("status", "active"),
        access_key=scope_row["access_key"],
        ap_base=f"/git/ap/{scope_row['access_key']}.git",
    )


@router.post(
    "/",
    response_model=ApiResponse[UnifiedConnectionOut],
    summary="Create any access type",
    status_code=status.HTTP_201_CREATED,
)
async def create_connection(
    payload: UnifiedConnectionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    entitlement_service: EntitlementService = Depends(get_entitlement_service),
):
    """
    Unified entry point for creating Access surfaces.
    Routes to the appropriate service based on `provider`.

    - agent: creates a chat agent
    - mcp: creates an MCP endpoint
    - sandbox: creates a sandbox endpoint
    - direct: returns scoped Git Remote and FS CLI credentials
    """
    from src.platform.project.repository import ProjectRepositorySupabase
    project_repo = ProjectRepositorySupabase()
    if not project_repo.verify_project_access(payload.project_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied to this project")
    project = project_repo.get_by_id(payload.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    provider = payload.provider.lower()
    if provider not in {"agent", "mcp", "sandbox", "direct"}:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown access provider: {provider}. Use Integration APIs "
                "for external datasource connections."
            ),
        )

    # ── Duplicate detection ────────────────────────────────────────
    # Block creation if an identical access surface already exists.
    # "Identical" = same project + provider + path + key config fields.
    sb = _get_client()
    existing = []
    existing_scopes: dict[str, dict] = {}
    if provider != "direct":
        existing = (
            sb.table("access_surfaces")
            .select("*")
            .eq("project_id", payload.project_id)
            .eq("kind", provider)
            .execute()
        ).data or []
        existing_scopes = _scope_rows_for_surfaces(sb, existing)

    for ex in existing:
        ex_scope = existing_scopes.get(ex.get("scope_id")) or {}
        ex_path = _normalize_scope_path(ex_scope.get("path"))
        new_path = _normalize_scope_path(payload.path)
        if ex_path != new_path:
            continue
        # Same path — compare key config fields per provider
        ex_cfg = ex.get("config") or {}
        new_cfg = payload.config or {}
        is_dup = False
        if provider in ("agent", "mcp", "sandbox"):
            is_dup = True
        if is_dup:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "duplicate_access_surface",
                    "message": "An access surface with the same configuration already exists.",
                    "existing_id": ex["id"],
                },
            )

    if provider != "direct":
        entitlement_service.require_allowed(
            project.org_id,
            "access_surface_kinds",
            provider,
        )
        entitlement_service.require_feature(project.org_id, f"access_surface.{provider}")
        entitlement_service.require_capacity(
            project.org_id,
            "access_surfaces.max_per_project",
            current_count=_count_user_access_surfaces_for_project(sb, payload.project_id),
        )

    try:
        if provider == "agent":
            result = _create_agent(payload)
        elif provider == "mcp":
            result = _create_mcp(payload, created_by=current_user.user_id)
        elif provider == "sandbox":
            result = _create_sandbox(payload)
        elif provider == "direct":
            result = _create_direct(payload)
    except HTTPException:
        raise
    except Exception as e:
        from src.utils.logger import log_error
        log_error(f"Failed to create {provider} access surface: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create {provider} access surface: {e}") from e

    return ApiResponse.success(data=result, message=f"{provider} access surface created")

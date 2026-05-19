"""Unified access API.

Single entry-point CRUD over the canonical connector model:

    repo_scopes  -> subtree, credential, Git/FS auth boundary
    connectors   -> provider binding attached to one scope

This route exists for the older CLI/product surface, but it now resolves
through the same connector/scope model as the rest of the product.
"""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse
from src.exceptions import AppException, ErrorCode, NotFoundException
from src.infra.supabase.client import SupabaseClient
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.organization.dependencies import resolve_org_ids
from src.repo.connector_service import ConnectorService
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


def _normalize_scope_path(path: str | None) -> str:
    value = (path or "").strip()
    while value.startswith("/"):
        value = value[1:]
    while value.endswith("/"):
        value = value[:-1]
    while "//" in value:
        value = value.replace("//", "/")
    return value


def _scope_rows_for_connectors(sb_client, rows: list[dict]) -> dict[str, dict]:
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
    provider = row.get("provider", "")
    if provider in {"cli", "filesystem"}:
        return (scope or {}).get("access_key")
    if provider == "agent":
        return cfg.get("mcp_api_key") or cfg.get("access_key")
    if provider == "mcp":
        return cfg.get("api_key")
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
    scopes = _scope_rows_for_connectors(sb_client, rows)
    # First pass: build raw entries
    entries = []
    for r in rows:
        cfg = r.get("config") or {}
        scope = scopes.get(r.get("scope_id"))
        base_name = r.get("name") or cfg.get("name") or cfg.get("sync_url") or r.get("provider", "")
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
            provider=r["provider"],
            name=name,
            path=node_path or None,
            node_name=e["node_name"],
            direction=r.get("direction"),
            status=r.get("status", "active"),
            access_key=_access_key_for(r, e["scope"]),
            gateway_id=(e["cfg"].get("gateway_id") if isinstance(e["cfg"], dict) else None),
            trigger=r.get("trigger"),
            last_synced_at=_created_or_updated(r.get("last_run_at")),
            error_message=r.get("error_message"),
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

    query = sb.table("connectors").select("*")

    if len(project_ids) == 1:
        query = query.eq("project_id", project_ids[0])
    else:
        query = query.in_("project_id", project_ids)

    if provider:
        query = query.eq("provider", provider)
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
    resp = sb.table("connectors").select("*").eq("id", connection_id).execute()
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
        sb.table("connectors")
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
    if payload.trigger is not None:
        fields["trigger"] = payload.trigger
    if payload.config is not None:
        fields["config"] = payload.config

    try:
        ConnectorService().update(connection_id, fields)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e

    if payload.trigger is not None:
        try:
            from src.infra.scheduler.service import get_scheduler_service
            trigger_type = (payload.trigger or {}).get("type", "")
            await get_scheduler_service().sync_trigger(
                connection_id=connection_id,
                provider=row.get("provider", ""),
                trigger_config=payload.trigger if trigger_type == "scheduled" else None,
            )
        except Exception:
            pass

    updated = sb.table("connectors").select("*").eq("id", connection_id).execute()
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

    resp = sb.table("connectors").select("project_id").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if resp.data[0]["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    try:
        from src.infra.scheduler.service import get_scheduler_service
        await get_scheduler_service().sync_trigger(connection_id)
    except Exception:
        pass

    try:
        ConnectorService().delete(connection_id)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
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
    resp = sb.table("connectors").select("*").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    cfg = dict(row.get("config") or {})
    cfg["name"] = new_name
    try:
        ConnectorService().update(connection_id, {"name": new_name, "config": cfg})
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e

    updated = sb.table("connectors").select("*").eq("id", connection_id).execute()
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

    resp = sb.table("connectors").select("*").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Access connection not found", code=ErrorCode.NOT_FOUND)

    provider = row.get("provider", "")
    if provider in {"cli", "filesystem"}:
        new_key = ScopeService().regenerate_access_key(row["scope_id"])
        if not new_key:
            raise NotFoundException("Scope not found", code=ErrorCode.NOT_FOUND)
        return ApiResponse.success(data={"access_key": new_key}, message="Key regenerated")
    if provider == "sandbox":
        prefix = "sbx"
        key_field = "access_key"
    elif provider in {"agent", "mcp"}:
        prefix = "cli"
        key_field = "mcp_api_key" if provider == "agent" else "api_key"
    else:
        prefix = "key"
        key_field = "access_key"

    new_key = f"{prefix}_{secrets.token_urlsafe(32)}"
    cfg = dict(row.get("config") or {})
    cfg[key_field] = new_key
    try:
        ConnectorService().update(connection_id, {"config": cfg})
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e

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
    Returns ALL available access types across the platform:
    datasource connectors, agent, MCP endpoint, sandbox endpoint.

    Frontend uses this single endpoint to render the unified creation panel.
    """
    from src.connectors.datasource.dependencies import get_connector_registry

    registry = get_connector_registry()
    datasource_specs = registry.specs_to_dicts()

    non_datasource_types = [
        {
            "provider": "agent",
            "display_name": "Chat Agent",
            "description": "Interactive AI assistant with data access",
            "auth": "none",
            "creation_mode": "direct",
            "category": "agent",
            "icon": "💬",
        },
        {
            "provider": "mcp",
            "display_name": "MCP Server",
            "description": "Model Context Protocol endpoint",
            "auth": "none",
            "creation_mode": "direct",
            "category": "endpoint",
            "icon": "🔌",
        },
        {
            "provider": "sandbox",
            "display_name": "Sandbox",
            "description": "Isolated script execution environment",
            "auth": "none",
            "creation_mode": "direct",
            "category": "endpoint",
            "icon": "📦",
        },
    ]

    for spec in datasource_specs:
        spec["category"] = "datasource"

    return ApiResponse.success(data=datasource_specs + non_datasource_types)


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
    sync_mode: str | None = Field(None, description="Sync mode: import_once, scheduled (datasource)")
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


DATASOURCE_PROVIDERS: set[str] = set()


def _get_datasource_providers() -> set[str]:
    """Lazily cache the set of registered datasource connector providers."""
    global DATASOURCE_PROVIDERS
    if not DATASOURCE_PROVIDERS:
        from src.connectors.datasource.dependencies import get_connector_registry
        registry = get_connector_registry()
        DATASOURCE_PROVIDERS = set(registry.providers())
    return DATASOURCE_PROVIDERS


async def _create_datasource(payload: UnifiedConnectionCreate, user_id: str) -> UnifiedConnectionOut:
    from src.connectors.datasource.dependencies import (
        _build_sync_service,
        get_connector_registry,
    )

    if not payload.path:
        raise HTTPException(status_code=400, detail="path (target_folder_path) is required for datasource connectors")

    registry = get_connector_registry()
    sync_svc = _build_sync_service(registry)

    sync_mode = payload.sync_mode or "import_once"
    sync = await sync_svc.create_sync(
        project_id=payload.project_id,
        provider=payload.provider,
        config=payload.config,
        target_folder_path=payload.path,
        credentials_ref=payload.credentials_ref,
        direction=payload.direction or "inbound",
        conflict_strategy=payload.conflict_strategy or "three_way_merge",
        sync_mode=sync_mode,
        trigger=payload.trigger,
        user_id=user_id,
    )

    if sync_mode == "scheduled" and payload.trigger:
        try:
            from src.infra.scheduler.service import get_scheduler_service
            await get_scheduler_service().sync_trigger(
                connection_id=sync.id,
                provider=payload.provider,
                trigger_config=payload.trigger,
            )
        except Exception:
            pass

    # Keep gateway provenance on the connector config; gateway rows are not
    # part of the canonical connector/scope write path.
    if payload.gateway_id and sync.id:
        sb = _get_client()
        row_resp = (
            sb.table("connectors")
            .select("config")
            .eq("id", sync.id)
            .limit(1)
            .execute()
        )
        if not row_resp.data:
            raise RuntimeError(f"connector {sync.id} disappeared after creation")
        cfg = dict(row_resp.data[0].get("config") or {})
        cfg["gateway_id"] = payload.gateway_id
        sb.table("connectors").update({"config": cfg}).eq("id", sync.id).execute()

    return UnifiedConnectionOut(
        id=sync.id,
        project_id=sync.project_id,
        provider=sync.provider,
        name=payload.name or sync.provider,
        status=sync.status,
        gateway_id=payload.gateway_id,
    )


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


def _create_mcp(payload: UnifiedConnectionCreate) -> UnifiedConnectionOut:
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


async def _create_filesystem(
    payload: UnifiedConnectionCreate, _user_id: str,
) -> UnifiedConnectionOut:
    """Claim the built-in filesystem connector for a scope."""
    from src.connectors.datasource.repository import SyncRepository
    from src.connectors.filesystem.service import FilesystemService
    from src.infra.supabase.client import SupabaseClient

    supabase = SupabaseClient()
    sync_repo = SyncRepository(supabase)
    service = FilesystemService(supabase=supabase, sync_repo=sync_repo)

    cfg = payload.config
    scope = cfg.get("scope", {})
    if isinstance(scope, dict):
        scope_path = scope.get("path", payload.path or "/")
    else:
        scope_path = str(scope) if scope else (payload.path or "/")

    try:
        sync = service.bootstrap(
            project_id=payload.project_id,
            path=scope_path,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create filesystem connector: {e}") from e

    return UnifiedConnectionOut(
        id=sync.id,
        project_id=payload.project_id,
        provider="filesystem",
        name=payload.name or "Filesystem Sync",
        status=sync.status or "active",
        access_key=sync.access_key,
        # Post-hash: the access_key now authorises Git smart-HTTP at
        # /git/ap/<key>.git and the FS HTTP API at /api/v1/ap-fs/*.
        ap_base=f"/git/ap/{sync.access_key}.git" if sync.access_key else None,
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
    connector_resp = (
        sb.table("connectors")
        .select("id, status")
        .eq("scope_id", scope_row["id"])
        .eq("provider", "cli")
        .limit(1)
        .execute()
    )
    if not connector_resp.data:
        raise RuntimeError(
            "direct connector invariant failed: repo scope exists without "
            "its built-in cli connector"
        )
    connector = connector_resp.data[0]

    return UnifiedConnectionOut(
        id=connector["id"],
        project_id=payload.project_id,
        provider="direct",
        name=payload.name or "Direct Access",
        status=connector.get("status", "active"),
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
):
    """
    Unified entry point for creating connector-backed access of any type.
    Routes to the appropriate service based on `provider`.

    - Datasource providers (gmail, github, url, ...): creates a sync binding
    - agent: creates a chat agent
    - mcp: creates an MCP endpoint
    - sandbox: creates a sandbox endpoint
    """
    from src.platform.project.repository import ProjectRepositorySupabase
    project_repo = ProjectRepositorySupabase()
    if not project_repo.verify_project_access(payload.project_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied to this project")

    provider = payload.provider.lower()

    # ── Duplicate detection ────────────────────────────────────────
    # Block creation if an identical connector already exists.
    # "Identical" = same project + provider + path + key config fields.
    sb = _get_client()
    existing = []
    existing_scopes: dict[str, dict] = {}
    if provider not in {"direct", "filesystem"}:
        existing = (
            sb.table("connectors")
            .select("*")
            .eq("project_id", payload.project_id)
            .eq("provider", provider)
            .execute()
        ).data or []
        existing_scopes = _scope_rows_for_connectors(sb, existing)

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
            # For structural connectors, same path = duplicate.
            is_dup = True
        elif provider == "url":
            is_dup = ex_cfg.get("source_url") == new_cfg.get("source_url")
        else:
            # Datasource: same external_resource_id / source URL
            is_dup = (
                ex_cfg.get("external_resource_id") == new_cfg.get("external_resource_id")
                and new_cfg.get("external_resource_id")
            ) or ex_cfg.get("source_url") == new_cfg.get("source_url")
        if is_dup:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "duplicate_connector",
                    "message": "A connector with the same configuration already exists.",
                    "existing_id": ex["id"],
                },
            )

    try:
        if provider == "agent":
            result = _create_agent(payload)
        elif provider == "mcp":
            result = _create_mcp(payload)
        elif provider == "sandbox":
            result = _create_sandbox(payload)
        elif provider == "filesystem":
            result = await _create_filesystem(payload, current_user.user_id)
        elif provider == "direct":
            result = _create_direct(payload)
        elif provider in _get_datasource_providers():
            result = await _create_datasource(payload, current_user.user_id)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown provider: {provider}. Use GET /api/v1/access/types to see available types.",
            )
    except HTTPException:
        raise
    except Exception as e:
        from src.utils.logger import log_error
        log_error(f"Failed to create {provider} connection: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create {provider} connection: {e}") from e

    return ApiResponse.success(data=result, message=f"{provider} connection created")

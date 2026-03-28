"""
Unified Connections API

Single entry-point CRUD over the `connections` table for ALL provider types
(sync, agent, mcp, sandbox, filesystem). Allows the CLI `puppyone connection`
command group to manage every connection from one place.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, Query, Path, status, HTTPException
from pydantic import BaseModel, Field

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.exceptions import NotFoundException, ErrorCode
from src.infra.supabase.client import SupabaseClient
from src.platform.organization.dependencies import resolve_org_ids


router = APIRouter(prefix="/connections", tags=["connections"])


# ── Schemas ─────────────────────────────────────────────────

class ConnectionOut(BaseModel):
    id: str
    project_id: str
    provider: str
    name: Optional[str] = None
    path: Optional[str] = None
    node_name: Optional[str] = None
    direction: Optional[str] = None
    status: str = "active"
    access_key: Optional[str] = None
    trigger: Optional[dict] = None
    last_synced_at: Optional[str] = None
    error_message: Optional[str] = None
    config: Optional[dict] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ConnectionUpdate(BaseModel):
    status: Optional[str] = None
    trigger: Optional[dict] = None
    config: Optional[dict] = None


# ── Helpers ─────────────────────────────────────────────────

def _get_client():
    return SupabaseClient().client


def _enrich(rows: list[dict], sb_client) -> list[ConnectionOut]:
    """Resolve node names from paths and extract config.name for display."""
    out: list[ConnectionOut] = []
    for r in rows:
        cfg = r.get("config") or {}
        name = cfg.get("name") or cfg.get("sync_url") or r.get("provider", "")
        node_path = r.get("path") or ""
        node_name = node_path.rsplit("/", 1)[-1] if node_path else None
        out.append(ConnectionOut(
            id=r["id"],
            project_id=r["project_id"],
            provider=r["provider"],
            name=name,
            path=node_path or None,
            node_name=node_name,
            direction=r.get("direction"),
            status=r.get("status", "active"),
            access_key=r.get("access_key"),
            trigger=r.get("trigger"),
            last_synced_at=r.get("last_synced_at"),
            error_message=r.get("error_message"),
            config=cfg,
            created_at=r.get("created_at"),
            updated_at=r.get("updated_at"),
        ))
    return out


def _get_user_project_ids(sb_client, user_id: str, org_ids: list[str]) -> list[str]:
    """Get all project IDs the user has access to."""
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
    response_model=ApiResponse[List[ConnectionOut]],
    summary="List all connections",
    status_code=status.HTTP_200_OK,
)
def list_connections(
    project_id: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    connection_status: Optional[str] = Query(None, alias="status"),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()
    org_ids = resolve_org_ids(None, current_user.user_id)

    if project_id:
        project_ids = [project_id]
    else:
        project_ids = _get_user_project_ids(sb, current_user.user_id, org_ids)

    if not project_ids:
        return ApiResponse.success(data=[], message="No connections")

    query = sb.table("connections").select("*")

    if len(project_ids) == 1:
        query = query.eq("project_id", project_ids[0])
    else:
        query = query.in_("project_id", project_ids)

    if provider:
        query = query.eq("provider", provider)
    if connection_status:
        query = query.eq("status", connection_status)

    rows = query.order("created_at").execute().data
    return ApiResponse.success(data=_enrich(rows, sb), message="Connections listed")


@router.get(
    "/{connection_id}",
    response_model=ApiResponse[ConnectionOut],
    summary="Get connection details",
    status_code=status.HTTP_200_OK,
)
def get_connection(
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()
    resp = sb.table("connections").select("*").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    # Verify user has access via org membership
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, current_user.user_id, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    return ApiResponse.success(data=_enrich([row], sb)[0], message="Connection found")


@router.patch(
    "/{connection_id}",
    response_model=ApiResponse[ConnectionOut],
    summary="Update connection (status, trigger, config)",
    status_code=status.HTTP_200_OK,
)
def update_connection(
    payload: ConnectionUpdate,
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()

    resp = sb.table("connections").select("project_id").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, current_user.user_id, org_ids)
    if resp.data[0]["project_id"] not in pids:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    fields: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.status is not None:
        fields["status"] = payload.status
    if payload.trigger is not None:
        fields["trigger"] = payload.trigger
    if payload.config is not None:
        fields["config"] = payload.config

    sb.table("connections").update(fields).eq("id", connection_id).execute()

    updated = sb.table("connections").select("*").eq("id", connection_id).execute()
    return ApiResponse.success(data=_enrich(updated.data, sb)[0], message="Connection updated")


@router.delete(
    "/{connection_id}",
    response_model=ApiResponse[None],
    summary="Delete connection",
    status_code=status.HTTP_200_OK,
)
def delete_connection(
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()

    resp = sb.table("connections").select("project_id").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, current_user.user_id, org_ids)
    if resp.data[0]["project_id"] not in pids:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    sb.table("connections").delete().eq("id", connection_id).execute()
    return ApiResponse.success(message="Connection deleted")


@router.post(
    "/{connection_id}/regenerate-key",
    response_model=ApiResponse[dict],
    summary="Regenerate access key for a connection",
    status_code=status.HTTP_200_OK,
)
def regenerate_key(
    connection_id: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    sb = _get_client()

    resp = sb.table("connections").select("project_id, provider").eq("id", connection_id).execute()
    if not resp.data:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    row = resp.data[0]
    org_ids = resolve_org_ids(None, current_user.user_id)
    pids = _get_user_project_ids(sb, current_user.user_id, org_ids)
    if row["project_id"] not in pids:
        raise NotFoundException("Connection not found", code=ErrorCode.NOT_FOUND)

    provider = row.get("provider", "")
    if provider == "sandbox":
        prefix = "sbx"
    elif provider == "agent":
        prefix = "cli"
    else:
        prefix = "mcp"

    new_key = f"{prefix}_{secrets.token_urlsafe(32)}"
    sb.table("connections").update({
        "access_key": new_key,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", connection_id).execute()

    return ApiResponse.success(data={"access_key": new_key}, message="Key regenerated")


# ── Connection Types (unified) ─────────────────────────────

@router.get(
    "/types",
    response_model=ApiResponse,
    summary="List all available connection types",
    status_code=status.HTTP_200_OK,
)
def list_connection_types():
    """
    Returns ALL available connection types across the platform:
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
    Single request schema for creating ANY connection type.
    The `provider` field determines which service handles creation.
    """
    project_id: str = Field(..., description="Project ID")
    provider: str = Field(..., description="Connection type: gmail, github, agent, mcp, sandbox, ...")
    name: Optional[str] = Field(None, description="Display name")
    path: Optional[str] = Field(None, description="Target MUT path")
    config: dict = Field(default_factory=dict, description="Provider-specific configuration")
    direction: Optional[str] = Field(None, description="Sync direction (datasource only)")
    trigger: Optional[dict] = Field(None, description="Trigger config (datasource/agent)")
    credentials_ref: Optional[str] = Field(None, description="OAuth credentials reference (datasource)")
    sync_mode: Optional[str] = Field(None, description="Sync mode: import_once, scheduled (datasource)")
    conflict_strategy: Optional[str] = Field(None, description="Conflict strategy (datasource)")
    accesses: Optional[List[dict]] = Field(None, description="Node access bindings (agent/mcp)")
    tools_config: Optional[List[dict]] = Field(None, description="Tool bindings (mcp)")


class UnifiedConnectionOut(BaseModel):
    id: str
    project_id: str
    provider: str
    name: Optional[str] = None
    status: str = "active"


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
        get_connector_registry, _build_sync_service,
    )

    if not payload.path:
        raise HTTPException(status_code=400, detail="path (target_folder_path) is required for datasource connections")

    registry = get_connector_registry()
    sync_svc = _build_sync_service(registry)

    sync = await sync_svc.create_sync(
        project_id=payload.project_id,
        provider=payload.provider,
        config=payload.config,
        target_folder_path=payload.path,
        credentials_ref=payload.credentials_ref,
        direction=payload.direction or "inbound",
        conflict_strategy=payload.conflict_strategy or "three_way_merge",
        sync_mode=payload.sync_mode or "import_once",
        trigger=payload.trigger,
        user_id=user_id,
    )
    return UnifiedConnectionOut(
        id=sync.id,
        project_id=sync.project_id,
        provider=sync.provider,
        name=payload.name or sync.provider,
        status=sync.status,
    )


def _create_agent(payload: UnifiedConnectionCreate) -> UnifiedConnectionOut:
    from src.connectors.agent.config.repository import AgentRepository
    from src.connectors.agent.config.service import AgentConfigService
    from src.connectors.agent.config.schemas import AgentBashCreate

    service = AgentConfigService(repository=AgentRepository())

    bash_accesses = []
    if payload.accesses:
        bash_accesses = [
            AgentBashCreate(
                path=a["path"],
                json_path=a.get("json_path", ""),
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
    from src.connectors.mcp_endpoint.service import McpEndpointService
    from src.connectors.mcp_endpoint.schemas import McpAccessItem, McpToolItem

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
    from src.connectors.sandbox_endpoint.service import SandboxEndpointService
    from src.connectors.sandbox_endpoint.schemas import SandboxMountItem, SandboxResourceLimits

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
    """Create a filesystem sync connection (OpenClaw)."""
    from src.connectors.filesystem.lifecycle import OpenClawService
    from src.connectors.datasource.repository import SyncRepository
    from src.infra.supabase.client import SupabaseClient

    supabase = SupabaseClient()
    sync_repo = SyncRepository(supabase)
    service = OpenClawService(supabase=supabase, sync_repo=sync_repo)

    cfg = payload.config
    scope_path = cfg.get("scope", payload.path or "/")

    sync = service.bootstrap(
        project_id=payload.project_id,
        path=scope_path,
    )

    return UnifiedConnectionOut(
        id=sync.id,
        project_id=payload.project_id,
        provider="filesystem",
        name=payload.name or "Filesystem Sync",
        status=sync.status or "active",
    )


@router.post(
    "/",
    response_model=ApiResponse[UnifiedConnectionOut],
    summary="Create any connection type",
    status_code=status.HTTP_201_CREATED,
)
async def create_connection(
    payload: UnifiedConnectionCreate,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Unified entry point for creating connections of any type.
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

    if provider == "agent":
        result = _create_agent(payload)
    elif provider == "mcp":
        result = _create_mcp(payload)
    elif provider == "sandbox":
        result = _create_sandbox(payload)
    elif provider == "filesystem":
        result = await _create_filesystem(payload, current_user.user_id)
    elif provider in _get_datasource_providers():
        result = await _create_datasource(payload, current_user.user_id)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider: {provider}. Use GET /api/v1/connections/types to see available types.",
        )

    return ApiResponse.success(data=result, message=f"{provider} connection created")

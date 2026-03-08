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

from fastapi import APIRouter, Depends, Query, Path, status
from pydantic import BaseModel

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.exceptions import NotFoundException, ErrorCode
from src.supabase.client import SupabaseClient
from src.organization.dependencies import resolve_org_ids


router = APIRouter(prefix="/connections", tags=["connections"])


# ── Schemas ─────────────────────────────────────────────────

class ConnectionOut(BaseModel):
    id: str
    project_id: str
    provider: str
    name: Optional[str] = None
    node_id: Optional[str] = None
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
    """Resolve node names and extract config.name for display."""
    node_ids = list({r["node_id"] for r in rows if r.get("node_id")})
    node_map: dict[str, str] = {}
    if node_ids:
        nr = sb_client.table("content_nodes").select("id, name").in_("id", node_ids).execute()
        node_map = {r["id"]: r["name"] for r in nr.data}

    out: list[ConnectionOut] = []
    for r in rows:
        cfg = r.get("config") or {}
        name = cfg.get("name") or cfg.get("sync_url") or r.get("provider", "")
        out.append(ConnectionOut(
            id=r["id"],
            project_id=r["project_id"],
            provider=r["provider"],
            name=name,
            node_id=r.get("node_id"),
            node_name=node_map.get(r.get("node_id") or ""),
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

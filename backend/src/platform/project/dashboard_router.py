"""
Project Dashboard API

Aggregated endpoint that returns a project-level overview in a single call:
project info, node counts, all access points, tools, and active uploads.
"""


from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, status
from loguru import logger
from pydantic import BaseModel

from src.common_schemas import ApiResponse
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.services.ops import MutOps
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_verified_project
from src.platform.project.models import Project

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Response schemas ────────────────────────────────────────

class DashboardProject(BaseModel):
    id: str
    name: str
    description: str | None = None


class DashboardNodeCounts(BaseModel):
    total: int = 0
    folders: int = 0
    files: int = 0


class DashboardConnection(BaseModel):
    id: str
    provider: str
    name: str | None = None
    path: str | None = None
    direction: str | None = None
    status: str = "active"
    access_key: str | None = None
    trigger: dict | None = None
    last_synced_at: str | None = None
    error_message: str | None = None
    created_at: str | None = None
    # Per-day invocation count for the last N days (oldest → newest).
    # Currently sourced from ``sync_runs`` (covers sync-style providers:
    # gmail, google_sheets, notion, github, supabase, ...).  Output-style
    # APs (agent / mcp / sandbox) don't write to ``sync_runs`` yet, so they
    # get zero buckets until we wire in their usage table(s).
    usage_buckets: list[int] = []


class DashboardTool(BaseModel):
    id: str
    name: str
    type: str | None = None
    index_status: str | None = None
    chunks_count: int | None = None
    total_files: int | None = None
    indexed_files: int | None = None


class DashboardUpload(BaseModel):
    id: str
    status: str
    type: str
    progress: int = 0
    message: str | None = None


class ProjectDashboard(BaseModel):
    project: DashboardProject
    nodes: DashboardNodeCounts
    access_points: list[DashboardConnection] = []
    tools: list[DashboardTool] = []
    uploads: list[DashboardUpload] = []


# ── Endpoint ────────────────────────────────────────────────

@router.get(
    "/{project_id}/dashboard",
    response_model=ApiResponse[ProjectDashboard],
    summary="Project dashboard (aggregated status)",
    status_code=status.HTTP_200_OK,
)
def get_project_dashboard(
    project: Project = Depends(get_verified_project),
    ops: MutOps = Depends(get_mut_ops),
    current_user: CurrentUser = Depends(get_current_user),
):
    project_id = str(project.id)
    sb = SupabaseClient().client

    try:
        node_counts = _compute_node_counts(ops, project_id)
    except Exception as e:
        logger.exception(f"[Dashboard] _compute_node_counts failed for {project_id}")
        raise

    try:
        access_points = _fetch_access_points(sb, project_id)
    except Exception as e:
        logger.exception(f"[Dashboard] _fetch_access_points failed for {project_id}")
        raise

    try:
        tools = _fetch_tools(sb, project_id)
    except Exception as e:
        logger.exception(f"[Dashboard] _fetch_tools failed for {project_id}")
        raise

    uploads = _fetch_uploads(sb, project_id)

    dashboard = ProjectDashboard(
        project=DashboardProject(
            id=project_id,
            name=project.name,
            description=project.description,
        ),
        nodes=node_counts,
        access_points=access_points,
        tools=tools,
        uploads=uploads,
    )

    return ApiResponse.success(data=dashboard, message="Dashboard loaded")


def _compute_node_counts(ops: MutOps, project_id: str) -> DashboardNodeCounts:
    all_entries = ops.list_tree(project_id, "", max_depth=-1)
    folder_count = sum(1 for e in all_entries if e.type == "folder")
    file_count = sum(1 for e in all_entries if e.type != "folder")
    return DashboardNodeCounts(
        total=folder_count + file_count,
        folders=folder_count,
        files=file_count,
    )


USAGE_BUCKET_DAYS = 14


def _fetch_access_points(sb, project_id: str) -> list[DashboardConnection]:
    conn_rows = (
        sb.table("access_points")
        .select("id, provider, config, path, direction, status, access_key, trigger, last_synced_at, error_message, created_at")
        .eq("project_id", project_id)
        .order("created_at")
        .execute()
    ).data

    connections: list[DashboardConnection] = []
    for r in conn_rows:
        cfg = r.get("config") or {}
        name = cfg.get("name") or cfg.get("sync_url") or r["provider"]
        connections.append(DashboardConnection(
            id=r["id"],
            provider=r["provider"],
            name=name,
            path=r.get("path"),
            direction=r.get("direction"),
            status=r.get("status", "active"),
            access_key=_mask_key(r.get("access_key")),
            trigger=r.get("trigger"),
            last_synced_at=r.get("last_synced_at"),
            error_message=r.get("error_message"),
            created_at=r.get("created_at"),
        ))

    if connections:
        usage_map = _fetch_usage_buckets(
            sb, [c.id for c in connections], days=USAGE_BUCKET_DAYS,
        )
        for c in connections:
            c.usage_buckets = usage_map.get(c.id, [0] * USAGE_BUCKET_DAYS)

    return connections


def _fetch_usage_buckets(
    sb, ap_ids: list[str], days: int = USAGE_BUCKET_DAYS,
) -> dict[str, list[int]]:
    """Return per-AP daily invocation counts for the last ``days`` days.

    Source: ``sync_runs.access_point_id`` + ``started_at``.  Buckets are aligned
    oldest → newest (index 0 = ``today - (days-1)``, last index = today) in UTC.
    APs with no runs in the window get a zero-filled list.
    """
    buckets: dict[str, list[int]] = {ap_id: [0] * days for ap_id in ap_ids}
    if not ap_ids:
        return buckets

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days - 1)
    cutoff_day = cutoff.date()
    today = now.date()

    try:
        rows = (
            sb.table("sync_runs")
            .select("access_point_id, started_at")
            .in_("access_point_id", ap_ids)
            .gte("started_at", cutoff.isoformat())
            .execute()
        ).data or []
    except Exception:
        logger.exception("[Dashboard] sync_runs aggregation failed; returning zero buckets")
        return buckets

    for r in rows:
        ap_id = r.get("access_point_id")
        started = r.get("started_at")
        if not ap_id or not started or ap_id not in buckets:
            continue
        try:
            # Supabase returns ISO8601 with either "Z" or "+00:00"
            run_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        run_day = run_dt.astimezone(timezone.utc).date()
        if run_day < cutoff_day or run_day > today:
            continue
        idx = (run_day - cutoff_day).days
        if 0 <= idx < days:
            buckets[ap_id][idx] += 1

    return buckets


def _fetch_tools(sb, project_id: str) -> list[DashboardTool]:
    tool_rows = (
        sb.table("tools")
        .select("id, name, type")
        .eq("project_id", project_id)
        .execute()
    ).data

    index_map = _build_index_map(sb, tool_rows)

    tools: list[DashboardTool] = []
    for t in tool_rows:
        idx = index_map.get(t["id"])
        tools.append(DashboardTool(
            id=t["id"],
            name=t["name"],
            type=t.get("type"),
            index_status=idx["status"] if idx else None,
            chunks_count=idx.get("chunks_count") if idx else None,
            total_files=idx.get("total_files") if idx else None,
            indexed_files=idx.get("indexed_files") if idx else None,
        ))
    return tools


def _build_index_map(sb, tool_rows: list) -> dict[str, dict]:
    search_tool_ids = [t["id"] for t in tool_rows if t.get("type") == "search"]
    if not search_tool_ids:
        return {}

    idx_rows = (
        sb.table("uploads")
        .select("id, status, result")
        .eq("type", "search_index")
        .in_("id", search_tool_ids)
        .execute()
    ).data
    status_map = {"running": "indexing", "completed": "ready", "failed": "error", "pending": "pending"}
    index_map: dict[str, dict] = {}
    for r in idx_rows:
        res = r.get("result") or {}
        index_map[r["id"]] = {
            "status": status_map.get(r.get("status", ""), r.get("status", "")),
            "chunks_count": res.get("chunks_count"),
            "total_files": res.get("total_files"),
            "indexed_files": res.get("indexed_files"),
        }
    return index_map


def _fetch_uploads(sb, project_id: str) -> list[DashboardUpload]:
    try:
        upload_rows = (
            sb.table("uploads")
            .select("id, status, type, progress, message")
            .eq("project_id", project_id)
            .in_("status", ["pending", "running"])
            .limit(20)
            .execute()
        ).data
    except Exception:
        return []

    return [
        DashboardUpload(
            id=u["id"],
            status=u["status"],
            type=u.get("type", "file"),
            progress=u.get("progress", 0),
            message=u.get("message"),
        )
        for u in upload_rows
    ]


def _mask_key(key: str | None) -> str | None:
    if not key or len(key) < 8:
        return key
    prefix_end = key.index("_") + 1 if "_" in key else 4
    return key[:prefix_end] + "..." + key[-4:]

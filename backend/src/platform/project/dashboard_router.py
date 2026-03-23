"""
Project Dashboard API

Aggregated endpoint that returns a project-level overview in a single call:
project info, node counts, all connections, tools, and active uploads.
"""

from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, status

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.platform.project.dependencies import get_verified_project
from src.platform.project.models import Project
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.ops import MutOps
from src.infra.supabase.client import SupabaseClient

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Response schemas ────────────────────────────────────────

class DashboardProject(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


class DashboardNodeCounts(BaseModel):
    total: int = 0
    folders: int = 0
    files: int = 0


class DashboardConnection(BaseModel):
    id: str
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
    created_at: Optional[str] = None


class DashboardTool(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    index_status: Optional[str] = None
    chunks_count: Optional[int] = None
    total_files: Optional[int] = None
    indexed_files: Optional[int] = None


class DashboardUpload(BaseModel):
    id: str
    status: str
    type: str
    progress: int = 0
    message: Optional[str] = None


class ProjectDashboard(BaseModel):
    project: DashboardProject
    nodes: DashboardNodeCounts
    connections: List[DashboardConnection] = []
    tools: List[DashboardTool] = []
    uploads: List[DashboardUpload] = []


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

    # 1. Node counts — from Mut tree
    all_entries = ops.list_tree(project_id, "", max_depth=-1)
    folder_count = sum(1 for e in all_entries if e.type == "folder")
    file_count = sum(1 for e in all_entries if e.type != "folder")
    node_counts = DashboardNodeCounts(
        total=folder_count + file_count,
        folders=folder_count,
        files=file_count,
    )

    # 2. All connections (one query to the unified table)
    conn_rows = (
        sb.table("connections")
        .select("id, provider, config, path, direction, status, access_key, trigger, last_synced_at, error_message, created_at")
        .eq("project_id", project_id)
        .order("created_at")
        .execute()
    ).data

    connections = []
    for r in conn_rows:
        cfg = r.get("config") or {}
        name = cfg.get("name") or cfg.get("sync_url") or r["provider"]
        connections.append(DashboardConnection(
            id=r["id"],
            provider=r["provider"],
            name=name,
            path=r.get("path"),
            node_name=None,
            direction=r.get("direction"),
            status=r.get("status", "active"),
            access_key=_mask_key(r.get("access_key")),
            trigger=r.get("trigger"),
            last_synced_at=r.get("last_synced_at"),
            error_message=r.get("error_message"),
            created_at=r.get("created_at"),
        ))

    # 3. Tools + search index status
    tool_rows = (
        sb.table("tools")
        .select("id, name, type")
        .eq("project_id", project_id)
        .execute()
    ).data

    tools: list[DashboardTool] = []
    search_tool_ids = [t["id"] for t in tool_rows if t.get("type") == "search"]
    index_map: dict[str, dict] = {}
    if search_tool_ids:
        idx_rows = (
            sb.table("search_index_tasks")
            .select("tool_id, status, chunks_count, total_files, indexed_files")
            .in_("tool_id", search_tool_ids)
            .execute()
        ).data
        index_map = {r["tool_id"]: r for r in idx_rows}

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

    # 4. Active uploads (ingest tasks in progress)
    uploads: list[DashboardUpload] = []
    try:
        upload_rows = (
            sb.table("ingest_tasks")
            .select("id, status, type, task_type, progress, message")
            .eq("project_id", project_id)
            .in_("status", ["pending", "processing"])
            .limit(20)
            .execute()
        ).data
        for u in upload_rows:
            uploads.append(DashboardUpload(
                id=u["id"],
                status=u["status"],
                type=u.get("task_type") or u.get("type", "file"),
                progress=u.get("progress", 0),
                message=u.get("message"),
            ))
    except Exception:
        pass

    dashboard = ProjectDashboard(
        project=DashboardProject(
            id=project_id,
            name=project.name,
            description=project.description,
        ),
        nodes=node_counts,
        connections=connections,
        tools=tools,
        uploads=uploads,
    )

    return ApiResponse.success(data=dashboard, message="Dashboard loaded")


def _mask_key(key: Optional[str]) -> Optional[str]:
    if not key or len(key) < 8:
        return key
    prefix_end = key.index("_") + 1 if "_" in key else 4
    return key[:prefix_end] + "..." + key[-4:]

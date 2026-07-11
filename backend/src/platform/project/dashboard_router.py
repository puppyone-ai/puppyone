"""
Project Dashboard API

Aggregated endpoint that returns a project-level overview in a single call:
project info, node counts, all connections, tools, and active uploads.
"""


import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, status
from fastapi.concurrency import run_in_threadpool
from loguru import logger
from pydantic import BaseModel

from src.common_schemas import ApiResponse
from src.infra.supabase.client import SupabaseClient
from src.version_engine.bootstrap.dependencies import get_product_operation_adapter
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
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
    # Aggregated across each entry-point family's run-log table:
    # ``sync_runs`` for Connect rows and ``agent_execution_logs`` for
    # scheduled agents. MCP / sandbox APs do not persist per-invocation runs
    # yet, so they still report zeros until their execution paths are
    # instrumented.
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
    connections: list[DashboardConnection] = []
    tools: list[DashboardTool] = []
    uploads: list[DashboardUpload] = []


# ── Endpoint ────────────────────────────────────────────────

@router.get(
    "/{project_id}/dashboard",
    response_model=ApiResponse[ProjectDashboard],
    summary="Project dashboard (aggregated status)",
    status_code=status.HTTP_200_OK,
)
async def get_project_dashboard(
    project: Project = Depends(get_verified_project),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Build dashboard by issuing the 4 independent backing queries in
    parallel via asyncio.gather.

    PERFORMANCE (P-1): Previously each section ran sequentially as a sync
    call, totaling ~4–7 s wall time on a typical project. Running them in
    parallel collapses that to roughly the slowest single section
    (~600–900 ms). supabase-py is sync, so we offload via run_in_threadpool.
    """
    project_id = str(project.id)
    sb = SupabaseClient().client

    counts, connections, tools, uploads = await asyncio.gather(
        run_in_threadpool(_compute_node_counts, ops, project_id),
        run_in_threadpool(_fetch_connections, sb, project_id),
        run_in_threadpool(_fetch_tools, sb, project_id),
        run_in_threadpool(_fetch_uploads, sb, project_id),
        return_exceptions=True,
    )

    # Per-section failures are logged but don't fail the whole dashboard;
    # we degrade to empty/zero rather than 500-ing the entire page.
    if isinstance(counts, Exception):
        logger.exception(
            f"[Dashboard] _compute_node_counts failed for {project_id}: {counts}"
        )
        counts = DashboardNodeCounts()
    if isinstance(connections, Exception):
        logger.exception(
            f"[Dashboard] _fetch_connections failed for {project_id}: {connections}"
        )
        connections = []
    if isinstance(tools, Exception):
        logger.exception(
            f"[Dashboard] _fetch_tools failed for {project_id}: {tools}"
        )
        tools = []
    if isinstance(uploads, Exception):
        logger.exception(
            f"[Dashboard] _fetch_uploads failed for {project_id}: {uploads}"
        )
        uploads = []

    dashboard = ProjectDashboard(
        project=DashboardProject(
            id=project_id,
            name=project.name,
            description=project.description,
        ),
        nodes=counts,
        connections=connections,
        tools=tools,
        uploads=uploads,
    )

    return ApiResponse.success(data=dashboard, message="Dashboard loaded")


_NODE_COUNT_CACHE: dict[tuple[str, str], DashboardNodeCounts] = {}
_NODE_COUNT_CACHE_MAX = 1024


def _compute_node_counts(ops: ProductOperationAdapter, project_id: str) -> DashboardNodeCounts:
    """Compute folder/file counts for the project tree.

    PERFORMANCE (P-3): list_tree is O(N) over every node in the project's
    Merkle tree. The result depends only on the project state, which moves
    only on commit. We cache by (project_id, head_commit_id) so the
    polling dashboard does the walk at most once per write — and the cache
    is automatically invalidated when the tree mutates.
    """
    try:
        head_commit = ops.get_head_commit_id(project_id)
    except Exception:
        # If we can't read head, fall back to live count (no cache).
        head_commit = ""

    cache_key = (project_id, head_commit)
    if head_commit and cache_key in _NODE_COUNT_CACHE:
        return _NODE_COUNT_CACHE[cache_key]

    all_entries = ops.list_tree(project_id, "", max_depth=-1)
    folder_count = sum(1 for e in all_entries if e.type == "folder")
    file_count = sum(1 for e in all_entries if e.type != "folder")
    counts = DashboardNodeCounts(
        total=folder_count + file_count,
        folders=folder_count,
        files=file_count,
    )

    if head_commit:
        # Bound the cache so a long-running process can't leak unbounded keys.
        if len(_NODE_COUNT_CACHE) >= _NODE_COUNT_CACHE_MAX:
            _NODE_COUNT_CACHE.clear()
        _NODE_COUNT_CACHE[cache_key] = counts
    return counts


USAGE_BUCKET_DAYS = 14


def _iso_string(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _scope_paths_and_keys_by_id(sb, scope_ids: list[str]) -> dict[str, dict]:
    ids = sorted({sid for sid in scope_ids if sid})
    if not ids:
        return {}
    try:
        rows = (
            sb.table("repo_scopes")
            .select("id, path, access_key")
            .in_("id", ids)
            .execute()
        ).data or []
    except Exception:
        logger.exception("[Dashboard] repo_scopes lookup failed")
        return {}
    return {
        row["id"]: {
            "path": row.get("path"),
            "access_key": row.get("access_key"),
        }
        for row in rows
    }


def _path_from_scope(row: dict, cfg: dict, scopes: dict[str, dict]) -> str | None:
    target_path = row.get("target_path") or cfg.get("target_path")
    if target_path not in (None, ""):
        return target_path
    scope_id = row.get("scope_id")
    if scope_id and scope_id in scopes:
        path = scopes[scope_id].get("path")
        return path if path not in (None, "") else None
    scope = cfg.get("scope") or {}
    path = scope.get("path")
    return path if path not in (None, "") else None


def _access_surface_preview_key(cfg: dict, kind: str, scope_key: str | None) -> str | None:
    """Map access-surface config to one credential string for dashboard preview."""
    if not cfg:
        cfg = {}
    if kind == "agent":
        return cfg.get("mcp_api_key")
    if kind == "mcp":
        return cfg.get("api_key")
    if kind == "sandbox":
        return cfg.get("access_key") or scope_key
    if kind in {"git_remote", "cli"}:
        return cfg.get("access_key") or scope_key
    return None


def _fetch_connections(sb, project_id: str) -> list[DashboardConnection]:
    """Load dashboard rows from canonical Connect and Access tables."""
    sync_rows = (
        sb.table("connections")
        .select(
            "id, provider, name, direction, status, trigger_type, "
            "trigger_config, config, scope_id, external_resource_label, "
            "external_url, last_synced_at, error_message, created_at"
        )
        .eq("project_id", project_id)
        .order("created_at")
        .execute()
    ).data or []
    access_rows = (
        sb.table("access_surfaces")
        .select(
            "id, kind, name, status, config, scope_id, created_at, updated_at"
        )
        .eq("project_id", project_id)
        .order("created_at")
        .execute()
    ).data or []
    from src.repo.access_credentials import (
        AccessCredentialRepository,
        mask_access_token,
    )

    credential_map = AccessCredentialRepository(sb).list_active_by_surface(
        [row["id"] for row in access_rows]
    )

    scope_ids = [
        *(row.get("scope_id") for row in sync_rows),
        *(row.get("scope_id") for row in access_rows),
    ]
    scope_lookup = _scope_paths_and_keys_by_id(sb, scope_ids)

    connections: list[DashboardConnection] = []
    for r in sync_rows:
        cfg = r.get("config") or {}
        provider = r["provider"]
        trigger = dict(r.get("trigger_config") or {})
        trigger["type"] = r.get("trigger_type") or "manual"
        name = (
            r.get("name")
            or r.get("external_resource_label")
            or cfg.get("name")
            or cfg.get("sync_url")
            or r.get("external_url")
            or provider
        )
        connections.append(DashboardConnection(
            id=r["id"],
            provider=provider,
            name=name,
            path=_path_from_scope(r, cfg, scope_lookup),
            direction=r.get("direction"),
            status=r.get("status", "active"),
            access_key=None,
            trigger=trigger,
            last_synced_at=_iso_string(r.get("last_synced_at")),
            error_message=r.get("error_message"),
            created_at=r.get("created_at"),
        ))

    for r in access_rows:
        cfg = r.get("config") or {}
        kind = r["kind"]
        scope = scope_lookup.get(r.get("scope_id"), {})
        trigger = cfg.get("trigger")
        if isinstance(trigger, dict) and isinstance(trigger.get("config"), dict):
            trigger = {"type": trigger.get("type"), **trigger["config"]}
        credential = credential_map.get(r["id"])
        if credential:
            preview_key = mask_access_token(
                credential.get("key_prefix"), credential.get("key_last4")
            )
        else:
            preview_key = _access_surface_preview_key(
                cfg,
                kind,
                scope.get("access_key"),
            )
        connections.append(DashboardConnection(
            id=r["id"],
            provider=kind,
            name=r.get("name") or cfg.get("name") or kind,
            path=_path_from_scope(r, cfg, scope_lookup),
            direction=cfg.get("direction"),
            status=r.get("status", "active"),
            access_key=(preview_key if credential else _mask_key(preview_key, kind)),
            trigger=trigger,
            last_synced_at=_iso_string(
                cfg.get("last_seen_at") or cfg.get("last_run_at")
            ),
            error_message=cfg.get("error_message"),
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

    Connect rows record runs in ``sync_runs.connection_id``; scheduled
    agents record runs in ``agent_execution_logs.agent_id``. MCP and sandbox
    APs do not yet persist per-invocation runs anywhere, so they still report
    zeros until their execution paths are instrumented.

    Buckets are aligned oldest → newest (index 0 = ``today - (days-1)``,
    last index = today) in UTC. APs with no runs in the window get a
    zero-filled list.
    """
    buckets: dict[str, list[int]] = {ap_id: [0] * days for ap_id in ap_ids}
    if not ap_ids:
        return buckets

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days - 1)
    cutoff_day = cutoff.date()
    today = now.date()

    # (table, id-column) pairs that record one row per AP invocation.
    for table, id_col in (
        ("sync_runs", "connection_id"),
        ("agent_execution_logs", "agent_id"),
    ):
        _accumulate_run_buckets(
            sb, table, id_col, ap_ids,
            cutoff=cutoff, cutoff_day=cutoff_day, today=today,
            days=days, buckets=buckets,
        )

    return buckets


def _accumulate_run_buckets(
    sb, table: str, id_col: str, ap_ids: list[str], *,
    cutoff, cutoff_day, today, days: int, buckets: dict[str, list[int]],
) -> None:
    """Fold one run-log table's rows into ``buckets`` (in place).

    A missing/erroring source is logged and skipped so one broken table
    can't zero the whole dashboard."""
    try:
        rows = (
            sb.table(table)
            .select(f"{id_col}, started_at")
            .in_(id_col, ap_ids)
            .gte("started_at", cutoff.isoformat())
            .execute()
        ).data or []
    except Exception:
        logger.exception(
            f"[Dashboard] {table} aggregation failed; skipping that source"
        )
        return

    for r in rows:
        ap_id = r.get(id_col)
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


def _mask_key(key: str | None, provider: str | None = None) -> str | None:
    if not key or len(key) < 8:
        return key
    # Scope access keys are paste-and-run credentials the project
    # owner uses with Git Remote / FS CLI: the home-page onboarding
    # block renders a connect command with the access URL and key, the
    # access page exposes a Copy button next to the key, and SyncDetail
    # in the data canvas does the same. Masking those broke every one
    # of those flows (the rendered command included literal `cli_...XXX`
    # which the backend can't resolve, so the connect command returned 401 /
    # not found). Dashboard is JWT-gated to project members already, so
    # an owner seeing their own scope key is the right exposure
    # level — the mask only made sense for keys we hand out to
    # third-party callers (sandbox, mcp), where the dashboard is just
    # an "is it configured" preview.
    if provider in {"git_remote", "cli"}:
        return key
    prefix_end = key.index("_") + 1 if "_" in key else 4
    return key[:prefix_end] + "..." + key[-4:]

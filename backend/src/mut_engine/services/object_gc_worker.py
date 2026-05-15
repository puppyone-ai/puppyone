"""Scheduled runner for Git-native object garbage collection."""

from __future__ import annotations

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.dependencies import get_repo_manager_standalone
from src.mut_engine.services.object_gc import GitObjectGcResult, run_git_object_gc
from src.utils.logger import log_error, log_info, log_warning


def process_object_gc_projects(
    *,
    repo_manager=None,
    client=None,
    project_ids: list[str] | None = None,
    dry_run: bool | None = None,
    retention_seconds: int | None = None,
    max_projects: int | None = None,
    max_delete_per_project: int | None = None,
) -> list[GitObjectGcResult]:
    """Run one GC pass across a bounded set of projects.

    The job is disabled by default and dry-runs by default. Production can turn
    it on gradually by first observing dry-run metrics, then flipping
    ``MUT_OBJECT_GC_DRY_RUN=false`` after the root set is validated.
    """

    if not settings.MUT_OBJECT_GC_ENABLED and project_ids is None:
        return []

    repos = repo_manager or get_repo_manager_standalone()
    db = client or SupabaseClient().client
    ids = project_ids or _list_project_ids(
        db,
        limit=max_projects or settings.MUT_OBJECT_GC_MAX_PROJECTS_PER_RUN,
    )
    dry = settings.MUT_OBJECT_GC_DRY_RUN if dry_run is None else dry_run
    retention = (
        settings.MUT_OBJECT_GC_RETENTION_SECONDS
        if retention_seconds is None
        else retention_seconds
    )
    max_delete = (
        settings.MUT_OBJECT_GC_MAX_DELETE_PER_PROJECT
        if max_delete_per_project is None
        else max_delete_per_project
    )

    results: list[GitObjectGcResult] = []
    for project_id in ids:
        try:
            repo = repos.get_server_repo(project_id)
            result = run_git_object_gc(
                repo,
                dry_run=dry,
                retention_seconds=retention,
                max_delete=max_delete,
            )
            results.append(result)
            if result.unreachable_count or result.deleted_count or result.errors:
                log_info(
                    f"[object-gc] project={project_id} dry_run={dry} "
                    f"total={result.total_objects} "
                    f"reachable={result.reachable_count} "
                    f"unreachable={result.unreachable_count} "
                    f"eligible={result.eligible_count} "
                    f"deleted={result.deleted_count} "
                    f"young={result.kept_young_count} "
                    f"unknown_age={result.kept_unknown_age_count} "
                    f"protected_descendants={result.kept_protected_descendant_count} "
                    f"errors={len(result.errors)}"
                )
        except Exception as exc:  # noqa: BLE001 - one project must not stop the pass.
            log_warning(f"[object-gc] project {project_id} failed: {exc}")

    return results


def _list_project_ids(client, *, limit: int) -> list[str]:
    limit = max(1, min(int(limit or 1), 500))
    try:
        resp = (
            client.table("projects")
            .select("id")
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [row["id"] for row in (resp.data or []) if row.get("id")]
    except Exception as exc:  # noqa: BLE001
        log_error(f"[object-gc] failed to list projects: {exc}")
        return []

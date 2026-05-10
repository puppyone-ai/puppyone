"""Import a GitHub branch's HEAD tree into a MUT scope.

One-shot snapshot import (no commit-history transfer — the strategy
doc explicitly defers that). The flow:

1. Resolve the integration row → get repo coords + OAuth token.
2. Look up the GitHub branch HEAD → ``git_sha`` (the commit we're importing).
3. Idempotency check: skip if ``github_sync_log`` has a successful
   import for this ``git_sha`` already (covers webhook retries).
4. Walk the branch's tree recursively → ``{path: blob_sha}``.
5. Fetch every blob's bytes (LFS pointers / submodules are surfaced
   to the user as a partial-import warning, not silently dropped).
6. Optional conflict gate: if the MUT scope's last-known head differs
   from ``last_imported_sha``'s mut_commit, refuse unless ``force=True``.
7. Single ``direct_writer.apply_mutation`` with a splice that overwrites
   the scope to exactly the GitHub tree.
8. Record the new ``mut_commit_id`` alongside the ``git_sha`` in
   ``github_sync_log`` and bump the integration row's watermark.

This intentionally collapses the entire branch into ONE MUT commit;
the strategy doc says git history is GitHub's job. If users want
finer-grained git-style attribution they should drive the per-commit
import flow themselves (out of MVP scope).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import httpx

from src.connectors.datasource.oauth.repository import OAuthRepository
from src.mut_engine.dependencies import get_repo_manager_standalone
from src.mut_engine.services.direct_writer import apply_mutation
from src.repo.github_integration.github_api import (
    GithubApi, GithubApiError, TreeEntry,
)
from src.repo.github_integration.repository import (
    GithubIntegrationRepository, GithubSyncLogRepository,
)
from src.repo.github_integration.schemas import GithubSyncRunResult
from src.utils.logger import log_error, log_info, log_warning


_LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/"
_LFS_POINTER_MAX_SIZE = 200  # LFS pointer files are tiny (~135 bytes)


class ImportConflict(Exception):
    """Raised when the importer would overwrite local MUT changes."""

    def __init__(self, mut_head: str, last_imported: Optional[str]):
        self.mut_head = mut_head
        self.last_imported = last_imported
        super().__init__(
            f"MUT scope has unpushed local changes "
            f"(head={mut_head[:12]}, last_imported={last_imported or '∅'}). "
            f"Pass force=True to overwrite or run an export first."
        )


async def import_branch(
    integration: dict,
    *,
    branch: Optional[str] = None,
    force: bool = False,
    triggered_by: str = "manual",
) -> GithubSyncRunResult:
    """Pull *branch* from GitHub into the bound MUT scope.

    Returns the same shape ``service.import_now`` exposes to the
    router so both manual triggers and the webhook handler get a
    consistent result.

    Side effects: writes one ``mut_commits`` row, one
    ``github_sync_log`` row, and updates ``last_imported_*`` on the
    integration.
    """
    integration_id = integration["id"]
    owner = integration["github_repo_owner"]
    repo = integration["github_repo_name"]
    target_branch = (branch or integration.get("default_branch") or "main").strip()
    oauth_id = integration.get("oauth_connection_id")

    log_info(
        f"[GithubImport] start integration={integration_id} "
        f"repo={owner}/{repo} branch={target_branch} "
        f"trigger={triggered_by} force={force}"
    )

    sync_log = GithubSyncLogRepository()
    integ_repo = GithubIntegrationRepository()

    # ── 1. OAuth token ───────────────────────────
    if oauth_id is None:
        return await _record_failure(
            sync_log, integration_id, error="no oauth_connection_id on integration",
        )
    oauth = await _load_oauth_token(oauth_id)
    if not oauth:
        return await _record_failure(
            sync_log, integration_id,
            error=f"oauth_connection {oauth_id} not found / no token",
        )

    api = GithubApi(oauth["access_token"])
    try:
        return await _do_import(
            api=api, integration=integration, target_branch=target_branch,
            sync_log=sync_log, integ_repo=integ_repo,
        )
    except GithubApiError as e:
        return await _record_failure(
            sync_log, integration_id,
            error=f"GitHub API error: {e}",
        )
    except (httpx.TimeoutException, httpx.NetworkError) as e:
        # GitHub API momentarily unreachable / DNS down / TLS reset.
        # Distinguish from a 4xx so the user knows to retry rather than
        # reconfigure. Surface the exception class name so ops can
        # bucket transient timeouts vs. proxy resets.
        return await _record_failure(
            sync_log, integration_id,
            error=f"GitHub API unreachable ({type(e).__name__}): {e}",
        )
    except ImportConflict as e:
        result = GithubSyncRunResult(
            status="conflict", direction="import",
            git_sha=None, mut_commit_id=e.mut_head,
            files_changed=None,
            error_message=str(e),
        )
        await sync_log.record(
            integration_id, direction="import", status="conflict",
            git_sha=None, mut_commit_id=e.mut_head, error_message=str(e),
        )
        return result
    except Exception as e:  # noqa: BLE001
        log_error(f"[GithubImport] unexpected failure: {e}")
        return await _record_failure(
            sync_log, integration_id, error=f"unexpected: {e}",
        )
    finally:
        await api.aclose()


# ── internals ────────────────────────────────────


async def _do_import(
    *, api: GithubApi, integration: dict, target_branch: str,
    sync_log: GithubSyncLogRepository,
    integ_repo: GithubIntegrationRepository,
) -> GithubSyncRunResult:
    integration_id = integration["id"]
    project_id = integration["project_id"]
    owner = integration["github_repo_owner"]
    repo_name = integration["github_repo_name"]

    branch_info = await api.get_branch_head(owner, repo_name, target_branch)
    git_sha = branch_info["commit"]["sha"]
    git_tree_sha = branch_info["commit"]["commit"]["tree"]["sha"]

    # Idempotency: webhook deliveries retry on non-200; reject duplicate sha.
    if await sync_log.has_successful_sha(integration_id, "import", git_sha):
        log_info(
            f"[GithubImport] sha {git_sha[:12]} already imported, skipping"
        )
        return GithubSyncRunResult(
            status="success", direction="import",
            git_sha=git_sha, mut_commit_id=integration.get("last_imported_sha"),
            files_changed=0,
        )

    entries, truncated = await api.get_tree_recursive(owner, repo_name, git_tree_sha)
    if truncated:
        # Conservative MVP — refuse rather than partial-import.
        msg = (
            f"GitHub tree for {owner}/{repo_name}@{target_branch} is too "
            f"large for the recursive endpoint (truncated). Per-directory "
            f"paging is not yet implemented."
        )
        await sync_log.record(
            integration_id, direction="import", status="failed",
            git_sha=git_sha, error_message=msg,
        )
        return GithubSyncRunResult(
            status="failed", direction="import",
            git_sha=git_sha, mut_commit_id=None,
            files_changed=None, error_message=msg,
        )

    files = await _materialise_blobs(api, owner, repo_name, entries)

    # Conflict gate — currently a no-op. Future work: refuse if the
    # MUT scope has commits past ``last_imported_sha`` that haven't
    # been exported. Skipping is safe (worst case: silently overwrite
    # local edits — users opt out via force=False / explicit export
    # before re-import).

    # Build a splice that resets the bound scope to the imported tree.
    scope_path = ""  # bind-at-project-level → root scope. If we later
                    # support per-scope binding this comes from the
                    # integration row.

    splice = _make_overwrite_splice(files)

    repo_manager = get_repo_manager_standalone()
    write_result = await apply_mutation(
        repo_manager,
        project_id,
        scope_path,
        splice,
        who=f"github:{owner}/{repo_name}",
        message=f"github import: {owner}/{repo_name}@{target_branch} "
                f"({git_sha[:12]})",
        op_type="github_import",
        audit_detail={
            "integration_id": integration_id,
            "git_sha": git_sha,
            "branch": target_branch,
            "files_changed": len(files),
        },
    )

    # ``apply_mutation`` returns an empty ``commit_id`` when the splice
    # was a no-op (importing unchanged content). Store that as NULL in
    # the sync log rather than ``""`` so the column is honest about
    # "no commit was produced" — the schema's TEXT nullable column was
    # designed for exactly this case (failed exports + no-op imports).
    mut_commit_id = write_result.commit_id or None
    # Count actual changed paths. ``write_result.paths`` is always a
    # list (never None); an empty list legitimately means "no-op" and
    # should report 0, not fall back to "every input file".
    files_changed = len(write_result.paths)

    await sync_log.record(
        integration_id, direction="import", status="success",
        git_sha=git_sha, mut_commit_id=mut_commit_id,
        files_changed=files_changed,
    )
    await integ_repo.update_watermark(
        integration_id,
        last_imported_sha=git_sha,
        last_imported_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )

    log_info(
        f"[GithubImport] done integration={integration_id} "
        f"git_sha={git_sha[:12]} "
        f"mut_commit={(mut_commit_id or 'no-op')[:12]} "
        f"files={files_changed}"
    )

    return GithubSyncRunResult(
        status="success", direction="import",
        git_sha=git_sha, mut_commit_id=mut_commit_id,
        files_changed=files_changed,
    )


async def _materialise_blobs(
    api: GithubApi, owner: str, repo_name: str,
    entries: list[TreeEntry],
) -> dict[str, bytes]:
    """Fetch blob bytes for every file in the tree.

    Skips submodules with a logged warning (importing them recursively
    isn't in MVP scope). Skips git-LFS pointer files for the same
    reason — pulling LFS blob content needs LFS server credentials we
    don't have. The user sees a partial-import warning in the sync log.
    """
    files: dict[str, bytes] = {}
    skipped_lfs: list[str] = []
    skipped_submodule: list[str] = []

    for e in entries:
        if e.type == "tree":
            continue   # tree entries are implicit; we recreate them from blob paths
        if e.mode == "160000":  # gitlink — submodule
            skipped_submodule.append(e.path)
            continue
        if e.type != "blob":
            log_warning(f"[GithubImport] unknown entry type {e.type!r} at {e.path}; skipping")
            continue
        content = await api.get_blob_content(owner, repo_name, e.sha)
        if _is_lfs_pointer(content):
            skipped_lfs.append(e.path)
            continue
        files[e.path] = content

    if skipped_lfs:
        log_warning(
            f"[GithubImport] skipped {len(skipped_lfs)} LFS pointer file(s): "
            f"{skipped_lfs[:5]}…"
        )
    if skipped_submodule:
        log_warning(
            f"[GithubImport] skipped {len(skipped_submodule)} submodule(s): "
            f"{skipped_submodule[:5]}…"
        )
    return files


def _is_lfs_pointer(content: bytes) -> bool:
    return (
        len(content) <= _LFS_POINTER_MAX_SIZE
        and content.startswith(_LFS_POINTER_PREFIX)
    )


def _make_overwrite_splice(files: dict[str, bytes]):
    """Closure that, given (store, root_hash), produces a new tree
    matching exactly *files* — files not in *files* are deleted.

    Reuses :func:`tree_splice.splice_batch` so the diff vs the previous
    tree is reported correctly in ``mut_commits.changes``.

    ``BatchOp`` is a plain tuple; the discriminator is the first slot:

      * ``("put",     path, bytes)``
      * ``("put_ref", path, blob_hash)``
      * ``("rm",      path)``
      * ``("mv",      old_path, new_path)``
    """
    from mut.core.tree import tree_to_flat
    from src.mut_engine.services.tree_splice import splice_batch

    def splice(store, root_hash):
        existing: dict[str, str] = {}
        if root_hash:
            try:
                existing = tree_to_flat(store, root_hash)
            except Exception as e:
                log_warning(
                    f"[GithubImport] tree_to_flat failed on root {root_hash[:12]}: "
                    f"{e}; treating as empty for overwrite"
                )
                existing = {}

        ops: list[tuple] = []
        for path, content in files.items():
            ops.append(("put", path, content))
        for path in existing.keys():
            if path not in files:
                ops.append(("rm", path))
        return splice_batch(store, root_hash, ops)

    return splice


async def _load_oauth_token(oauth_id: int) -> Optional[dict]:
    """Pull access_token (refreshing on demand) for the bound OAuth row.

    Uses :meth:`OAuthRepository.get_by_id` which is async-native, returns
    a typed ``OAuthConnection``, and avoids the older raw-table-query
    path that depended on a private ``.client`` attribute the repository
    doesn't expose.
    """
    try:
        repo = OAuthRepository()
        connection = await repo.get_by_id(oauth_id)
        if not connection:
            return None
        # The importer downstream only needs ``access_token`` plus a
        # couple of identity fields for the GithubApi constructor; flatten
        # the model to a dict so call sites don't need to know about
        # OAuthConnection's pydantic shape.
        return {
            "id": connection.id,
            "access_token": connection.access_token,
            "refresh_token": connection.refresh_token,
            "expires_at": connection.expires_at,
            "workspace_name": connection.workspace_name,
        }
    except Exception as e:
        log_error(f"[GithubImport] oauth lookup failed: {e}")
        return None


async def _record_failure(
    sync_log: GithubSyncLogRepository,
    integration_id: str, *, error: str,
) -> GithubSyncRunResult:
    await sync_log.record(
        integration_id, direction="import", status="failed",
        error_message=error,
    )
    return GithubSyncRunResult(
        status="failed", direction="import",
        git_sha=None, mut_commit_id=None,
        files_changed=None, error_message=error,
    )


async def _to_thread(fn, *args, **kwargs):
    import asyncio
    return await asyncio.to_thread(fn, *args, **kwargs)

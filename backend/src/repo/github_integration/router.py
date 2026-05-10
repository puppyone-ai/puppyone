"""HTTP router for the GitHub Integration module.

Mounted at ``/api/v1/projects/{project_id}/github`` (per-project) and
``/api/v1/internal/github/webhook`` (callback from GitHub).

Endpoints:

* ``POST   /api/v1/projects/{pid}/github/connect``    — bind project ↔ repo
* ``PATCH  /api/v1/projects/{pid}/github``            — update binding
* ``DELETE /api/v1/projects/{pid}/github``            — disconnect
* ``GET    /api/v1/projects/{pid}/github/status``     — current binding
* ``GET    /api/v1/projects/{pid}/github/repos``      — repo picker
* ``POST   /api/v1/projects/{pid}/github/import``     — manual import
* ``POST   /api/v1/projects/{pid}/github/export``     — manual export
* ``GET    /api/v1/projects/{pid}/github/sync-log``   — recent imports/exports

Plus the public webhook receiver (no per-project prefix because GitHub
delivers to a single URL):

* ``POST   /api/v1/integrations/github/webhook``
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.platform.auth.dependencies import get_current_user
from src.repo.github_integration.schemas import (
    GithubExportRequest, GithubImportRequest, GithubIntegrationCreate,
    GithubIntegrationStatus, GithubIntegrationUpdate,
    GithubRepoList, GithubSyncLogList, GithubSyncRunResult,
)
from src.repo.github_integration.service import (
    GithubIntegrationNotFound, GithubIntegrationService,
)
from src.repo.github_integration.webhook import WebhookRejection, handle_webhook
from src.utils.logger import log_error, log_info


# Per-project router — gated by JWT.
router = APIRouter(
    prefix="/api/v1/projects/{project_id}/github",
    tags=["github-integration"],
)

# Public webhook receiver — no auth gate (HMAC verifies authenticity).
webhook_router = APIRouter(
    prefix="/api/v1/integrations/github",
    tags=["github-integration"],
)


def _service() -> GithubIntegrationService:
    return GithubIntegrationService()


# ── Project-scoped routes ──────────────────────────────


@router.post("/connect", response_model=GithubIntegrationStatus)
async def connect(
    project_id: str,
    payload: GithubIntegrationCreate,
    user=Depends(get_current_user),
) -> GithubIntegrationStatus:
    try:
        return await _service().connect(project_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        log_error(f"[GithubIntegration] connect failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("", response_model=GithubIntegrationStatus)
async def update(
    project_id: str,
    payload: GithubIntegrationUpdate,
    user=Depends(get_current_user),
) -> GithubIntegrationStatus:
    try:
        return await _service().update(project_id, payload)
    except GithubIntegrationNotFound:
        raise HTTPException(status_code=404, detail="github integration not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    project_id: str,
    user=Depends(get_current_user),
):
    await _service().disconnect(project_id)


@router.get("/status", response_model=GithubIntegrationStatus | None)
async def get_status(
    project_id: str,
    user=Depends(get_current_user),
) -> GithubIntegrationStatus | None:
    return await _service().status(project_id)


@router.get("/repos", response_model=GithubRepoList)
async def list_repos(
    project_id: str,
    oauth_connection_id: int = Query(..., description="The user's GitHub OAuth row id"),
    user=Depends(get_current_user),
) -> GithubRepoList:
    """List the OAuth user's GitHub repositories.

    The OAuth connection id is supplied explicitly so the UI can drive
    the picker before the integration is bound (we don't yet know which
    OAuth row to use). After ``connect`` the same id is stored on the
    integration row and reused for imports/exports.
    """
    try:
        return await _service().list_user_repos(oauth_connection_id)
    except GithubIntegrationNotFound:
        raise HTTPException(status_code=404, detail="oauth connection not found")
    except Exception as e:  # noqa: BLE001
        log_error(f"[GithubIntegration] list_repos failed: {e}")
        raise HTTPException(status_code=502, detail=f"GitHub API: {e}")


@router.post("/import", response_model=GithubSyncRunResult)
async def import_now(
    project_id: str,
    payload: GithubImportRequest,
    user=Depends(get_current_user),
) -> GithubSyncRunResult:
    try:
        return await _service().import_now(project_id, payload)
    except GithubIntegrationNotFound:
        raise HTTPException(status_code=404, detail="github integration not configured")


@router.post("/export", response_model=GithubSyncRunResult)
async def export_now(
    project_id: str,
    payload: GithubExportRequest,
    user=Depends(get_current_user),
) -> GithubSyncRunResult:
    try:
        return await _service().export_now(project_id, payload)
    except GithubIntegrationNotFound:
        raise HTTPException(status_code=404, detail="github integration not configured")


@router.get("/sync-log", response_model=GithubSyncLogList)
async def sync_log(
    project_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user=Depends(get_current_user),
) -> GithubSyncLogList:
    try:
        return await _service().list_sync_log(
            project_id, limit=limit, offset=offset,
        )
    except GithubIntegrationNotFound:
        raise HTTPException(status_code=404, detail="github integration not configured")


# ── Webhook receiver ───────────────────────────────────


@webhook_router.post("/webhook")
async def github_webhook(request: Request):
    raw = await request.body()
    try:
        json_payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid JSON")

    headers = {k.lower(): v for k, v in request.headers.items()}
    log_info(
        f"[GithubWebhook] received delivery="
        f"{headers.get('x-github-delivery', '?')}"
    )

    try:
        return await handle_webhook(raw, headers, json_payload)
    except WebhookRejection as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    except Exception as e:  # noqa: BLE001
        log_error(f"[GithubWebhook] unexpected: {e}")
        raise HTTPException(status_code=500, detail="webhook handler failed")

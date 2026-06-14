"""HTTP API for the scope-sandbox "sandbox as access point" feature (#9).

Endpoints (JWT auth, project-scoped):
  POST /api/v1/scope-sandboxes/connect  → acquire/reuse the scope's sandbox,
        grant the caller a short-lived SSH key, return VSCode Remote-SSH info.
  GET  /api/v1/scope-sandboxes/status   → current session state for a scope.
  POST /api/v1/scope-sandboxes/revoke   → revoke the caller's SSH access.

The provider (Fly/E2B) is chosen per request (frontend selection), defaulting to
``settings.SCOPE_SANDBOX_PROVIDER``. All git/CLI runs inside the sandbox; the
scope's access key stays server-side (embedded in the in-box git remote URL).
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse
from src.config import settings
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService
from src.platform.scope_sandbox.service import (
    ScopeSandboxService,
    get_scope_sandbox_service,
)

router = APIRouter(prefix="/api/v1/scope-sandboxes", tags=["scope-sandboxes"])


class ConnectRequest(BaseModel):
    project_id: str
    scope_id: str
    public_key: str = Field(..., description="The user's SSH public key (ed25519/rsa)")
    provider: str | None = Field(None, description="fly | e2b; defaults to server config")


class RevokeRequest(BaseModel):
    project_id: str
    scope_id: str


def _ensure_project_access(project_service: ProjectService, current_user: CurrentUser, project_id: str):
    project = project_service.get_by_id_with_access_check(project_id, current_user.user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _public_base(request: Request) -> str:
    base = (settings.PUBLIC_URL or "").strip()
    return base.rstrip("/") if base else str(request.base_url).rstrip("/")


def _user_name(current_user: CurrentUser) -> str:
    meta = current_user.user_metadata or {}
    return meta.get("name") or meta.get("full_name") or current_user.email or "puppyone"


@router.post("/connect", response_model=ApiResponse)
async def connect(
    payload: ConnectRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
    service: ScopeSandboxService = Depends(get_scope_sandbox_service),
):
    _ensure_project_access(project_service, current_user, payload.project_id)
    if not payload.public_key.strip():
        raise HTTPException(status_code=400, detail="public_key is required")
    if payload.provider and payload.provider not in ("fly", "e2b"):
        raise HTTPException(status_code=400, detail="provider must be 'fly' or 'e2b'")
    try:
        info = await service.connect(
            project_id=payload.project_id,
            scope_id=payload.scope_id,
            user_id=current_user.user_id,
            user_email=current_user.email or "user@puppyone.ai",
            user_name=_user_name(current_user),
            public_key=payload.public_key.strip(),
            public_base=_public_base(request),
            provider_name=payload.provider,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Scope not found in project")
    return ApiResponse.success(data=asdict(info), message="Sandbox ready")


@router.get("/providers", response_model=ApiResponse)
def providers(
    current_user: CurrentUser = Depends(get_current_user),
    service: ScopeSandboxService = Depends(get_scope_sandbox_service),
):
    """Which sandbox providers this deployment offers + the default (for the
    frontend's provider selector). Auth required, but not project-scoped."""
    return ApiResponse.success(data=service.available_providers())


@router.get("/status", response_model=ApiResponse)
def status(
    project_id: str = Query(...),
    scope_id: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
    service: ScopeSandboxService = Depends(get_scope_sandbox_service),
):
    _ensure_project_access(project_service, current_user, project_id)
    data = service.status(project_id=project_id, scope_id=scope_id, user_id=current_user.user_id)
    return ApiResponse.success(data=data)


@router.post("/revoke", response_model=ApiResponse)
async def revoke(
    payload: RevokeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    project_service: ProjectService = Depends(get_project_service),
    service: ScopeSandboxService = Depends(get_scope_sandbox_service),
):
    _ensure_project_access(project_service, current_user, payload.project_id)
    remaining = await service.revoke(
        project_id=payload.project_id, scope_id=payload.scope_id, user_id=current_user.user_id,
    )
    return ApiResponse.success(data={"connected_users": remaining}, message="Access revoked")

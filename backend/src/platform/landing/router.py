from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile

from src.common_schemas import ApiResponse
from src.config import settings
from src.infra.s3.dependencies import get_s3_service
from src.infra.s3.service import S3Service
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.landing import tickets
from src.platform.landing.registry import get_tool_spec
from src.platform.landing.schemas import (
    ClaimRequest,
    ClaimResponse,
    PreviewResponse,
)
from src.platform.landing.service import LandingService
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/landing", tags=["landing"])

# Hard ceiling on the anonymous, login-free preview path. The website should
# enforce a smaller limit + CAPTCHA + per-IP rate-limiting at its edge (M5).
MAX_PREVIEW_BYTES = 25 * 1024 * 1024


def get_landing_service(
    s3: S3Service = Depends(get_s3_service),
    projects: ProjectService = Depends(get_project_service),
) -> LandingService:
    return LandingService(s3, projects)


def _check_proxy_secret(x_landing_secret: str | None) -> None:
    """Defense-in-depth: if LANDING_INGEST_SECRET is configured, the public
    preview endpoint only accepts calls that carry it — i.e. only the website's
    server-side proxy can reach it, never a raw browser. If unset (dev), the
    check is skipped."""
    expected = settings.LANDING_INGEST_SECRET
    if expected and x_landing_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid landing proxy secret")


@router.post(
    "/preview",
    response_model=ApiResponse[PreviewResponse],
    summary="Parse an uploaded source into a previewable MCP (login-free, no DB rows)",
)
async def landing_preview(
    tool_kind: str = Form(..., description="Registry key, e.g. 'pdf'"),
    file: UploadFile = File(...),
    x_landing_secret: str | None = Header(default=None),
    service: LandingService = Depends(get_landing_service),
):
    _check_proxy_secret(x_landing_secret)
    try:
        get_tool_spec(tool_kind)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_PREVIEW_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is {len(content)} bytes; preview cap is {MAX_PREVIEW_BYTES}.",
        )

    try:
        result = await service.preview(
            tool_kind=tool_kind,
            filename=file.filename or "file",
            content=content,
            content_type=file.content_type,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - surface parse/storage failures cleanly
        logger.exception("landing preview failed for tool_kind=%s", tool_kind)
        raise HTTPException(status_code=502, detail=f"Preview failed: {exc}")

    return ApiResponse.success(data=result, message="Preview ready")


@router.post(
    "/claim",
    response_model=ApiResponse[ClaimResponse],
    summary="Turn a previewed ticket into a real, owned project + MCP endpoint",
)
async def landing_claim(
    payload: ClaimRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: LandingService = Depends(get_landing_service),
):
    try:
        result = await service.claim(
            ticket=payload.ticket, user_id=current_user.user_id
        )
    except tickets.TicketError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid ticket: {exc}")
    return ApiResponse.success(data=result, message="Claimed")

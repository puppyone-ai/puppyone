"""
Audit Logs — API Router

Endpoints:
  GET  /nodes/{node_id}/audit-logs     节点审计日志
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from datetime import datetime

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.project.service import ProjectService
from src.project.dependencies import get_project_service
from src.collaboration.audit_repository import AuditRepository
from src.supabase.client import SupabaseClient
from src.common_schemas import ApiResponse


router = APIRouter(prefix="/nodes", tags=["audit-logs"])


# ============================================================
# Response Schemas
# ============================================================

class AuditLogItem(BaseModel):
    id: int
    action: str
    node_id: str
    old_version: Optional[int] = None
    new_version: Optional[int] = None
    operator_type: str
    operator_id: Optional[str] = None
    status: Optional[str] = None
    strategy: Optional[str] = None
    conflict_details: Optional[str] = None
    metadata: Optional[dict] = None
    created_at: Optional[datetime] = None


class AuditLogListResponse(BaseModel):
    node_id: str
    logs: List[AuditLogItem]
    total: int


# ============================================================
# Dependencies
# ============================================================

def _get_audit_repo() -> AuditRepository:
    return AuditRepository(SupabaseClient())


def _ensure_project_access(
    project_service: ProjectService, current_user: CurrentUser, project_id: str
):
    project = project_service.get_project(project_id)
    if not project:
        from src.exceptions import NotFoundException, ErrorCode
        raise NotFoundException("Project not found", code=ErrorCode.NOT_FOUND)


# ============================================================
# Endpoints
# ============================================================

@router.get("/{node_id}/audit-logs", response_model=ApiResponse[AuditLogListResponse])
def get_node_audit_logs(
    node_id: str,
    project_id: str = Query(..., description="Project ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    audit_repo: AuditRepository = Depends(_get_audit_repo),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取节点的审计日志"""
    _ensure_project_access(project_service, current_user, project_id)

    rows = audit_repo.list_by_node(node_id, limit, offset)
    total = audit_repo.count_by_node(node_id)

    logs = [AuditLogItem(**row) for row in rows]

    return ApiResponse.success(data=AuditLogListResponse(
        node_id=node_id,
        logs=logs,
        total=total,
    ))

from typing import List, Optional

from fastapi import Depends
from src.organization.repository import OrganizationRepository
from src.organization.service import OrganizationService
from src.exceptions import PermissionException, ErrorCode

_org_repository = None
_org_service = None


def get_org_repository() -> OrganizationRepository:
    global _org_repository
    if _org_repository is None:
        _org_repository = OrganizationRepository()
    return _org_repository


def get_org_service() -> OrganizationService:
    global _org_service
    if _org_service is None:
        _org_service = OrganizationService(get_org_repository())
    return _org_service


def resolve_org_id(org_id: Optional[str], user_id: str) -> str:
    """Resolve org_id: if provided, verify membership; otherwise fall back to user's first org."""
    repo = get_org_repository()
    if org_id:
        if not repo.get_member(org_id, user_id):
            raise PermissionException(
                "Not a member of this organization", code=ErrorCode.FORBIDDEN
            )
        return org_id
    user_orgs = repo.list_by_user(user_id)
    if not user_orgs:
        raise PermissionException("User has no organization", code=ErrorCode.FORBIDDEN)
    return user_orgs[0].id


def resolve_org_ids(org_id: Optional[str], user_id: str) -> List[str]:
    """Resolve to a list of org_ids: if provided, verify and return [org_id]; otherwise return all user's org ids."""
    repo = get_org_repository()
    if org_id:
        if not repo.get_member(org_id, user_id):
            raise PermissionException(
                "Not a member of this organization", code=ErrorCode.FORBIDDEN
            )
        return [org_id]
    user_orgs = repo.list_by_user(user_id)
    if not user_orgs:
        raise PermissionException("User has no organization", code=ErrorCode.FORBIDDEN)
    return [o.id for o in user_orgs]

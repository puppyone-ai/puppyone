from fastapi import Depends, HTTPException

from src.sandbox_endpoint.repository import SandboxEndpointRepository
from src.sandbox_endpoint.service import SandboxEndpointService
from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser


def get_sandbox_endpoint_repository() -> SandboxEndpointRepository:
    return SandboxEndpointRepository()


def get_sandbox_endpoint_service(
    repo: SandboxEndpointRepository = Depends(get_sandbox_endpoint_repository),
) -> SandboxEndpointService:
    return SandboxEndpointService(repository=repo)


def get_verified_sandbox_endpoint(
    endpoint_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: SandboxEndpointService = Depends(get_sandbox_endpoint_service),
) -> dict:
    endpoint = service.get_endpoint(endpoint_id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Sandbox endpoint not found")
    if not service.verify_access(endpoint_id, current_user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return endpoint

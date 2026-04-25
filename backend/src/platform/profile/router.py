"""
Profile API Router

Provides API endpoints for user Profile
"""

from fastapi import APIRouter, Depends, status

from src.common_schemas import ApiResponse
from src.platform.auth.dependencies import CurrentUser, get_current_user
from src.platform.profile.dependencies import get_profile_service
from src.platform.profile.schemas import ProfileResponse
from src.platform.profile.service import ProfileService

router = APIRouter(
    prefix="/api/v1/profile",
    tags=["Profile"],
)


@router.get(
    "/me",
    response_model=ApiResponse[ProfileResponse],
    summary="Get current user Profile",
    description="Get the Profile information of the currently logged-in user",
    status_code=status.HTTP_200_OK,
)
def get_my_profile(
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get current user Profile"""
    profile = profile_service.get_profile(current_user.user_id)

    if profile is None:
        return ApiResponse.error(
            code=404,
            message="Profile not found",
        )

    return ApiResponse.success(
        data=ProfileResponse(
            user_id=profile.user_id,
            email=profile.email,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
            default_org_id=profile.default_org_id,
            has_onboarded=profile.has_onboarded,
            onboarded_at=profile.onboarded_at,
            demo_project_id=profile.demo_project_id,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        ),
        message="Profile retrieved successfully",
    )

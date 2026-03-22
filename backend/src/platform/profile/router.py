"""
Profile API Router

Provides API endpoints for user Profile and Onboarding
"""

from fastapi import APIRouter, Depends, status

from src.platform.auth.dependencies import get_current_user, CurrentUser
from src.common_schemas import ApiResponse
from src.platform.profile.dependencies import get_profile_service
from src.platform.profile.service import ProfileService
from src.platform.profile.schemas import (
    ProfileResponse,
    OnboardingStatusResponse,
    OnboardingCompleteRequest,
    ResetOnboardingResponse,
)

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


@router.get(
    "/onboarding/status",
    response_model=ApiResponse[OnboardingStatusResponse],
    summary="Check Onboarding status",
    description="Check whether the current user has completed Onboarding and return the redirect path",
    status_code=status.HTTP_200_OK,
)
def check_onboarding_status(
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Check Onboarding status

    The frontend should call this endpoint after successful login to determine the redirect target:
    - If is_new_user=true, redirect to redirect_to and show the welcome dialog
    - If is_new_user=false, redirect to redirect_to

    Note: If Profile does not exist, it will be auto-created (ensuring new users can function normally)
    """
    has_onboarded, demo_project_id, redirect_to = profile_service.check_onboarding_status(
        user_id=current_user.user_id,
        email=current_user.email,  # Pass email to enable auto-creation of Profile
    )

    return ApiResponse.success(
        data=OnboardingStatusResponse(
            has_onboarded=has_onboarded,
            demo_project_id=demo_project_id,
            redirect_to=redirect_to,
            is_new_user=not has_onboarded,
        ),
        message="Onboarding status retrieved",
    )


@router.post(
    "/onboarding/complete",
    response_model=ApiResponse[OnboardingStatusResponse],
    summary="Complete Onboarding",
    description="Mark user as having completed Onboarding; auto-creates Demo Project if needed",
    status_code=status.HTTP_200_OK,
)
async def complete_onboarding(
    request: OnboardingCompleteRequest = OnboardingCompleteRequest(),
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Complete Onboarding

    This endpoint will:
    1. Auto-create Profile if it does not exist
    2. Create Demo Project if user is not yet onboarded (and no demo_project_id is provided)
    3. Mark user as onboarded
    4. Return redirect path (with ?welcome=true for displaying the welcome dialog)
    """
    success, redirect_to, demo_project_id = await profile_service.complete_onboarding(
        user_id=current_user.user_id,
        email=current_user.email,  # Pass email to enable auto-creation of Profile
        demo_project_id=request.demo_project_id,
    )

    if not success:
        return ApiResponse.error(
            code=500,
            message="Failed to complete onboarding",
        )

    return ApiResponse.success(
        data=OnboardingStatusResponse(
            has_onboarded=True,
            demo_project_id=demo_project_id,
            redirect_to=redirect_to,
            is_new_user=True,  # Just completed onboarding, need to show welcome content
        ),
        message="Onboarding completed successfully",
    )


@router.post(
    "/onboarding/reset",
    response_model=ApiResponse[ResetOnboardingResponse],
    summary="Reset Onboarding status",
    description="Reset user Onboarding status for testing purposes",
    status_code=status.HTTP_200_OK,
)
def reset_onboarding(
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Reset Onboarding status

    This endpoint is for testing purposes and resets the user's onboarding status,
    allowing them to re-experience the first-login flow.

    Note: This endpoint does not delete the Demo Project.
    """
    success, message = profile_service.reset_onboarding(current_user.user_id)

    return ApiResponse.success(
        data=ResetOnboardingResponse(
            success=success,
            message=message,
        ),
        message=message,
    )


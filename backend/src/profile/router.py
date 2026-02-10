"""
Profile API Router

提供用户 Profile 和 Onboarding 相关的 API 端点
"""

from fastapi import APIRouter, Depends, status

from src.auth.dependencies import get_current_user, CurrentUser
from src.common_schemas import ApiResponse
from src.profile.dependencies import get_profile_service
from src.profile.service import ProfileService
from src.profile.schemas import (
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
    summary="获取当前用户 Profile",
    description="获取当前登录用户的 Profile 信息",
    status_code=status.HTTP_200_OK,
)
def get_my_profile(
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """获取当前用户 Profile"""
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
            role=profile.role,
            plan=profile.plan,
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
    summary="检查 Onboarding 状态",
    description="检查当前用户是否已完成 Onboarding，返回重定向路径",
    status_code=status.HTTP_200_OK,
)
def check_onboarding_status(
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    检查 Onboarding 状态

    前端登录成功后应该调用此接口，根据返回结果决定跳转目标：
    - 如果 is_new_user=true，跳转到 redirect_to 并显示欢迎弹窗
    - 如果 is_new_user=false，跳转到 redirect_to
    
    注意：如果 Profile 不存在，会自动创建（确保新用户能正常使用）
    """
    has_onboarded, demo_project_id, redirect_to = profile_service.check_onboarding_status(
        user_id=current_user.user_id,
        email=current_user.email,  # 传递 email 以便自动创建 Profile
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
    summary="完成 Onboarding",
    description="标记用户已完成 Onboarding，如果需要会自动创建 Demo Project",
    status_code=status.HTTP_200_OK,
)
async def complete_onboarding(
    request: OnboardingCompleteRequest = OnboardingCompleteRequest(),
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    完成 Onboarding

    此接口会：
    1. 如果 Profile 不存在，自动创建
    2. 如果用户未 onboarded，创建 Demo Project（如果没有提供 demo_project_id）
    3. 标记用户为已 onboarded
    4. 返回重定向路径（带 ?welcome=true 用于显示欢迎弹窗）
    """
    success, redirect_to, demo_project_id = await profile_service.complete_onboarding(
        user_id=current_user.user_id,
        email=current_user.email,  # 传递 email 以便自动创建 Profile
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
            is_new_user=True,  # 刚完成 onboarding，需要显示欢迎内容
        ),
        message="Onboarding completed successfully",
    )


@router.post(
    "/onboarding/reset",
    response_model=ApiResponse[ResetOnboardingResponse],
    summary="重置 Onboarding 状态",
    description="重置用户的 Onboarding 状态，用于测试目的",
    status_code=status.HTTP_200_OK,
)
def reset_onboarding(
    profile_service: ProfileService = Depends(get_profile_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    重置 Onboarding 状态

    此接口用于测试目的，可以重置用户的 onboarding 状态，
    使其可以重新体验首次登录流程。

    注意：此接口不会删除 Demo Project。
    """
    success, message = profile_service.reset_onboarding(current_user.user_id)

    return ApiResponse.success(
        data=ResetOnboardingResponse(
            success=success,
            message=message,
        ),
        message=message,
    )


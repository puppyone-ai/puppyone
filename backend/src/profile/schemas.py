"""
Profile API Schemas

定义 Profile 相关的 API 请求和响应模型
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ProfileResponse(BaseModel):
    """Profile 响应模型"""

    user_id: str
    email: str
    role: str
    plan: str
    has_onboarded: bool
    onboarded_at: Optional[datetime] = None
    demo_project_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class OnboardingStatusResponse(BaseModel):
    """Onboarding 状态响应"""

    has_onboarded: bool = Field(..., description="是否已完成 Onboarding")
    demo_project_id: Optional[int] = Field(None, description="Demo Project ID")
    redirect_to: str = Field(
        ..., description="前端应该重定向到的路径"
    )
    is_new_user: bool = Field(..., description="是否是新用户（需要显示欢迎弹窗）")


class OnboardingCompleteRequest(BaseModel):
    """完成 Onboarding 请求"""

    demo_project_id: Optional[int] = Field(
        None, description="Demo Project ID（如果已创建）"
    )


class ResetOnboardingResponse(BaseModel):
    """重置 Onboarding 响应"""

    success: bool
    message: str


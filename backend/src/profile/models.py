"""
Profile 数据模型

定义用户 Profile 的业务领域模型
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class Profile(BaseModel):
    """用户 Profile 领域模型"""

    user_id: str = Field(..., description="用户ID (UUID，关联 auth.users)")
    email: str = Field(..., description="用户邮箱")
    role: str = Field(default="user", description="用户角色: user/admin")
    plan: str = Field(default="free", description="订阅计划: free/plus/pro/team")
    stripe_customer_id: Optional[str] = Field(None, description="Stripe 客户ID")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")

    # Onboarding 相关字段
    has_onboarded: bool = Field(
        default=False, description="是否已完成首次 Onboarding"
    )
    onboarded_at: Optional[datetime] = Field(
        None, description="完成 Onboarding 的时间"
    )
    demo_project_id: Optional[int] = Field(
        None, description="自动创建的 Demo Project ID"
    )

    model_config = ConfigDict(from_attributes=True)


class ProfileUpdate(BaseModel):
    """Profile 更新数据"""

    role: Optional[str] = None
    plan: Optional[str] = None
    stripe_customer_id: Optional[str] = None
    has_onboarded: Optional[bool] = None
    onboarded_at: Optional[datetime] = None
    demo_project_id: Optional[int] = None




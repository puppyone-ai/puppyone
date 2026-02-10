"""
Profile 数据仓库

定义 Profile 的数据访问接口和 Supabase 实现
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from supabase import Client

from src.profile.models import Profile, ProfileUpdate
from src.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error


class ProfileRepositoryBase(ABC):
    """抽象 Profile 仓库接口"""

    @abstractmethod
    def get_by_user_id(self, user_id: str) -> Optional[Profile]:
        """根据用户ID获取 Profile"""
        pass

    @abstractmethod
    def create(self, user_id: str, email: str) -> Optional[Profile]:
        """创建新的 Profile 记录"""
        pass

    @abstractmethod
    def get_or_create(self, user_id: str, email: str) -> Optional[Profile]:
        """获取 Profile，如果不存在则自动创建"""
        pass

    @abstractmethod
    def update(self, user_id: str, data: ProfileUpdate) -> Optional[Profile]:
        """更新 Profile"""
        pass

    @abstractmethod
    def mark_onboarded(
        self, user_id: str, demo_project_id: Optional[int] = None
    ) -> Optional[Profile]:
        """标记用户已完成 Onboarding"""
        pass

    @abstractmethod
    def reset_onboarding(self, user_id: str) -> Optional[Profile]:
        """重置用户 Onboarding 状态（用于测试）"""
        pass


class ProfileRepositorySupabase(ProfileRepositoryBase):
    """基于 Supabase 的 Profile 仓库实现"""

    TABLE_NAME = "profiles"

    def __init__(self, client: Optional[Client] = None):
        if client is None:
            self._client = SupabaseClient().get_client()
        else:
            self._client = client

    def create(self, user_id: str, email: str) -> Optional[Profile]:
        """
        创建新的 Profile 记录
        
        如果 Profile 已存在，返回现有记录（upsert 行为）
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            insert_data = {
                "user_id": user_id,
                "email": email,
                "role": "user",
                "plan": "free",
                "has_onboarded": False,
                "created_at": now,
                "updated_at": now,
            }

            # 使用 upsert 避免重复插入错误
            response = (
                self._client.table(self.TABLE_NAME)
                .upsert(insert_data, on_conflict="user_id")
                .execute()
            )

            if response.data and len(response.data) > 0:
                log_info(f"Profile created/retrieved for user {user_id}")
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to create profile for user {user_id}: {e}")
            return None

    def get_or_create(self, user_id: str, email: str) -> Optional[Profile]:
        """
        获取 Profile，如果不存在则自动创建
        
        这是首选的获取方法，确保 Profile 始终存在
        """
        profile = self.get_by_user_id(user_id)
        if profile is not None:
            return profile
        
        # Profile 不存在，创建新的
        log_info(f"Profile not found for user {user_id}, creating new one")
        return self.create(user_id, email)

    def _row_to_model(self, row: dict) -> Profile:
        """将数据库行转换为 Profile 模型"""
        return Profile(
            user_id=row["user_id"],
            email=row["email"],
            role=row.get("role", "user"),
            plan=row.get("plan", "free"),
            stripe_customer_id=row.get("stripe_customer_id"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            has_onboarded=row.get("has_onboarded", False),
            onboarded_at=row.get("onboarded_at"),
            demo_project_id=row.get("demo_project_id"),
        )

    def get_by_user_id(self, user_id: str) -> Optional[Profile]:
        """根据用户ID获取 Profile"""
        try:
            response = (
                self._client.table(self.TABLE_NAME)
                .select("*")
                .eq("user_id", user_id)
                .single()
                .execute()
            )

            if response.data:
                return self._row_to_model(response.data)
            return None

        except Exception as e:
            # Supabase 在找不到数据时会抛出异常
            log_error(f"Failed to get profile for user {user_id}: {e}")
            return None

    def update(self, user_id: str, data: ProfileUpdate) -> Optional[Profile]:
        """更新 Profile"""
        try:
            update_data = data.model_dump(exclude_unset=True, exclude_none=True)
            update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

            response = (
                self._client.table(self.TABLE_NAME)
                .update(update_data)
                .eq("user_id", user_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to update profile for user {user_id}: {e}")
            return None

    def mark_onboarded(
        self, user_id: str, demo_project_id: Optional[int] = None
    ) -> Optional[Profile]:
        """标记用户已完成 Onboarding"""
        try:
            now = datetime.now(timezone.utc).isoformat()
            update_data = {
                "has_onboarded": True,
                "onboarded_at": now,
                "updated_at": now,
            }

            if demo_project_id is not None:
                update_data["demo_project_id"] = demo_project_id

            response = (
                self._client.table(self.TABLE_NAME)
                .update(update_data)
                .eq("user_id", user_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                log_info(f"User {user_id} marked as onboarded")
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to mark user {user_id} as onboarded: {e}")
            return None

    def reset_onboarding(self, user_id: str) -> Optional[Profile]:
        """重置用户 Onboarding 状态（用于测试）"""
        try:
            now = datetime.now(timezone.utc).isoformat()
            update_data = {
                "has_onboarded": False,
                "onboarded_at": None,
                "demo_project_id": None,
                "updated_at": now,
            }

            response = (
                self._client.table(self.TABLE_NAME)
                .update(update_data)
                .eq("user_id", user_id)
                .execute()
            )

            if response.data and len(response.data) > 0:
                log_info(f"User {user_id} onboarding status reset")
                return self._row_to_model(response.data[0])
            return None

        except Exception as e:
            log_error(f"Failed to reset onboarding for user {user_id}: {e}")
            return None




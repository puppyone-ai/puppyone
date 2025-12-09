"""
User 数据访问层

提供针对 user_temp 表的增删改查操作。
"""

from typing import List, Optional
from supabase import Client

from src.supabase.exceptions import handle_supabase_error
from src.supabase.users.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
)


class UserRepository:
    """User 数据访问仓库"""

    def __init__(self, client: Client):
        """
        初始化仓库

        Args:
            client: Supabase 客户端实例
        """
        self._client = client

    def create(self, user_data: UserCreate) -> UserResponse:
        """
        创建用户

        Args:
            user_data: 用户创建数据

        Returns:
            创建的用户数据

        Raises:
            SupabaseException: 当创建失败时
        """
        try:
            data = user_data.model_dump(exclude_none=True)
            # 确保不包含 id 和 created_at（这些由数据库自动生成）
            data.pop("id", None)
            data.pop("created_at", None)
            response = self._client.table("user_temp").insert(data).execute()
            return UserResponse(**response.data[0])
        except Exception as e:
            raise handle_supabase_error(e, "创建用户")

    def get_by_id(self, user_id: int) -> Optional[UserResponse]:
        """
        根据 ID 获取用户

        Args:
            user_id: 用户 ID

        Returns:
            用户数据，如果不存在则返回 None
        """
        response = (
            self._client.table("user_temp")
            .select("*")
            .eq("id", str(user_id))
            .execute()
        )
        if response.data:
            return UserResponse(**response.data[0])
        return None

    def get_list(
        self,
        skip: int = 0,
        limit: int = 100,
        name: Optional[str] = None,
    ) -> List[UserResponse]:
        """
        获取用户列表

        Args:
            skip: 跳过记录数
            limit: 返回记录数
            name: 可选，按名称过滤

        Returns:
            用户列表
        """
        query = self._client.table("user_temp").select("*")

        if name:
            query = query.eq("name", name)

        response = query.range(skip, skip + limit - 1).execute()
        return [UserResponse(**item) for item in response.data]

    def update(
        self, user_id: int, user_data: UserUpdate
    ) -> Optional[UserResponse]:
        """
        更新用户

        Args:
            user_id: 用户 ID
            user_data: 用户更新数据

        Returns:
            更新后的用户数据，如果不存在则返回 None

        Raises:
            SupabaseException: 当更新失败时
        """
        try:
            data = user_data.model_dump(exclude_none=True)
            if not data:
                return self.get_by_id(user_id)

            # 确保不包含 id 和 created_at
            data.pop("id", None)
            data.pop("created_at", None)

            response = (
                self._client.table("user_temp")
                .update(data)
                .eq("id", str(user_id))
                .execute()
            )
            if response.data:
                return UserResponse(**response.data[0])
            return None
        except Exception as e:
            raise handle_supabase_error(e, "更新用户")

    def delete(self, user_id: int) -> bool:
        """
        删除用户

        Args:
            user_id: 用户 ID

        Returns:
            是否删除成功
        """
        response = (
            self._client.table("user_temp")
            .delete()
            .eq("id", str(user_id))
            .execute()
        )
        return len(response.data) > 0

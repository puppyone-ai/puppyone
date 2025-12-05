from abc import ABC, abstractmethod
from typing import List, Optional

from src.auth.models import User


class UserRepositoryBase(ABC):
    """抽象用户仓库接口"""

    @abstractmethod
    def get_all(self) -> List[User]:
        pass

    @abstractmethod
    def get_by_id(self, user_id: int) -> Optional[User]:
        pass

    @abstractmethod
    def create(self, username: str) -> User:
        pass

    @abstractmethod
    def update(self, user_id: int, username: str) -> Optional[User]:
        pass

    @abstractmethod
    def delete(self, user_id: int) -> bool:
        pass


class UserRepositorySupabase(UserRepositoryBase):
    """基于Supabase的用户仓库实现"""

    def __init__(self, supabase_repo=None):
        """
        初始化仓库

        Args:
            supabase_repo: 可选的 SupabaseRepository 实例，如果不提供则创建新实例
        """
        if supabase_repo is None:
            from src.supabase.repository import SupabaseRepository
            self._supabase_repo = SupabaseRepository()
        else:
            self._supabase_repo = supabase_repo

    def get_all(self) -> List[User]:
        """获取所有用户"""
        users = self._supabase_repo.get_users()
        return [self._user_response_to_user(user) for user in users]

    def get_by_id(self, user_id: int) -> Optional[User]:
        """
        根据ID获取用户

        Args:
            user_id: 用户ID（int）

        Returns:
            User对象，如果不存在则返回None
        """
        try:
            user_id_int = int(user_id)
        except (ValueError, TypeError):
            return None

        user_response = self._supabase_repo.get_user(user_id_int)
        if user_response:
            return self._user_response_to_user(user_response)
        return None

    def create(self, username: str) -> User:
        """
        创建新用户

        Args:
            username: 用户名

        Returns:
            创建的User对象
        """
        from src.supabase.schemas import UserCreate

        user_data = UserCreate(name=username)
        user_response = self._supabase_repo.create_user(user_data)
        return self._user_response_to_user(user_response)

    def update(self, user_id: int, username: str) -> Optional[User]:
        """
        更新用户

        Args:
            user_id: 用户ID（字符串，需要转换为int）
            username: 用户名

        Returns:
            更新后的User对象，如果不存在则返回None
        """
        try:
            user_id_int = int(user_id)
        except (ValueError, TypeError):
            return None

        from src.supabase.schemas import UserUpdate

        update_data = UserUpdate(name=username)
        user_response = self._supabase_repo.update_user(user_id_int, update_data)
        if user_response:
            return self._user_response_to_user(user_response)
        return None

    def delete(self, user_id: int) -> bool:
        """
        删除用户

        Args:
            user_id: 用户ID（int）

        Returns:
            是否删除成功
        """
        try:
            user_id_int = int(user_id)
        except (ValueError, TypeError):
            return False

        return self._supabase_repo.delete_user(user_id_int)

    def _user_response_to_user(self, user_response) -> User:
        """
        将UserResponse转换为User模型

        Args:
            user_response: UserResponse对象

        Returns:
            User对象
        """
        return User(
            user_id=user_response.id,  # 保持为整数类型
            username=user_response.name or "",
        )



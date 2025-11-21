from typing import List, Optional
from app.models.user import User
from app.repositories.base import UserRepositoryBase
from app.core.exceptions import NotFoundException, ErrorCode

class UserService:
    """封装业务逻辑层"""

    def __init__(self, repo: UserRepositoryBase):
        self.repo = repo

    def list_users(self) -> List[User]:
        return self.repo.get_all()

    def get_user(self, user_id: str) -> User:
        user = self.repo.get_by_id(user_id)
        if not user:
            raise NotFoundException(f"User not found: {user_id}", code=ErrorCode.USER_NOT_FOUND)
        return user

    def create_user(self, username: str) -> User:
        # TODO 这里应该检查用户是否已存在，但为了简单起见，我们假设 repo 会处理或这里暂不处理
        return self.repo.create(username)

    def update_user(self, user_id: str, username: str) -> User:
        user = self.repo.update(user_id, username)
        if not user:
            raise NotFoundException(f"User not found: {user_id}", code=ErrorCode.USER_NOT_FOUND)
        return user

    def delete_user(self, user_id: str) -> None:
        success = self.repo.delete(user_id)
        if not success:
            raise NotFoundException(f"User not found: {user_id}", code=ErrorCode.USER_NOT_FOUND)


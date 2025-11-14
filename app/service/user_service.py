from typing import List, Optional
from app.models.user import User
from app.repositories.base import UserRepositoryBase

class UserService:
    """封装业务逻辑层"""

    def __init__(self, repo: UserRepositoryBase):
        self.repo = repo

    def list_users(self) -> List[User]:
        return self.repo.get_all()

    def get_user(self, user_id: int) -> Optional[User]:
        return self.repo.get_by_id(user_id)

    def create_user(self, username: str) -> User:
        return self.repo.create(username)

    def update_user(self, user_id: int, username: str) -> Optional[User]:
        return self.repo.update(user_id, username)

    def delete_user(self, user_id: int) -> bool:
        return self.repo.delete(user_id)

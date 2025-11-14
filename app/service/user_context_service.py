"""
负责用户知识库内容的管理
"""

from typing import List, Optional
from app.models.user_context import UserContext
from app.repositories.base import UserContextRepositoryBase

class UserContextService:
    """封装业务逻辑层"""

    def __init__(self, repo: UserContextRepositoryBase):
        self.repo = repo

    def get_by_user_id(self, user_id: int) -> List[UserContext]:
        return self.repo.get_by_user_id(user_id)

    def get_by_id(self, context_id: int) -> Optional[UserContext]:
        return self.repo.get_by_id(context_id)

    def create(self, user_id: int, context_name: str, context_description: str, context_data: dict, metadata: dict) -> UserContext:
        return self.repo.create(user_id, context_name, context_description, context_data, metadata)

    def update(self, context_id: int, context_name: str, context_description: str, context_data: dict, metadata: dict) -> Optional[UserContext]:
        return self.repo.update(context_id, context_name, context_description, context_data, metadata)

    def delete(self, context_id: int) -> bool:
        return self.repo.delete(context_id)

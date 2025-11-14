from abc import ABC, abstractmethod
from typing import List, Optional

from app.models.user import User
from app.models.mcp_token import McpToken, TokenStatus
from app.models.user_context import UserContext

# 抽象用户仓库接口
class UserRepositoryBase(ABC):

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


# 抽象 MCP Token 仓库接口
class McpTokenRepositoryBase(ABC):

    @abstractmethod
    def get_all(self) -> List[McpToken]:
        pass

    @abstractmethod
    def get_by_token(self, token: str) -> Optional[McpToken]:
        pass

    @abstractmethod
    def get_by_user_project_context(self, user_id: int, project_id: int, ctx_id: int) -> List[McpToken]:
        pass

    @abstractmethod
    def create(self, user_id: int, project_id: int, ctx_id: int, token: str, token_status: TokenStatus = "active") -> McpToken:
        pass

    @abstractmethod
    def update_status(self, token: str, token_status: TokenStatus) -> Optional[McpToken]:
        pass

    @abstractmethod
    def delete(self, token: str) -> bool:
        pass

# 抽象用户知识库仓库接口与用户是一对多的关系
class UserContextRepositoryBase(ABC):

    @abstractmethod
    def get_by_user_id(self, user_id: int) -> List[UserContext]:
        pass

    @abstractmethod
    def get_by_id(self, context_id: int) -> Optional[UserContext]:
        pass

    @abstractmethod
    def update(self, context_id: int, context_name: str, context_description: str, context_data: str, metadata: dict) -> Optional[UserContext]:
        pass

    @abstractmethod
    def delete(self, context_id: int) -> bool:
        pass

    @abstractmethod
    def create(self, user_id:str, context_name: str, context_description: str, context_data: str, metadata: dict) -> UserContext:
        pass
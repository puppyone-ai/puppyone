from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any

from app.models.user import User
from app.models.mcp import McpInstance
from app.models.user_context import UserContext
from app.schemas.mcp import McpToolsDefinition

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
class McpInstanceRepositoryBase(ABC):

    @abstractmethod
    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def create(self, api_key: str, user_id: str, project_id: str, context_id: str, status: int, port: int, docker_info: Dict[Any, Any], tools_definition: Optional[Dict[str, McpToolsDefinition]] = None) -> McpInstance:
        pass

    @abstractmethod
    def update_by_id(self, mcp_instance_id: str, api_key: str, user_id: str, project_id: str, context_id: str, status: int, port: int, docker_info: Dict[Any, Any], tools_definition: Optional[Dict[str, McpToolsDefinition]] = None) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def update_by_api_key(self, api_key: str, user_id: str, project_id: str, context_id: str, status: int, port: int, docker_info: Dict[Any, Any], tools_definition: Optional[Dict[str, McpToolsDefinition]] = None) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def delete_by_id(self, mcp_instance_id: str) -> bool:
        pass

    @abstractmethod
    def delete_by_api_key(self, api_key: str) -> bool:
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
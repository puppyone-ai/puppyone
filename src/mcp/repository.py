from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
import json
from pathlib import Path

from src.mcp.models import McpInstance
from src.mcp.schemas import McpToolsDefinition, ToolTypeKey
from src.utils.logger import log_error


DATA_PATH = Path("./data/mcp_instances.json")


class McpInstanceRepositoryBase(ABC):
    """抽象 MCP 实例仓库接口"""

    @abstractmethod
    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def get_by_user_id(self, user_id: str) -> List[McpInstance]:
        """根据 user_id 获取该用户的所有 MCP 实例"""
        pass

    @abstractmethod
    def create(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        context_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
    ) -> McpInstance:
        pass

    @abstractmethod
    def update_by_id(
        self,
        mcp_instance_id: str,
        api_key: str,
        user_id: str,
        project_id: str,
        context_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
    ) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def update_by_api_key(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        context_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
    ) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def delete_by_id(self, mcp_instance_id: str) -> bool:
        pass

    @abstractmethod
    def delete_by_api_key(self, api_key: str) -> bool:
        pass


class McpInstanceRepositoryJSON(McpInstanceRepositoryBase):
    """负责对 MCP 实例数据进行增删改查"""

    def _read_data(self) -> List[McpInstance]:
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                instances = json.load(f)
                return [McpInstance(**instance) for instance in instances]
        except FileNotFoundError:
            return []

    def _write_data(self, instances: List[McpInstance]) -> None:
        try:
            # 确保目录存在
            DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump(
                    [instance.model_dump() for instance in instances],
                    f,
                    ensure_ascii=False,
                    indent=4,
                )
        except Exception as e:
            log_error(f"Failed to write data to {DATA_PATH}: {e}")

    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        instances = self._read_data()
        for instance in instances:
            if instance.mcp_instance_id == mcp_instance_id:
                return instance
        return None

    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        instances = self._read_data()
        for instance in instances:
            if instance.api_key == api_key:
                return instance
        return None

    def get_by_user_id(self, user_id: str) -> List[McpInstance]:
        """根据 user_id 获取该用户的所有 MCP 实例"""
        instances = self._read_data()
        return [instance for instance in instances if instance.user_id == user_id]

    def create(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        context_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
    ) -> McpInstance:
        instances = self._read_data()
        # 生成新的 ID
        existing_ids = [
            int(i.mcp_instance_id) for i in instances if i.mcp_instance_id.isdigit()
        ]
        new_id = str(max(existing_ids, default=0) + 1) if existing_ids else "1"

        new_instance = McpInstance(
            mcp_instance_id=new_id,
            api_key=api_key,
            user_id=user_id,
            project_id=project_id,
            context_id=context_id,
            json_pointer=json_pointer,
            status=status,
            port=port,
            docker_info=docker_info,
            tools_definition=tools_definition,
            register_tools=register_tools,
        )
        instances.append(new_instance)
        self._write_data(instances)
        return new_instance

    def update_by_id(
        self,
        mcp_instance_id: str,
        api_key: str,
        user_id: str,
        project_id: str,
        context_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
    ) -> Optional[McpInstance]:
        instances = self._read_data()
        for instance in instances:
            if instance.mcp_instance_id == mcp_instance_id:
                instance.api_key = api_key
                instance.user_id = user_id
                instance.project_id = project_id
                instance.context_id = context_id
                instance.json_pointer = json_pointer
                instance.status = status
                instance.port = port
                instance.docker_info = docker_info
                instance.tools_definition = tools_definition
                instance.register_tools = register_tools
                self._write_data(instances)
                return instance
        return None

    def update_by_api_key(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        context_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
    ) -> Optional[McpInstance]:
        instances = self._read_data()
        for instance in instances:
            if instance.api_key == api_key:
                instance.user_id = user_id
                instance.project_id = project_id
                instance.context_id = context_id
                instance.json_pointer = json_pointer
                instance.status = status
                instance.port = port
                instance.docker_info = docker_info
                instance.tools_definition = tools_definition
                instance.register_tools = register_tools
                self._write_data(instances)
                return instance
        return None

    def delete_by_id(self, mcp_instance_id: str) -> bool:
        instances = self._read_data()
        new_instances = [i for i in instances if i.mcp_instance_id != mcp_instance_id]
        if len(new_instances) == len(instances):
            return False
        self._write_data(new_instances)
        return True

    def delete_by_api_key(self, api_key: str) -> bool:
        instances = self._read_data()
        new_instances = [i for i in instances if i.api_key != api_key]
        if len(new_instances) == len(instances):
            return False
        self._write_data(new_instances)
        return True

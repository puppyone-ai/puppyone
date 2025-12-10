from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
import json
from pathlib import Path

from src.mcp.models import McpInstance
from src.mcp.schemas import McpToolsDefinition, ToolTypeKey
from src.utils.logger import log_error
from src.supabase.repository import SupabaseRepository
from src.supabase.mcps.schemas import McpCreate, McpUpdate


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
    def get_all(self) -> List[McpInstance]:
        """获取所有 MCP 实例"""
        pass

    @abstractmethod
    def create(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        pass

    @abstractmethod
    def update_by_id(
        self,
        mcp_instance_id: str,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def update_by_api_key(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
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
                # 数据迁移：将旧的 context_id 字段转换为 table_id
                for instance in instances:
                    if "context_id" in instance and "table_id" not in instance:
                        instance["table_id"] = instance.pop("context_id")
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

    def get_all(self) -> List[McpInstance]:
        """获取所有 MCP 实例"""
        return self._read_data()

    def create(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
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
            table_id=table_id,
            json_pointer=json_pointer,
            status=status,
            port=port,
            docker_info=docker_info,
            tools_definition=tools_definition,
            register_tools=register_tools,
            preview_keys=preview_keys,
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
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        instances = self._read_data()
        for instance in instances:
            if instance.mcp_instance_id == mcp_instance_id:
                instance.api_key = api_key
                instance.user_id = user_id
                instance.project_id = project_id
                instance.table_id = table_id
                instance.json_pointer = json_pointer
                instance.status = status
                instance.port = port
                instance.docker_info = docker_info
                instance.tools_definition = tools_definition
                instance.register_tools = register_tools
                instance.preview_keys = preview_keys
                self._write_data(instances)
                return instance
        return None

    def update_by_api_key(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        instances = self._read_data()
        for instance in instances:
            if instance.api_key == api_key:
                instance.user_id = user_id
                instance.project_id = project_id
                instance.table_id = table_id
                instance.json_pointer = json_pointer
                instance.status = status
                instance.port = port
                instance.docker_info = docker_info
                instance.tools_definition = tools_definition
                instance.register_tools = register_tools
                instance.preview_keys = preview_keys
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


class McpInstanceRepositorySupabase(McpInstanceRepositoryBase):
    """基于 Supabase 的 MCP 实例仓库实现"""

    def __init__(self):
        self._repo = SupabaseRepository()

    def _mcp_response_to_instance(self, mcp_response) -> McpInstance:
        """将 McpResponse 转换为 McpInstance 模型"""
        # 字段映射：json_path → json_pointer, status (bool) → status (int), id → mcp_instance_id
        return McpInstance(
            mcp_instance_id=str(mcp_response.id),
            api_key=mcp_response.api_key or "",
            user_id=str(mcp_response.user_id) if mcp_response.user_id else "",
            project_id=str(mcp_response.project_id) if mcp_response.project_id else "",
            table_id=str(mcp_response.table_id) if mcp_response.table_id else "",
            json_pointer=mcp_response.json_path or "",
            status=1 if mcp_response.status else 0,
            port=mcp_response.port or 0,
            docker_info=mcp_response.docker_info or {},
            tools_definition=mcp_response.tools_definition,
            register_tools=mcp_response.register_tools,
            preview_keys=mcp_response.preview_keys,
        )

    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        """根据 ID 获取 MCP 实例"""
        try:
            mcp_id = int(mcp_instance_id)
        except (ValueError, TypeError):
            return None

        mcp_response = self._repo.get_mcp(mcp_id)
        if mcp_response:
            return self._mcp_response_to_instance(mcp_response)
        return None

    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """根据 API Key 获取 MCP 实例"""
        mcp_response = self._repo.get_mcp_by_api_key(api_key)
        if mcp_response:
            return self._mcp_response_to_instance(mcp_response)
        return None

    def get_by_user_id(self, user_id: str) -> List[McpInstance]:
        """根据 user_id 获取该用户的所有 MCP 实例"""
        mcp_responses = self._repo.get_mcps(user_id=user_id)
        return [self._mcp_response_to_instance(resp) for resp in mcp_responses]

    def get_all(self) -> List[McpInstance]:
        """获取所有 MCP 实例"""
        # 获取所有实例，不做任何过滤
        # limit 设置为一个较大的值，如 10000
        mcp_responses = self._repo.get_mcps(limit=10000)
        return [self._mcp_response_to_instance(resp) for resp in mcp_responses]

    def create(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        """创建新的 MCP 实例"""
        # 字段映射：json_pointer → json_path, status (int) → status (bool)
        mcp_data = McpCreate(
            api_key=api_key,
            user_id=user_id if user_id else None,
            project_id=int(project_id) if project_id else None,
            table_id=int(table_id) if table_id else None,
            json_path=json_pointer,
            status=bool(status),
            port=port,
            docker_info=docker_info,
            tools_definition=tools_definition,
            register_tools=register_tools,
            preview_keys=preview_keys,
        )

        mcp_response = self._repo.create_mcp(mcp_data)
        return self._mcp_response_to_instance(mcp_response)

    def update_by_id(
        self,
        mcp_instance_id: str,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        """根据 ID 更新 MCP 实例"""
        try:
            mcp_id = int(mcp_instance_id)
        except (ValueError, TypeError):
            return None

        # 字段映射：json_pointer → json_path, status (int) → status (bool)
        mcp_data = McpUpdate(
            api_key=api_key,
            user_id=user_id if user_id else None,
            project_id=int(project_id) if project_id else None,
            table_id=int(table_id) if table_id else None,
            json_path=json_pointer,
            status=bool(status),
            port=port,
            docker_info=docker_info,
            tools_definition=tools_definition,
            register_tools=register_tools,
            preview_keys=preview_keys,
        )

        mcp_response = self._repo.update_mcp(mcp_id, mcp_data)
        if mcp_response:
            return self._mcp_response_to_instance(mcp_response)
        return None

    def update_by_api_key(
        self,
        api_key: str,
        user_id: str,
        project_id: str,
        table_id: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        """根据 API Key 更新 MCP 实例"""
        # 字段映射：json_pointer → json_path, status (int) → status (bool)
        mcp_data = McpUpdate(
            api_key=api_key,
            user_id=user_id if user_id else None,
            project_id=int(project_id) if project_id else None,
            table_id=int(table_id) if table_id else None,
            json_path=json_pointer,
            status=bool(status),
            port=port,
            docker_info=docker_info,
            tools_definition=tools_definition,
            register_tools=register_tools,
            preview_keys=preview_keys,
        )

        mcp_response = self._repo.update_mcp_by_api_key(api_key, mcp_data)
        if mcp_response:
            return self._mcp_response_to_instance(mcp_response)
        return None

    def delete_by_id(self, mcp_instance_id: str) -> bool:
        """根据 ID 删除 MCP 实例"""
        try:
            mcp_id = int(mcp_instance_id)
        except (ValueError, TypeError):
            return False

        return self._repo.delete_mcp(mcp_id)

    def delete_by_api_key(self, api_key: str) -> bool:
        """根据 API Key 删除 MCP 实例"""
        return self._repo.delete_mcp_by_api_key(api_key)

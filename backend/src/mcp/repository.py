from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
import json
from pathlib import Path

from src.mcp.models import McpInstance
from src.mcp.schemas import McpToolsDefinition, ToolTypeKey
from src.utils.logger import log_error
from src.mcp.supabase_schemas import McpCreate, McpUpdate
from src.utils.id_generator import generate_uuid_v7


DATA_PATH = Path("./data/mcp_instances.json")


class McpInstanceRepositoryBase(ABC):
    """Abstract MCP instance repository interface"""

    @abstractmethod
    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        pass

    @abstractmethod
    def get_by_project_id(self, project_id: str) -> List[McpInstance]:
        """Get all MCP instances for a project by project_id"""
        pass

    @abstractmethod
    def get_all(self) -> List[McpInstance]:
        """Get all MCP instances"""
        pass

    @abstractmethod
    def create(
        self,
        api_key: str,
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
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
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
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
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
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
    """Responsible for CRUD operations on MCP instance data"""

    def _read_data(self) -> List[McpInstance]:
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                instances = json.load(f)
                # Data migration: convert old context_id field to table_id
                for instance in instances:
                    if "context_id" in instance and "table_id" not in instance:
                        instance["table_id"] = instance.pop("context_id")
                return [McpInstance(**instance) for instance in instances]
        except FileNotFoundError:
            return []

    def _write_data(self, instances: List[McpInstance]) -> None:
        try:
            # Ensure directory exists
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

    def get_by_project_id(self, project_id: str) -> List[McpInstance]:
        """Get all MCP instances for a project by project_id"""
        instances = self._read_data()
        return [instance for instance in instances if instance.project_id == project_id]

    def get_all(self) -> List[McpInstance]:
        """Get all MCP instances"""
        return self._read_data()

    def create(
        self,
        api_key: str,
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        instances = self._read_data()
        # Generate new ID
        new_id = generate_uuid_v7()

        new_instance = McpInstance(
            mcp_instance_id=new_id,
            api_key=api_key,
            created_by=created_by,
            project_id=project_id,
            table_id=table_id,
            name=name,
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
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
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
                instance.created_by = created_by
                instance.project_id = project_id
                instance.table_id = table_id
                instance.name = name
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
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
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
                instance.created_by = created_by
                instance.project_id = project_id
                instance.table_id = table_id
                instance.name = name
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
    """Supabase-based MCP instance repository implementation"""

    def __init__(self, supabase_repo=None):
        """
        Initialize repository

        Args:
            supabase_repo: Optional SupabaseRepository instance, uses shared singleton if not provided
        """
        if supabase_repo is None:
            # Lazy import to avoid triggering during module import
            from src.infra.supabase.dependencies import get_supabase_repository

            self._repo = get_supabase_repository()
        else:
            self._repo = supabase_repo

    def _mcp_response_to_instance(self, mcp_response) -> McpInstance:
        """Convert McpResponse to McpInstance model"""
        # Field mapping: json_path -> json_pointer, status (bool) -> status (int), id -> mcp_instance_id
        return McpInstance(
            mcp_instance_id=str(mcp_response.id),
            api_key=mcp_response.api_key or "",
            created_by=str(mcp_response.created_by) if mcp_response.created_by else None,
            project_id=str(mcp_response.project_id) if mcp_response.project_id else "",
            table_id=str(mcp_response.table_id) if mcp_response.table_id else "",
            name=mcp_response.name,
            json_pointer=mcp_response.json_path or "",
            status=1 if mcp_response.status else 0,
            port=mcp_response.port or 0,
            docker_info=mcp_response.docker_info or {},
            tools_definition=mcp_response.tools_definition,
            register_tools=mcp_response.register_tools,
            preview_keys=mcp_response.preview_keys,
        )

    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        """Get MCP instance by ID"""
        try:
            mcp_id = int(mcp_instance_id)
        except (ValueError, TypeError):
            return None

        mcp_response = self._repo.get_mcp(mcp_id)
        if mcp_response:
            return self._mcp_response_to_instance(mcp_response)
        return None

    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """Get MCP instance by API Key"""
        mcp_response = self._repo.get_mcp_by_api_key(api_key)
        if mcp_response:
            return self._mcp_response_to_instance(mcp_response)
        return None

    def get_by_project_id(self, project_id: str) -> List[McpInstance]:
        """Get all MCP instances for a project by project_id"""
        mcp_responses = self._repo.get_mcps(project_id=project_id)
        return [self._mcp_response_to_instance(resp) for resp in mcp_responses]

    def get_all(self) -> List[McpInstance]:
        """Get all MCP instances"""
        # Get all instances without any filtering
        # Set limit to a large value, e.g. 10000
        mcp_responses = self._repo.get_mcps(limit=10000)
        return [self._mcp_response_to_instance(resp) for resp in mcp_responses]

    def create(
        self,
        api_key: str,
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        """Create a new MCP instance"""
        # Field mapping: json_pointer -> json_path, status (int) -> status (bool)
        mcp_data = McpCreate(
            api_key=api_key,
            created_by=created_by if created_by else None,
            project_id=project_id if project_id else None,
            table_id=table_id if table_id else None,
            name=name,
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
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        """Update MCP instance by ID"""
        try:
            mcp_id = int(mcp_instance_id)
        except (ValueError, TypeError):
            return None

        # Field mapping: json_pointer -> json_path, status (int) -> status (bool)
        mcp_data = McpUpdate(
            api_key=api_key,
            created_by=created_by if created_by else None,
            project_id=project_id if project_id else None,
            table_id=table_id if table_id else None,
            name=name,
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
        created_by: Optional[str],
        project_id: str,
        table_id: str,
        name: str,
        json_pointer: str,
        status: int,
        port: int,
        docker_info: Dict[Any, Any],
        tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
        register_tools: Optional[List[ToolTypeKey]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> Optional[McpInstance]:
        """Update MCP instance by API Key"""
        # Field mapping: json_pointer -> json_path, status (int) -> status (bool)
        mcp_data = McpUpdate(
            api_key=api_key,
            created_by=created_by if created_by else None,
            project_id=project_id if project_id else None,
            table_id=table_id if table_id else None,
            name=name,
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
        """Delete MCP instance by ID"""
        try:
            mcp_id = int(mcp_instance_id)
        except (ValueError, TypeError):
            return False

        return self._repo.delete_mcp(mcp_id)

    def delete_by_api_key(self, api_key: str) -> bool:
        """Delete MCP instance by API Key"""
        return self._repo.delete_mcp_by_api_key(api_key)

import json
import uuid
from app.models.mcp import McpInstance
from typing import List, Optional, Dict, Any
from pathlib import Path
from app.utils.logger import log_error
from app.repositories.base import McpInstanceRepositoryBase

DATA_PATH = Path("./data/mcp_instances.json")

class McpInstanceRepositoryJSON(McpInstanceRepositoryBase):
    """负责对 MCP Instance 数据进行增删改查"""
    
    # 这两个方法进行底层实现
    def _read_data(self) -> List[McpInstance]:
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                instances = json.load(f)
                return [McpInstance(**instance) for instance in instances]
        except FileNotFoundError:
            return []
        except json.JSONDecodeError as e:
            log_error(f"Failed to parse JSON from {DATA_PATH}: {e}")
            return []
    
    def _write_data(self, instances: List[McpInstance]) -> None:
        try:
            # 确保目录存在
            DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump([instance.model_dump() for instance in instances], f, ensure_ascii=False, indent=4)
        except Exception as e:
            log_error(f"Failed to write data to {DATA_PATH}: {e}")
    
    # 接口方法实现
    def get_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        """根据 mcp_instance_id 获取实例"""
        instances = self._read_data()
        for instance in instances:
            if instance.mcp_instance_id == mcp_instance_id:
                return instance
        return None
    
    def get_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """根据 api_key 获取实例"""
        instances = self._read_data()
        for instance in instances:
            if instance.api_key == api_key:
                return instance
        return None
    
    def create(self, api_key: str, user_id: str, project_id: str, context_id: str, status: int, port: int, docker_info: Dict[Any, Any]) -> McpInstance:
        """创建新的 MCP 实例"""
        instances = self._read_data()
        # 生成唯一的 mcp_instance_id
        mcp_instance_id = str(uuid.uuid4())
        new_instance = McpInstance(
            mcp_instance_id=mcp_instance_id,
            api_key=api_key,
            user_id=user_id,
            project_id=project_id,
            context_id=context_id,
            status=status,
            port=port,
            docker_info=docker_info
        )
        instances.append(new_instance)
        self._write_data(instances)
        return new_instance
    
    def update_by_id(self, mcp_instance_id: str, api_key: str, user_id: str, project_id: str, context_id: str, status: int, port: int, docker_info: Dict[Any, Any]) -> Optional[McpInstance]:
        """根据 mcp_instance_id 更新实例"""
        instances = self._read_data()
        for i, instance in enumerate(instances):
            if instance.mcp_instance_id == mcp_instance_id:
                updated_instance = McpInstance(
                    mcp_instance_id=mcp_instance_id,
                    api_key=api_key,
                    user_id=user_id,
                    project_id=project_id,
                    context_id=context_id,
                    status=status,
                    port=port,
                    docker_info=docker_info
                )
                instances[i] = updated_instance
                self._write_data(instances)
                return updated_instance
        return None
    
    def update_by_api_key(self, api_key: str, user_id: str, project_id: str, context_id: str, status: int, port: int, docker_info: Dict[Any, Any]) -> Optional[McpInstance]:
        """根据 api_key 更新实例"""
        instances = self._read_data()
        for i, instance in enumerate(instances):
            if instance.api_key == api_key:
                updated_instance = McpInstance(
                    mcp_instance_id=instance.mcp_instance_id,  # 保持原有的 mcp_instance_id
                    api_key=api_key,
                    user_id=user_id,
                    project_id=project_id,
                    context_id=context_id,
                    status=status,
                    port=port,
                    docker_info=docker_info
                )
                instances[i] = updated_instance
                self._write_data(instances)
                return updated_instance
        return None
    
    def delete_by_id(self, mcp_instance_id: str) -> bool:
        """根据 mcp_instance_id 删除实例"""
        instances = self._read_data()
        new_instances = [instance for instance in instances if instance.mcp_instance_id != mcp_instance_id]
        if len(new_instances) == len(instances):
            return False
        self._write_data(new_instances)
        return True
    
    def delete_by_api_key(self, api_key: str) -> bool:
        """根据 api_key 删除实例"""
        instances = self._read_data()
        new_instances = [instance for instance in instances if instance.api_key != api_key]
        if len(new_instances) == len(instances):
            return False
        self._write_data(new_instances)
        return True


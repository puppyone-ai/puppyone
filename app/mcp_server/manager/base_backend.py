from typing import Protocol, Dict, Any

class MCPInstanceBackend(Protocol):
    """
    MCP 实例后端的抽象接口
    支持不同的实现方式：多进程、Docker容器等
    """
    async def start_instance(self, instance_id: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        启动一个 MCP 实例
        
        Args:
            instance_id: 实例ID
            config: 配置信息，包含 port, api_key 等
            
        Returns:
            包含进程/容器信息的字典，用于存储到 docker_info 字段
        """
        ...
    
    async def stop_instance(self, instance_id: str) -> None:
        """
        停止一个 MCP 实例
        
        Args:
            instance_id: 实例ID
        """
        ...
    
    async def get_status(self, instance_id: str) -> Dict[str, Any]:
        """
        获取实例状态
        
        Args:
            instance_id: 实例ID
            
        Returns:
            状态信息字典，包含 running, pid 等
        """
        ...
    
    async def delete_instance(self, instance_id: str) -> None:
        """
        删除一个 MCP 实例（停止并清理资源）
        
        Args:
            instance_id: 实例ID
        """
        ...
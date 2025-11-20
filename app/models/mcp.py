from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from app.schemas.mcp import McpToolsDefinition, ToolTypeKey

class McpInstance(BaseModel):
    mcp_instance_id: str
    api_key: str
    user_id: str
    project_id: str
    context_id: str
    json_pointer: str = ""  # JSON指针路径，表示该MCP实例对应的数据路径，默认为空字符串表示根路径
    status: int  # 0表示关闭，1表示开启
    port: int
    docker_info: Dict[Any, Any] # 容器信息
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = None  # 工具定义字典（可选），key只能是get/create/update/delete
    register_tools: Optional[List[ToolTypeKey]] = None  # 已注册的工具列表（可选），默认为所有工具
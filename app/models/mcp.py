from pydantic import BaseModel
from typing import Dict, Any, Optional
from app.schemas.mcp import McpToolsDefinition, ToolTypeKey

class McpInstance(BaseModel):
    mcp_instance_id: str
    api_key: str
    user_id: str
    project_id: str
    context_id: str
    status: int  # 0表示关闭，1表示开启
    port: int
    docker_info: Dict[Any, Any] # 容器信息
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = None  # 工具定义字典（可选），key只能是get/create/update/delete
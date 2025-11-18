from pydantic import BaseModel
from typing import Dict, Any

class McpInstance(BaseModel):
    mcp_instance_id: str
    api_key: str
    user_id: str
    project_id: str
    context_id: str
    status: int  # 0表示关闭，1表示开启
    port: int
    docker_info: Dict[Any, Any] # 容器信息
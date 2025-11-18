from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class McpToolsDefinition(BaseModel):
    tool_name: str        # 工具名称
    tool_desc_template: str # 工具描述模板
    tool_desc_parameters: List[Dict[str, Any]] # 填充模板的参数列表

class McpCreate(BaseModel):
    user_id: int # 用户ID
    project_id: int # 项目ID
    context_id: int # 上下文ID
    tools_definition: List[McpToolsDefinition] # 工具定义

class McpUpdate(BaseModel):
    status: int # 0表示关闭，1表示开启
    tools_definition: Optional[List[McpToolsDefinition]] = None # 工具定义

class McpTokenPayload(BaseModel):
    user_id: str
    project_id: str
    context_id: str

class McpStatusResponse(BaseModel):
    status: int # 0表示关闭，1表示开启
    port: Optional[int] = None
    docker_info: Optional[Dict[Any, Any]] = None # 容器信息

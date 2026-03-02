"""
Project API Schemas

定义前端 API 请求/响应模型，匹配前端 ProjectInfo 类型。
"""

from typing import Optional, List, Any
from pydantic import BaseModel


class NodeInfo(BaseModel):
    """节点信息（简化版，用于项目列表）"""

    id: str
    name: str
    type: str  # folder | json | markdown | image | pdf | video | file
    rows: Optional[int] = None


class ProjectOut(BaseModel):
    """项目输出模型 - 匹配前端 ProjectInfo 类型"""

    id: str
    name: str
    description: Optional[str] = None
    nodes: List[NodeInfo] = []  # 从 tables 改为 nodes


class ProjectCreate(BaseModel):
    """创建项目请求"""

    name: str
    description: Optional[str] = None
    org_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    """更新项目请求"""

    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None


class ProjectMemberOut(BaseModel):
    """项目成员输出"""

    id: str
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    created_at: str


class AddProjectMember(BaseModel):
    """添加项目成员"""

    user_id: str
    role: str = "editor"


class UpdateProjectMemberRole(BaseModel):
    """更新项目成员角色"""

    role: str

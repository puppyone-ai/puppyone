"""
L3-Folder: WorkspaceProvider — 抽象接口

定义 Agent 工作区管理的统一接口。
具体实现因平台而异（macOS APFS / Linux OverlayFS / Fallback 全量复制）。
冲突解决逻辑在 L2 CollaborationService 中，与平台无关。
"""

import platform
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, List

from src.sync.schemas import SyncResult  # L2.5


@dataclass
class WorkspaceInfo:
    """工作区信息"""
    path: str
    agent_id: str
    project_id: str
    base_snapshot_id: Optional[int] = None
    lower_path: str = ""


@dataclass
class WorkspaceChanges:
    """Agent 的改动"""
    agent_id: str
    base_snapshot_id: Optional[int] = None
    modified: Dict[str, str] = field(default_factory=dict)
    deleted: List[str] = field(default_factory=list)


class WorkspaceProvider(ABC):
    """
    Agent 工作区管理的抽象接口
    
    每个实现负责：
    1. create_workspace: 为 Agent 创建隔离的工作区目录
    2. detect_changes: 检测 Agent 改了什么文件
    3. cleanup: 清理工作区
    4. sync_lower: 同步 S3+PG 数据到共享的 Lower 目录
    """

    @abstractmethod
    async def create_workspace(
        self, agent_id: str, project_id: str, base_snapshot_id: Optional[int] = None
    ) -> WorkspaceInfo:
        """
        为 Agent 创建隔离的工作区
        
        Returns:
            WorkspaceInfo(path="/tmp/contextbase/workspaces/{agent_id}", ...)
        """
        ...

    @abstractmethod
    async def detect_changes(self, agent_id: str) -> WorkspaceChanges:
        """
        检测 Agent 改了什么
        
        对比 Agent 工作区和 Lower 目录，找出修改/新建/删除的文件。
        
        Returns:
            WorkspaceChanges(modified={"node_1.json": "{...}"}, deleted=["old.json"])
        """
        ...

    @abstractmethod
    async def cleanup(self, agent_id: str) -> None:
        """清理 Agent 的工作区"""
        ...

    @abstractmethod
    async def sync_lower(self, project_id: str) -> SyncResult:
        """
        同步 S3+PG 数据到本地 Lower 目录
        
        增量同步：比对 updated_at，只拉取变化的文件。
        """
        ...

    @abstractmethod
    def get_lower_path(self, project_id: str) -> str:
        """获取项目的 Lower 目录路径"""
        ...


def get_workspace_provider() -> WorkspaceProvider:
    """
    根据平台自动选择 WorkspaceProvider
    
    - macOS (Darwin): APFS Clone
    - Linux: Fallback（OverlayFS 实现预留）
    - Windows / 其他: Fallback（全量复制）
    """
    from src.config import settings

    provider_type = settings.WORKSPACE_PROVIDER
    base_dir = settings.WORKSPACE_BASE_DIR

    if provider_type == "auto":
        system = platform.system()
        if system == "Darwin":
            provider_type = "apfs"
        elif system == "Linux":
            # TODO: 未来检测是否支持 OverlayFS → provider_type = "overlayfs"
            provider_type = "fallback"
        else:
            provider_type = "fallback"

    if provider_type == "apfs":
        from src.workspace.apfs_provider import APFSWorkspaceProvider
        return APFSWorkspaceProvider(base_dir=base_dir)
    elif provider_type == "overlayfs":
        # TODO: Linux OverlayFS 实现
        from src.workspace.fallback_provider import FallbackWorkspaceProvider
        return FallbackWorkspaceProvider(base_dir=base_dir)
    else:
        from src.workspace.fallback_provider import FallbackWorkspaceProvider
        return FallbackWorkspaceProvider(base_dir=base_dir)

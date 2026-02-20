"""
L2.5 Sync — SyncAdapter 基类

每种外部系统实现一个 adapter，只需 4 个方法：
  - pull:            拉取单个资源的变更
  - push:            推送内容到单个资源
  - list_resources:  发现数据源内所有资源（用于首次连接的 bootstrap）
  - create_trigger:  创建此数据源类型对应的触发器

扩展方式：
  新增适配器 → 实现这 4 个方法 → 注册到 SyncService → 完成
"""

from abc import ABC, abstractmethod
from typing import Any, Optional, List

from src.sync.schemas import SyncSource, SyncMapping, PullResult, PushResult, ResourceInfo


class SyncAdapter(ABC):
    """同步适配器基类"""

    @property
    @abstractmethod
    def adapter_type(self) -> str:
        """适配器标识，如 "filesystem" / "github" / "notion" """

    @abstractmethod
    async def pull(
        self, source: SyncSource, mapping: SyncMapping,
    ) -> Optional[PullResult]:
        """
        从外部拉取单个资源的变更。

        对比 mapping.remote_hash 判断是否有变化：
          有变化 → 返回 PullResult
          无变化 → 返回 None
        """

    @abstractmethod
    async def push(
        self, source: SyncSource, mapping: SyncMapping,
        content: Any, node_type: str,
    ) -> PushResult:
        """推送内容到外部系统的单个资源。"""

    @abstractmethod
    async def list_resources(self, source: SyncSource) -> List[ResourceInfo]:
        """
        发现数据源内所有资源。

        用于首次连接时的 bootstrap——扫描外部数据源，
        返回其中所有资源（文件/页面/...），供 SyncService 建立 mapping。
        """

    @abstractmethod
    def create_trigger(self, source: SyncSource) -> Optional[Any]:
        """
        创建此数据源对应的触发器。

        返回值类型因触发器而异：
          filesystem → FolderWatcher 实例 (folder_sync 引擎)
          webhook    → webhook URL/config
          polling    → interval 配置

        返回 None 表示此 source 仅支持手动触发。
        """

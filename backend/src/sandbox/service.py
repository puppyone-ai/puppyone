"""
沙盒服务 - 统一接口

根据配置自动选择 E2B 云沙盒或 Docker 本地沙盒。

配置项（在 backend/src/config.py 中）：
- SANDBOX_TYPE: "e2b" | "docker" | "auto"
  - "e2b": 使用 E2B 云沙盒（需要 E2B_API_KEY）
  - "docker": 使用本地 Docker 容器沙盒
  - "auto": 自动选择（有 E2B_API_KEY 用 E2B，否则用 Docker）
"""

import os
from typing import Any, Callable, Optional

from .base import SandboxBase


class SandboxService:
    """
    沙盒服务统一接口
    
    作为门面/代理类，委托给具体的沙盒实现（E2B 或 Docker）。
    支持通过配置或环境变量自动切换后端。
    """
    
    def __init__(
        self,
        sandbox_impl: Optional[SandboxBase] = None,
        sandbox_factory: Optional[Callable[[], Any]] = None,
    ):
        """
        初始化沙盒服务
        
        Args:
            sandbox_impl: 直接提供沙盒实现（用于测试或强制指定）
            sandbox_factory: E2B 沙盒工厂（向后兼容，用于测试）
        """
        if sandbox_impl is not None:
            self._impl = sandbox_impl
        elif sandbox_factory is not None:
            # 向后兼容：使用自定义工厂创建 E2B 沙盒
            from .e2b_sandbox import E2BSandbox
            self._impl = E2BSandbox(sandbox_factory=sandbox_factory)
        else:
            # 根据配置自动创建
            self._impl = _create_sandbox_impl()
    
    async def start(self, session_id: str, data: Any, readonly: bool) -> dict:
        """创建沙盒会话并预加载单个 JSON 数据"""
        return await self._impl.start(session_id, data, readonly)
    
    async def start_with_files(
        self, 
        session_id: str, 
        files: list, 
        readonly: bool, 
        s3_service: Optional[Any] = None
    ) -> dict:
        """创建沙盒会话并预加载多个文件"""
        return await self._impl.start_with_files(session_id, files, readonly, s3_service)
    
    async def exec(self, session_id: str, command: str) -> dict:
        """在沙盒中执行命令"""
        return await self._impl.exec(session_id, command)
    
    async def read(self, session_id: str) -> dict:
        """读取 /workspace/data.json 的内容"""
        return await self._impl.read(session_id)
    
    async def read_file(self, session_id: str, path: str, parse_json: bool = False) -> dict:
        """读取沙盒中指定路径的文件"""
        return await self._impl.read_file(session_id, path, parse_json)
    
    async def stop(self, session_id: str) -> dict:
        """停止并清理沙盒会话"""
        return await self._impl.stop(session_id)
    
    async def status(self, session_id: str) -> dict:
        """获取沙盒会话状态"""
        return await self._impl.status(session_id)
    
    async def stop_all(self) -> None:
        """停止所有沙盒会话"""
        await self._impl.stop_all()
    
    @property
    def sandbox_type(self) -> str:
        """返回当前使用的沙盒类型"""
        from .e2b_sandbox import E2BSandbox
        from .docker_sandbox import DockerSandbox
        
        if isinstance(self._impl, E2BSandbox):
            return "e2b"
        elif isinstance(self._impl, DockerSandbox):
            return "docker"
        else:
            return "unknown"


def _create_sandbox_impl() -> SandboxBase:
    """
    根据配置创建沙盒实现
    
    优先级：
    1. 配置中的 SANDBOX_TYPE
    2. auto 模式下，检测 E2B_API_KEY 是否存在
    """
    from src.config import settings
    
    sandbox_type = settings.SANDBOX_TYPE
    
    # auto 模式：检测环境
    if sandbox_type == "auto":
        if os.getenv("E2B_API_KEY"):
            sandbox_type = "e2b"
            print("[SandboxService] Auto-detected E2B_API_KEY, using E2B sandbox")
        else:
            sandbox_type = "docker"
            print("[SandboxService] No E2B_API_KEY found, using Docker sandbox")
    
    # 创建对应的实现
    if sandbox_type == "e2b":
        from .e2b_sandbox import E2BSandbox
        print("[SandboxService] Initializing E2B cloud sandbox")
        return E2BSandbox()
    else:
        from .docker_sandbox import DockerSandbox
        print("[SandboxService] Initializing Docker local sandbox")
        return DockerSandbox()


def get_sandbox_type() -> str:
    """
    获取将要使用的沙盒类型（不创建实例）
    
    用于前端查询当前配置
    """
    from src.config import settings
    
    sandbox_type = settings.SANDBOX_TYPE
    
    if sandbox_type == "auto":
        if os.getenv("E2B_API_KEY"):
            return "e2b"
        else:
            return "docker"
    
    return sandbox_type

"""沙盒抽象基类定义"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional
import time


@dataclass
class SandboxSession:
    """沙盒会话数据"""
    sandbox: Any  # 具体的沙盒实例（E2B Sandbox 或 Docker container ID）
    readonly: bool
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)


class SandboxBase(ABC):
    """
    沙盒服务抽象基类
    
    定义了沙盒服务的统一接口，支持 E2B 云沙盒和 Docker 本地沙盒两种实现。
    """
    
    @abstractmethod
    async def start(self, session_id: str, data: Any, readonly: bool) -> dict:
        """
        创建沙盒会话并预加载单个 JSON 数据到 /workspace/data.json
        
        Args:
            session_id: 会话唯一标识
            data: JSON 数据（将被写入 /workspace/data.json）
            readonly: 是否只读模式
            
        Returns:
            {"success": True} 或 {"success": False, "error": str}
        """
        ...
    
    @abstractmethod
    async def start_with_files(
        self, 
        session_id: str, 
        files: list, 
        readonly: bool, 
        s3_service: Optional[Any] = None
    ) -> dict:
        """
        创建沙盒会话并预加载多个文件
        
        Args:
            session_id: 会话唯一标识
            files: SandboxFile 列表，每个包含 path, content, s3_key
            readonly: 是否只读模式
            s3_service: S3 服务实例（用于下载 S3 文件）
            
        Returns:
            {"success": True} 或 {"success": False, "error": str}
            可能包含 "warnings" 字段列出失败的文件
        """
        ...
    
    @abstractmethod
    async def exec(self, session_id: str, command: str) -> dict:
        """
        在沙盒中执行命令
        
        Args:
            session_id: 会话标识
            command: 要执行的 bash 命令
            
        Returns:
            {"success": True, "output": str} 或 {"success": False, "error": str}
        """
        ...
    
    @abstractmethod
    async def read(self, session_id: str) -> dict:
        """
        读取 /workspace/data.json 的内容
        
        Args:
            session_id: 会话标识
            
        Returns:
            {"success": True, "data": dict} 或 {"success": False, "error": str}
        """
        ...
    
    @abstractmethod
    async def read_file(self, session_id: str, path: str, parse_json: bool = False) -> dict:
        """
        读取沙盒中指定路径的文件
        
        Args:
            session_id: 会话标识
            path: 文件路径（如 /workspace/myfile.json）
            parse_json: 是否解析为 JSON
            
        Returns:
            {"success": True, "content": str/dict} 或 {"success": False, "error": str}
        """
        ...
    
    @abstractmethod
    async def stop(self, session_id: str) -> dict:
        """
        停止并清理沙盒会话
        
        Args:
            session_id: 会话标识
            
        Returns:
            {"success": True}
        """
        ...
    
    @abstractmethod
    async def status(self, session_id: str) -> dict:
        """
        获取沙盒会话状态
        
        Args:
            session_id: 会话标识
            
        Returns:
            {"active": bool, ...} 包含其他元数据
        """
        ...
    
    @abstractmethod
    async def stop_all(self) -> None:
        """停止所有沙盒会话（用于服务关闭时）"""
        ...

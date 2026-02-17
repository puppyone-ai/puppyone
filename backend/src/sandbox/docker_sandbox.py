"""Docker 沙盒实现"""

import asyncio
import json
import os
import shlex
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from .base import SandboxBase, SandboxSession


# Docker 会话超时时间（秒）
DEFAULT_DOCKER_SESSION_TIMEOUT = 600  # 10 分钟


@dataclass
class DockerSession(SandboxSession):
    """Docker 沙盒会话数据"""
    container_id: str = ""
    temp_path: str = ""  # 临时文件或目录路径


class DockerSandbox(SandboxBase):
    """
    Docker 本地沙盒实现
    
    使用 Docker 容器运行沙盒环境，支持：
    - 单文件 JSON 数据挂载
    - 多文件挂载
    - 命令执行
    - 文件读取
    """
    
    def __init__(self, session_timeout: float = DEFAULT_DOCKER_SESSION_TIMEOUT):
        """
        初始化 Docker 沙盒服务
        
        Args:
            session_timeout: 会话超时时间（秒），默认 10 分钟
        """
        self._sessions: dict[str, DockerSession] = {}
        self._lock = threading.Lock()  # 用于快速的同步访问
        self._async_lock = asyncio.Lock()  # 用于异步操作的互斥
        self._session_timeout = session_timeout
        self._cleanup_task: Optional[asyncio.Task] = None
        self._docker_available: Optional[bool] = None
        self._docker_check_time: float = 0  # 上次检查时间
        self._docker_cache_ttl: float = 60.0  # 缓存有效期（秒）
    
    async def _check_docker_available(self, force_recheck: bool = False) -> bool:
        """
        检查 Docker 是否可用
        
        Args:
            force_recheck: 强制重新检查，忽略缓存
        
        Returns:
            Docker 是否可用
        """
        now = time.time()
        
        # 检查缓存是否有效
        # 1. 如果缓存为 True 且未过期，直接返回
        # 2. 如果缓存为 False，总是重新检查（Docker 可能刚启动）
        # 3. 如果 force_recheck 为 True，强制重新检查
        cache_expired = (now - self._docker_check_time) > self._docker_cache_ttl
        
        if not force_recheck and self._docker_available is True and not cache_expired:
            return True
        
        # 如果 Docker 之前不可用，或者缓存过期，或者强制检查，则重新检测
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "info",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.wait(), timeout=5.0)
            self._docker_available = proc.returncode == 0
        except Exception:
            self._docker_available = False
        
        self._docker_check_time = now
        return self._docker_available
    
    async def _run_docker_command(
        self, 
        *args: str, 
        timeout: float = 30.0
    ) -> tuple[int, str, str]:
        """
        执行 Docker 命令
        
        Args:
            *args: 命令参数
            timeout: 超时时间（秒）
        
        Returns:
            (return_code, stdout, stderr)
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), 
                timeout=timeout
            )
            return (
                proc.returncode or 0,
                stdout.decode("utf-8", errors="replace"),
                stderr.decode("utf-8", errors="replace")
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return (-1, "", "Command timed out")
        except Exception as e:
            return (-1, "", str(e))
    
    async def _cleanup_expired_sessions(self):
        """定期清理过期的沙盒会话"""
        while True:
            try:
                await asyncio.sleep(60)  # 每分钟检查一次
                now = time.time()
                expired_sessions = []
                
                with self._lock:
                    for session_id, session in self._sessions.items():
                        if now - session.last_activity > self._session_timeout:
                            expired_sessions.append(session_id)
                
                # 使用异步锁逐个清理
                for session_id in expired_sessions:
                    print(f"[DockerSandbox] Cleaning up expired session: {session_id}")
                    async with self._async_lock:
                        await self._stop_internal(session_id)
                
                # 如果没有活跃会话，退出清理任务
                with self._lock:
                    if not self._sessions:
                        break
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[DockerSandbox] Cleanup task error: {e}")
    
    async def _ensure_cleanup_task(self):
        """确保清理任务正在运行"""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_sessions())
    
    async def _wait_for_container_ready(
        self,
        container_id: str,
        max_retries: int = 30,
        retry_interval: float = 1.0
    ) -> bool:
        """
        等待容器就绪（通过执行简单命令验证）
        
        Args:
            container_id: 容器 ID
            max_retries: 最大重试次数
            retry_interval: 重试间隔（秒）
        
        Returns:
            是否就绪
        """
        for i in range(max_retries):
            # 尝试执行一个简单命令来验证容器是否就绪
            returncode, stdout, _ = await self._run_docker_command(
                "exec", container_id, "echo", "ready",
                timeout=5.0
            )
            if returncode == 0 and "ready" in stdout:
                return True
            
            if i < max_retries - 1:
                await asyncio.sleep(retry_interval)
        
        return False
    
    async def _try_start_container(
        self, 
        mount_args: list[str],
        use_custom_image: bool = True
    ) -> tuple[bool, str, str]:
        """
        尝试启动 Docker 容器
        
        Args:
            mount_args: 挂载参数列表
            use_custom_image: 是否使用自定义镜像
        
        Returns:
            (success, container_id, error_message)
        """
        # 资源限制：防止单个容器耗尽宿主机资源
        resource_args = ["--memory=128m", "--cpus=0.5", "--pids-limit=100"]
        
        if use_custom_image:
            # 尝试使用自定义 json-sandbox 镜像
            args = ["run", "-d", "--rm"] + resource_args + mount_args + ["json-sandbox"]
            returncode, stdout, stderr = await self._run_docker_command(*args, timeout=30.0)
            
            if returncode == 0:
                container_id = stdout.strip()
                # 等待容器就绪
                if await self._wait_for_container_ready(container_id, max_retries=10):
                    return (True, container_id, "")
                else:
                    # 容器未就绪，清理并失败
                    await self._run_docker_command("stop", container_id, timeout=5.0)
                    return (False, "", "Container started but not ready")
            
            # 自定义镜像不存在，降级到 alpine
            print(f"[DockerSandbox] json-sandbox image not found, falling back to alpine:3.19")
        
        # 使用 alpine:3.19 并安装 jq 和 bash
        args = ["run", "-d", "--rm"] + resource_args + mount_args + [
            "alpine:3.19",
            "sh", "-c",
            "apk add --no-cache jq bash >/dev/null 2>&1 && tail -f /dev/null"
        ]
        returncode, stdout, stderr = await self._run_docker_command(*args, timeout=60.0)
        
        if returncode == 0:
            container_id = stdout.strip()
            # 等待 apk 安装完成并验证容器就绪
            # 给 alpine 更多时间，因为需要安装包
            if await self._wait_for_container_ready(container_id, max_retries=30, retry_interval=1.0):
                return (True, container_id, "")
            else:
                # 容器未就绪，清理并失败
                await self._run_docker_command("stop", container_id, timeout=5.0)
                return (False, "", "Container started but packages not installed in time")
        
        return (False, "", f"Failed to start container: {stderr}")
    
    async def start(self, session_id: str, data: Any, readonly: bool = False) -> dict:
        """
        创建沙盒会话并预加载单个 JSON 数据到 /workspace/data.json
        
        Args:
            session_id: 会话唯一标识
            data: JSON 数据（将被写入 /workspace/data.json）
            readonly: 是否只读模式
            
        Returns:
            {"success": True} 或 {"success": False, "error": str}
        """
        # 检查 Docker 是否可用
        if not await self._check_docker_available():
            return {
                "success": False, 
                "error": "Docker is not available. Please ensure Docker is installed and running."
            }
        
        # 清理过期会话
        await self._ensure_cleanup_task()
        
        # 如果已存在，先停止（使用异步锁保护整个检查-停止操作）
        async with self._async_lock:
            with self._lock:
                session_exists = session_id in self._sessions
            if session_exists:
                await self._stop_internal(session_id)
        
        # 创建临时 JSON 文件
        temp_dir = tempfile.gettempdir()
        temp_file_path = os.path.join(temp_dir, f"sandbox-{session_id}.json")
        
        try:
            json_content = json.dumps(data, ensure_ascii=False, indent=2)
            with open(temp_file_path, "w", encoding="utf-8") as f:
                f.write(json_content)
        except Exception as e:
            return {"success": False, "error": f"Failed to create temp file: {e}"}
        
        # 构建挂载参数
        mount_option = f"{temp_file_path}:/workspace/data.json"
        if readonly:
            mount_option += ":ro"
        mount_args = ["-v", mount_option]
        
        # 启动容器
        success, container_id, error = await self._try_start_container(mount_args)
        
        if not success:
            # 清理临时文件
            try:
                os.unlink(temp_file_path)
            except Exception:
                pass
            return {"success": False, "error": error}
        
        # 记录会话
        now = time.time()
        with self._lock:
            self._sessions[session_id] = DockerSession(
                sandbox=container_id,
                readonly=readonly,
                created_at=now,
                last_activity=now,
                container_id=container_id,
                temp_path=temp_file_path
            )
        
        print(f"[DockerSandbox] Started session {session_id}, container: {container_id[:12]}, readonly: {readonly}")
        return {"success": True}
    
    async def start_with_files(
        self, 
        session_id: str, 
        files: list, 
        readonly: bool = False, 
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
        
        # 检查 Docker 是否可用
        if not await self._check_docker_available():
            return {
                "success": False, 
                "error": "Docker is not available. Please ensure Docker is installed and running."
            }
        
        # 清理过期会话
        await self._ensure_cleanup_task()
        
        # 如果已存在，先停止（使用异步锁保护整个检查-停止操作）
        async with self._async_lock:
            with self._lock:
                session_exists = session_id in self._sessions
            if session_exists:
                await self._stop_internal(session_id)
        
        # 创建临时目录存放所有文件
        temp_dir = tempfile.mkdtemp(prefix=f"sandbox-{session_id}-")
        workspace_dir = os.path.join(temp_dir, "workspace")
        os.makedirs(workspace_dir, exist_ok=True)
        
        # 使用专用的 Docker 文件准备函数，大文件直接流式写入磁盘
        from .file_utils import prepare_files_for_docker_sandbox
        written_paths, all_failures = await prepare_files_for_docker_sandbox(
            files, workspace_dir, s3_service
        )
        
        # 构建挂载参数
        mount_option = f"{workspace_dir}:/workspace"
        if readonly:
            mount_option += ":ro"
        mount_args = ["-v", mount_option]
        
        # 启动容器
        success, container_id, error = await self._try_start_container(mount_args)
        
        if not success:
            # 清理临时目录
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass
            return {"success": False, "error": error}
        
        # 记录会话
        now = time.time()
        with self._lock:
            self._sessions[session_id] = DockerSession(
                sandbox=container_id,
                readonly=readonly,
                created_at=now,
                last_activity=now,
                container_id=container_id,
                temp_path=temp_dir  # 保存整个临时目录
            )
        
        print(f"[DockerSandbox] Started session {session_id} with {len(written_paths)} files written, container: {container_id[:12]}, readonly: {readonly}")
        
        result: dict[str, Any] = {"success": True}
        if all_failures:
            result["warnings"] = all_failures
        return result
    
    async def exec(self, session_id: str, command: str) -> dict:
        """
        在沙盒中执行命令
        
        Args:
            session_id: 会话标识
            command: 要执行的 bash 命令
            
        Returns:
            {"success": True, "output": str} 或 {"success": False, "error": str}
        """
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {
                "success": False,
                "error": "Sandbox session not found. Call start first."
            }
        
        # 更新最后活动时间
        session.last_activity = time.time()
        
        # 安全说明：
        # 1. _run_docker_command 使用 asyncio.subprocess_exec，不经过 host shell，
        #    所以 command 作为单个参数传递给容器内的 sh -c，host 层面无注入风险
        # 2. 在容器内执行任意命令是沙盒的设计目的，不需要在此层面限制
        # 3. 容器本身提供了隔离，限制了潜在危害范围
        
        returncode, stdout, stderr = await self._run_docker_command(
            "exec", session.container_id,
            "sh", "-c", command,
            timeout=30.0
        )
        
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            # 命令执行失败，统一返回 success=False
            # 同时提供 output 和 exit_code 以便调用方获取详细信息
            output = stdout + stderr
            return {
                "success": False,
                "error": f"Command failed with exit code {returncode}",
                "output": output,
                "exit_code": returncode
            }
    
    async def read(self, session_id: str) -> dict:
        """
        读取 /workspace/data.json 的内容
        
        Args:
            session_id: 会话标识
            
        Returns:
            {"success": True, "data": dict} 或 {"success": False, "error": str}
        """
        result = await self.exec(session_id, "cat /workspace/data.json")
        
        if not result.get("success"):
            return {"success": False, "error": result.get("error", "Failed to read file")}
        
        try:
            data = json.loads(result.get("output", ""))
            return {"success": True, "data": data}
        except json.JSONDecodeError:
            return {"success": False, "error": "Failed to parse JSON"}
    
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
        # 使用 shlex.quote 防止路径注入
        safe_path = shlex.quote(path)
        result = await self.exec(session_id, f"cat {safe_path}")
        
        if not result.get("success"):
            return {"success": False, "error": result.get("error", f"Failed to read {path}")}
        
        content = result.get("output", "")
        
        if parse_json:
            try:
                data = json.loads(content)
                return {"success": True, "content": data}
            except json.JSONDecodeError:
                return {"success": False, "error": f"Failed to parse JSON from {path}"}
        
        return {"success": True, "content": content}
    
    async def _stop_internal(self, session_id: str) -> bool:
        """
        内部停止方法，不获取异步锁
        
        Args:
            session_id: 会话标识
            
        Returns:
            是否成功停止（会话是否存在）
        """
        with self._lock:
            session = self._sessions.pop(session_id, None)
        
        if not session:
            return False  # 已经不存在
        
        # 停止容器
        try:
            await self._run_docker_command(
                "stop", session.container_id,
                timeout=10.0
            )
        except Exception as e:
            print(f"[DockerSandbox] Error stopping container {session_id}: {e}")
        
        # 清理临时文件/目录
        if session.temp_path:
            try:
                if os.path.isdir(session.temp_path):
                    shutil.rmtree(session.temp_path)
                elif os.path.isfile(session.temp_path):
                    os.unlink(session.temp_path)
            except Exception as e:
                print(f"[DockerSandbox] Error cleaning temp path {session.temp_path}: {e}")
        
        print(f"[DockerSandbox] Stopped session {session_id}")
        return True
    
    async def stop(self, session_id: str) -> dict:
        """
        停止并清理沙盒会话
        
        Args:
            session_id: 会话标识
            
        Returns:
            {"success": True}
        """
        async with self._async_lock:
            await self._stop_internal(session_id)
        return {"success": True}
    
    async def status(self, session_id: str) -> dict:
        """
        获取沙盒会话状态
        
        Args:
            session_id: 会话标识
            
        Returns:
            {"active": bool, ...} 包含其他元数据
        """
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {"active": False}
        
        return {
            "active": True,
            "container_id": session.container_id[:12] if session.container_id else None,
            "readonly": session.readonly,
            "created_at": session.created_at,
            "last_activity": session.last_activity,
        }
    
    async def stop_all(self) -> None:
        """停止所有沙盒会话（用于服务关闭时）"""
        async with self._async_lock:
            with self._lock:
                session_ids = list(self._sessions.keys())
            
            for session_id in session_ids:
                await self._stop_internal(session_id)
        
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        print("[DockerSandbox] All sessions stopped")

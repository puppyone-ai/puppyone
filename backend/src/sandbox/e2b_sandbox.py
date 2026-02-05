"""E2B 云沙盒实现"""

import asyncio
import inspect
import json
import os
import shlex
import time
import threading
from typing import Any, Callable, Optional

from .base import SandboxBase, SandboxSession


# 沙盒会话默认超时时间（秒）
DEFAULT_SESSION_TIMEOUT = 1800  # 30 分钟


class E2BSandbox(SandboxBase):
    """
    E2B 云沙盒实现
    
    使用 e2b-code-interpreter SDK 提供云端隔离的代码执行环境。
    """

    def __init__(
        self,
        sandbox_factory: Optional[Callable[[], Any]] = None,
        session_timeout: float = DEFAULT_SESSION_TIMEOUT,
    ):
        """
        初始化 E2B 沙盒服务
        
        Args:
            sandbox_factory: 沙盒工厂函数（主要用于测试）
            session_timeout: 会话超时时间（秒）
        """
        self._sandbox_factory = sandbox_factory or _default_e2b_factory
        self._sessions: dict[str, SandboxSession] = {}
        self._lock = threading.Lock()  # 保护 _sessions 的并发访问
        self._session_timeout = session_timeout
        self._cleanup_task: Optional[asyncio.Task] = None

    async def start(self, session_id: str, data: Any, readonly: bool) -> dict:
        """创建沙盒会话并预加载数据到 /workspace/data.json"""
        if data is None:
            return {"success": False, "error": "data is required"}
        
        await self.stop(session_id)
        
        # Create a fresh sandbox instance for this session.
        try:
            sandbox = await _call_maybe_async(self._sandbox_factory)
        except Exception as e:
            msg = str(e)
            # e2b-code-interpreter 会在未配置认证信息时抛出该类错误：
            # "Could not resolve authentication method. Expected either api_key or auth_token ..."
            if "Could not resolve authentication method" in msg:
                hint = (
                    "E2B sandbox auth is not configured.\n"
                    "- Set `E2B_API_KEY` in `backend/.env` (or export it) and restart the backend, OR\n"
                    "- Remove bash access from the Agent configuration (Agent Settings → Data Access).\n"
                    f"- Detected E2B_API_KEY={'set' if os.getenv('E2B_API_KEY') else 'missing'}"
                )
                msg = f"{hint}\nOriginal error: {msg}"
            return {"success": False, "error": msg}
        
        # Persist JSON data so bash tools can operate on it.
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        await _call_maybe_async(sandbox.files.write, "/workspace/data.json", payload)
        
        now = time.time()
        with self._lock:
            self._sessions[session_id] = SandboxSession(
                sandbox=sandbox, readonly=bool(readonly), created_at=now, last_activity=now
            )
        
        # 启动清理任务（如果尚未运行）
        await self._ensure_cleanup_task()
        return {"success": True}

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
        """
        from .file_utils import prepare_files_for_sandbox
        
        await self.stop(session_id)
        
        # Create a fresh sandbox instance
        try:
            sandbox = await _call_maybe_async(self._sandbox_factory)
        except Exception as e:
            msg = str(e)
            if "Could not resolve authentication method" in msg:
                hint = (
                    "E2B sandbox auth is not configured.\n"
                    "- Set `E2B_API_KEY` in `backend/.env` (or export it) and restart the backend, OR\n"
                    "- Remove bash access from the Agent configuration (Agent Settings → Data Access).\n"
                    f"- Detected E2B_API_KEY={'set' if os.getenv('E2B_API_KEY') else 'missing'}"
                )
                msg = f"{hint}\nOriginal error: {msg}"
            return {"success": False, "error": msg}
        
        # 并行下载所有文件
        prepared_files, failed_files = await prepare_files_for_sandbox(files, s3_service)
        
        # 创建目录并写入文件到沙盒
        created_dirs: set[str] = set()
        write_failures: list[dict] = []
        
        # 首先确保 /workspace 目录存在
        # E2B 沙盒以普通用户运行，需要 sudo 在根目录创建文件夹
        try:
            mkdir_result = await _call_maybe_async(
                sandbox.commands.run, 
                "sudo mkdir -p /workspace && sudo chmod 777 /workspace"
            )
            exit_code = getattr(mkdir_result, "exit_code", None)
            if exit_code is not None and exit_code != 0:
                stderr = getattr(mkdir_result, "stderr", "")
                print(f"[E2BSandbox] Warning: Failed to create /workspace directory with sudo: exit_code={exit_code}, stderr={stderr}")
                # 尝试使用用户目录作为备选
                fallback_result = await _call_maybe_async(
                    sandbox.commands.run,
                    "mkdir -p ~/workspace && sudo ln -sf ~/workspace /workspace 2>/dev/null || true"
                )
                fallback_code = getattr(fallback_result, "exit_code", None)
                if fallback_code == 0:
                    print(f"[E2BSandbox] Created /workspace via symlink to ~/workspace")
                else:
                    print(f"[E2BSandbox] Fallback also failed, continuing anyway...")
            else:
                print(f"[E2BSandbox] Created /workspace directory with sudo")
        except Exception as e:
            print(f"[E2BSandbox] Error creating /workspace directory: {e}")
        
        for f in prepared_files:
            path = f["path"]
            content = f["content"]
            
            # 安全检查：防止路径穿越攻击
            # 规范化路径并检查是否尝试逃逸 /workspace
            normalized_path = os.path.normpath(path)
            # 只允许 /workspace 下的路径
            if not normalized_path.startswith("/workspace/") and normalized_path != "/workspace":
                # 如果路径不以 /workspace 开头，自动添加前缀
                if normalized_path.startswith("/"):
                    normalized_path = "/workspace" + normalized_path
                else:
                    normalized_path = "/workspace/" + normalized_path
            # 检查是否有 .. 逃逸
            if ".." in normalized_path.split("/"):
                write_failures.append({
                    "path": path, 
                    "error": "Path traversal detected: path contains .."
                })
                print(f"[E2BSandbox] Path traversal attempt blocked: {path}")
                continue
            
            # 使用规范化后的路径
            path = normalized_path
            print(f"[E2BSandbox] Writing file to: {path}")
            
            # Create parent directories (使用 shlex.quote 防止命令注入)
            # 由于 /workspace 已经用 sudo 创建并设为 777，子目录应该不需要 sudo
            # 但为保险起见，如果普通 mkdir 失败则尝试 sudo
            dir_path = os.path.dirname(path)
            if dir_path and dir_path not in created_dirs:
                try:
                    safe_dir_path = shlex.quote(dir_path)
                    mkdir_result = await _call_maybe_async(sandbox.commands.run, f"mkdir -p {safe_dir_path}")
                    exit_code = getattr(mkdir_result, "exit_code", None)
                    if exit_code is not None and exit_code != 0:
                        # 尝试使用 sudo
                        sudo_result = await _call_maybe_async(
                            sandbox.commands.run, 
                            f"sudo mkdir -p {safe_dir_path} && sudo chmod 777 {safe_dir_path}"
                        )
                        sudo_code = getattr(sudo_result, "exit_code", None)
                        if sudo_code is not None and sudo_code != 0:
                            stderr = getattr(sudo_result, "stderr", "")
                            write_failures.append({"path": path, "error": f"Failed to create directory {dir_path}: exit_code={sudo_code}, stderr={stderr}"})
                            print(f"[E2BSandbox] Failed to create directory {dir_path} even with sudo: exit_code={sudo_code}")
                            continue
                        print(f"[E2BSandbox] Created directory with sudo: {dir_path}")
                    else:
                        print(f"[E2BSandbox] Created directory: {dir_path}")
                    created_dirs.add(dir_path)
                except Exception as e:
                    write_failures.append({"path": path, "error": f"Failed to create directory: {e}"})
                    print(f"[E2BSandbox] Exception creating directory {dir_path}: {e}")
                    continue
            
            # Write file content
            try:
                if isinstance(content, bytes):
                    await _call_maybe_async(sandbox.files.write, path, content)
                    print(f"[E2BSandbox] Wrote {len(content)} bytes to {path}")
                elif content is not None:
                    content_str = str(content)
                    await _call_maybe_async(sandbox.files.write, path, content_str)
                    print(f"[E2BSandbox] Wrote {len(content_str)} chars to {path}")
                else:
                    print(f"[E2BSandbox] Skipping {path}: content is None")
            except Exception as e:
                write_failures.append({"path": path, "error": str(e)})
                print(f"[E2BSandbox] Failed to write file {path}: {e}")
        
        # 合并所有失败的文件
        all_failures = failed_files + write_failures
        
        now = time.time()
        with self._lock:
            self._sessions[session_id] = SandboxSession(
                sandbox=sandbox, readonly=bool(readonly), created_at=now, last_activity=now
            )
        
        # 启动清理任务（如果尚未运行）
        await self._ensure_cleanup_task()
        
        result: dict[str, Any] = {"success": True}
        if all_failures:
            result["warnings"] = all_failures
        return result

    async def exec(self, session_id: str, command: str) -> dict:
        """在沙盒中执行命令并返回输出"""
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {
                "success": False,
                "error": "Sandbox session not found. Call start first.",
            }
        
        # 更新最后活动时间
        session.last_activity = time.time()
        
        # Execute in sandbox and normalize output to text.
        try:
            result = await _call_maybe_async(session.sandbox.commands.run, command)
            output = getattr(result, "text", str(result))
            
            # 检查是否有错误输出（E2B 可能在 stderr 中返回错误）
            stderr = getattr(result, "stderr", None)
            exit_code = getattr(result, "exit_code", None)
            
            if exit_code is not None and exit_code != 0:
                # 命令执行失败
                error_output = stderr if stderr else output
                return {
                    "success": False,
                    "error": f"Command failed with exit code {exit_code}: {error_output}",
                    "output": output,
                    "exit_code": exit_code
                }
            
            return {"success": True, "output": output}
        except Exception as e:
            error_msg = str(e)
            print(f"[E2BSandbox] Command execution failed: {error_msg}")
            return {
                "success": False,
                "error": f"Command execution failed: {error_msg}"
            }

    async def read(self, session_id: str) -> dict:
        """读取并解析 /workspace/data.json 的 JSON 数据"""
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {"success": False, "error": "Sandbox session not found"}
        
        # 更新最后活动时间
        session.last_activity = time.time()
        
        raw = await _call_maybe_async(session.sandbox.files.read, "/workspace/data.json")
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            data = json.loads(raw)
            return {"success": True, "data": data}
        except Exception:
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
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {"success": False, "error": "Sandbox session not found"}
        
        # 更新最后活动时间
        session.last_activity = time.time()
        
        try:
            raw = await _call_maybe_async(session.sandbox.files.read, path)
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            
            if parse_json:
                try:
                    data = json.loads(raw)
                    return {"success": True, "content": data}
                except json.JSONDecodeError:
                    return {"success": False, "error": f"Failed to parse JSON from {path}"}
            else:
                return {"success": True, "content": raw}
        except Exception as e:
            return {"success": False, "error": f"Failed to read {path}: {str(e)}"}

    async def stop(self, session_id: str) -> dict:
        """关闭并移除沙盒会话"""
        with self._lock:
            session = self._sessions.pop(session_id, None)
        
        if not session:
            return {"success": True}
        
        # Some sandbox implementations expose close(); guard it.
        close = getattr(session.sandbox, "close", None)
        if callable(close):
            try:
                await _call_maybe_async(close)
            except Exception as e:
                print(f"[E2BSandbox] Error closing sandbox {session_id}: {e}")
        
        return {"success": True}

    async def status(self, session_id: str) -> dict:
        """返回会话状态和基本元数据"""
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {"active": False}
        
        sandbox_id = getattr(session.sandbox, "id", None)
        return {
            "active": True,
            "sandbox_id": sandbox_id,
            "readonly": session.readonly,
            "created_at": session.created_at,
            "last_activity": session.last_activity,
        }

    async def stop_all(self) -> None:
        """停止所有沙盒会话（用于服务关闭时）"""
        with self._lock:
            session_ids = list(self._sessions.keys())
        
        for session_id in session_ids:
            await self.stop(session_id)
        
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def _ensure_cleanup_task(self):
        """确保清理任务正在运行"""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_sessions())

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
                
                for session_id in expired_sessions:
                    print(f"[E2BSandbox] Cleaning up expired session: {session_id}")
                    await self.stop(session_id)
                
                # 如果没有活跃会话，退出清理任务
                with self._lock:
                    if not self._sessions:
                        break
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[E2BSandbox] Cleanup task error: {e}")


def _default_e2b_factory():
    """默认工厂：创建 E2B 沙盒实例"""
    from e2b_code_interpreter import Sandbox

    return Sandbox.create()


async def _call_maybe_async(func: Callable[..., Any], *args, **kwargs):
    """运行同步调用在线程中；直接 await 异步调用"""
    if inspect.iscoroutinefunction(func):
        return await func(*args, **kwargs)
    result = await asyncio.to_thread(func, *args, **kwargs)
    if inspect.isawaitable(result):
        return await result
    return result

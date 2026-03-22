"""Docker sandbox implementation"""

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

from src.config import settings

from .base import SandboxBase, SandboxSession


# Docker session timeout (seconds)
DEFAULT_DOCKER_SESSION_TIMEOUT = 600  # 10 minutes


@dataclass
class DockerSession(SandboxSession):
    """Docker sandbox session data"""
    container_id: str = ""
    temp_path: str = ""  # Temporary file or directory path


class DockerSandbox(SandboxBase):
    """
    Docker local sandbox implementation

    Uses Docker containers to run sandbox environments, supporting:
    - Single-file JSON data mounting
    - Multi-file mounting
    - Command execution
    - File reading
    """
    
    def __init__(self, session_timeout: float = DEFAULT_DOCKER_SESSION_TIMEOUT):
        """
        Initialize Docker sandbox service

        Args:
            session_timeout: Session timeout in seconds, default 10 minutes
        """
        self._sessions: dict[str, DockerSession] = {}
        self._lock = threading.Lock()  # For fast synchronous access
        self._async_lock = asyncio.Lock()  # For async operation mutual exclusion
        self._session_timeout = session_timeout
        self._cleanup_task: Optional[asyncio.Task] = None
        self._docker_available: Optional[bool] = None
        self._docker_check_time: float = 0  # Last check time
        self._docker_cache_ttl: float = 60.0  # Cache TTL (seconds)

    def _get_sandbox_temp_root(self) -> str:
        """
        Return the dedicated temporary directory for Docker sandbox.

        Falls back to the system default temporary directory when SANDBOX_TMPDIR
        is not configured, for compatibility with running the backend locally.
        """
        sandbox_tmpdir = (settings.SANDBOX_TMPDIR or "").strip()
        if sandbox_tmpdir:
            os.makedirs(sandbox_tmpdir, exist_ok=True)
            return sandbox_tmpdir
        return tempfile.gettempdir()

    def _create_temp_json_file(self, session_id: str) -> str:
        """Create a host-visible temporary JSON file for a single-file sandbox."""
        fd, temp_file_path = tempfile.mkstemp(
            prefix=f"sandbox-{session_id}-",
            suffix=".json",
            dir=self._get_sandbox_temp_root(),
        )
        os.close(fd)
        return temp_file_path

    def _create_temp_workspace_dir(self, session_id: str) -> str:
        """Create a host-visible temporary workspace directory for a multi-file sandbox."""
        return tempfile.mkdtemp(
            prefix=f"sandbox-{session_id}-",
            dir=self._get_sandbox_temp_root(),
        )
    
    async def _check_docker_available(self, force_recheck: bool = False) -> bool:
        """
        Check if Docker is available

        Args:
            force_recheck: Force recheck, ignoring cache

        Returns:
            Whether Docker is available
        """
        now = time.time()
        
        # Check if cache is valid
        # 1. If cache is True and not expired, return directly
        # 2. If cache is False, always recheck (Docker may have just started)
        # 3. If force_recheck is True, force recheck
        cache_expired = (now - self._docker_check_time) > self._docker_cache_ttl
        
        if not force_recheck and self._docker_available is True and not cache_expired:
            return True
        
        # If Docker was previously unavailable, or cache expired, or force check, re-detect
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
        Execute a Docker command

        Args:
            *args: Command arguments
            timeout: Timeout in seconds

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
        """Periodically clean up expired sandbox sessions"""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute
                now = time.time()
                expired_sessions = []
                
                with self._lock:
                    for session_id, session in self._sessions.items():
                        if now - session.last_activity > self._session_timeout:
                            expired_sessions.append(session_id)
                
                # Clean up one by one using async lock
                for session_id in expired_sessions:
                    print(f"[DockerSandbox] Cleaning up expired session: {session_id}")
                    async with self._async_lock:
                        await self._stop_internal(session_id)
                
                # If no active sessions, exit the cleanup task
                with self._lock:
                    if not self._sessions:
                        break
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[DockerSandbox] Cleanup task error: {e}")

    async def _ensure_cleanup_task(self):
        """Ensure the cleanup task is running"""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_sessions())
    
    async def _wait_for_container_ready(
        self,
        container_id: str,
        max_retries: int = 30,
        retry_interval: float = 1.0
    ) -> bool:
        """
        Wait for the container to be ready (verified by executing a simple command)

        Args:
            container_id: Container ID
            max_retries: Maximum number of retries
            retry_interval: Retry interval in seconds

        Returns:
            Whether the container is ready
        """
        for i in range(max_retries):
            # Try executing a simple command to verify the container is ready
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
        Attempt to start a Docker container

        Args:
            mount_args: List of mount arguments
            use_custom_image: Whether to use a custom image

        Returns:
            (success, container_id, error_message)
        """
        # Resource limits: prevent a single container from exhausting host resources
        resource_args = ["--memory=128m", "--cpus=0.5", "--pids-limit=100"]
        
        if use_custom_image:
            # Try using the custom json-sandbox image
            args = ["run", "-d", "--rm"] + resource_args + mount_args + ["json-sandbox"]
            returncode, stdout, stderr = await self._run_docker_command(*args, timeout=30.0)
            
            if returncode == 0:
                container_id = stdout.strip()
                # Wait for container to be ready
                if await self._wait_for_container_ready(container_id, max_retries=10):
                    return (True, container_id, "")
                else:
                    # Container not ready, clean up and fail
                    await self._run_docker_command("stop", container_id, timeout=5.0)
                    return (False, "", "Container started but not ready")

            # Custom image not found, fall back to alpine
            print(f"[DockerSandbox] json-sandbox image not found, falling back to alpine:3.19")
        
        # Use alpine:3.19 and install jq and bash
        args = ["run", "-d", "--rm"] + resource_args + mount_args + [
            "alpine:3.19",
            "sh", "-c",
            "apk add --no-cache jq bash >/dev/null 2>&1 && tail -f /dev/null"
        ]
        returncode, stdout, stderr = await self._run_docker_command(*args, timeout=60.0)
        
        if returncode == 0:
            container_id = stdout.strip()
            # Wait for apk installation to complete and verify container is ready
            # Give alpine more time since it needs to install packages
            if await self._wait_for_container_ready(container_id, max_retries=30, retry_interval=1.0):
                return (True, container_id, "")
            else:
                # Container not ready, clean up and fail
                await self._run_docker_command("stop", container_id, timeout=5.0)
                return (False, "", "Container started but packages not installed in time")
        
        return (False, "", f"Failed to start container: {stderr}")
    
    async def start(self, session_id: str, data: Any, readonly: bool = False) -> dict:
        """
        Create a sandbox session and preload a single JSON data into /workspace/data.json

        Args:
            session_id: Unique session identifier
            data: JSON data (will be written to /workspace/data.json)
            readonly: Whether to use read-only mode

        Returns:
            {"success": True} or {"success": False, "error": str}
        """
        # Check if Docker is available
        if not await self._check_docker_available():
            return {
                "success": False, 
                "error": "Docker is not available. Please ensure Docker is installed and running."
            }
        
        # Clean up expired sessions
        await self._ensure_cleanup_task()

        # If already exists, stop first (use async lock to protect the check-stop operation)
        async with self._async_lock:
            with self._lock:
                session_exists = session_id in self._sessions
            if session_exists:
                await self._stop_internal(session_id)

        # Create temporary JSON file
        temp_file_path = self._create_temp_json_file(session_id)

        try:
            json_content = json.dumps(data, ensure_ascii=False, indent=2)
            with open(temp_file_path, "w", encoding="utf-8") as f:
                f.write(json_content)
        except Exception as e:
            return {"success": False, "error": f"Failed to create temp file: {e}"}
        
        # Build mount arguments
        mount_option = f"{temp_file_path}:/workspace/data.json"
        if readonly:
            mount_option += ":ro"
        mount_args = ["-v", mount_option]
        
        # Start container
        success, container_id, error = await self._try_start_container(mount_args)

        if not success:
            # Clean up temporary file
            try:
                os.unlink(temp_file_path)
            except Exception:
                pass
            return {"success": False, "error": error}

        # Record session
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
        Create a sandbox session and preload multiple files

        Args:
            session_id: Unique session identifier
            files: List of SandboxFile, each containing path, content, s3_key
            readonly: Whether to use read-only mode
            s3_service: S3 service instance (for downloading S3 files)

        Returns:
            {"success": True} or {"success": False, "error": str}
            May include a "warnings" field listing failed files
        """

        # Check if Docker is available
        if not await self._check_docker_available():
            return {
                "success": False, 
                "error": "Docker is not available. Please ensure Docker is installed and running."
            }
        
        # Clean up expired sessions
        await self._ensure_cleanup_task()

        # If already exists, stop first (use async lock to protect the check-stop operation)
        async with self._async_lock:
            with self._lock:
                session_exists = session_id in self._sessions
            if session_exists:
                await self._stop_internal(session_id)

        # Create temporary directory to store all files
        temp_dir = self._create_temp_workspace_dir(session_id)
        workspace_dir = os.path.join(temp_dir, "workspace")
        os.makedirs(workspace_dir, exist_ok=True)
        
        # Use the dedicated Docker file preparation function, large files are streamed directly to disk
        from .file_utils import prepare_files_for_docker_sandbox
        written_paths, all_failures = await prepare_files_for_docker_sandbox(
            files, workspace_dir, s3_service
        )
        
        # Build mount arguments
        mount_option = f"{workspace_dir}:/workspace"
        if readonly:
            mount_option += ":ro"
        mount_args = ["-v", mount_option]
        
        # Start container
        success, container_id, error = await self._try_start_container(mount_args)

        if not success:
            # Clean up temporary directory
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass
            return {"success": False, "error": error}
        
        # Record session
        now = time.time()
        with self._lock:
            self._sessions[session_id] = DockerSession(
                sandbox=container_id,
                readonly=readonly,
                created_at=now,
                last_activity=now,
                container_id=container_id,
                temp_path=temp_dir  # Save the entire temporary directory
            )
        
        print(f"[DockerSandbox] Started session {session_id} with {len(written_paths)} files written, container: {container_id[:12]}, readonly: {readonly}")
        
        result: dict[str, Any] = {"success": True}
        if all_failures:
            result["warnings"] = all_failures
        return result
    
    async def exec(self, session_id: str, command: str) -> dict:
        """
        Execute a command in the sandbox

        Args:
            session_id: Session identifier
            command: Bash command to execute

        Returns:
            {"success": True, "output": str} or {"success": False, "error": str}
        """
        with self._lock:
            session = self._sessions.get(session_id)
        
        if not session:
            return {
                "success": False,
                "error": "Sandbox session not found. Call start first."
            }
        
        # Update last activity time
        session.last_activity = time.time()

        # Security notes:
        # 1. _run_docker_command uses asyncio.subprocess_exec, bypassing the host shell,
        #    so command is passed as a single argument to sh -c inside the container, no host-level injection risk
        # 2. Executing arbitrary commands inside the container is the sandbox's design purpose, no need to restrict at this level
        # 3. The container itself provides isolation, limiting the potential scope of damage
        
        returncode, stdout, stderr = await self._run_docker_command(
            "exec", session.container_id,
            "sh", "-c", command,
            timeout=30.0
        )
        
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            # Command execution failed, uniformly return success=False
            # Also provide output and exit_code for the caller to get detailed info
            output = stdout + stderr
            return {
                "success": False,
                "error": f"Command failed with exit code {returncode}",
                "output": output,
                "exit_code": returncode
            }
    
    async def read(self, session_id: str) -> dict:
        """
        Read the contents of /workspace/data.json

        Args:
            session_id: Session identifier

        Returns:
            {"success": True, "data": dict} or {"success": False, "error": str}
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
        Read a file at the specified path in the sandbox

        Args:
            session_id: Session identifier
            path: File path (e.g. /workspace/myfile.json)
            parse_json: Whether to parse as JSON

        Returns:
            {"success": True, "content": str/dict} or {"success": False, "error": str}
        """
        # Use shlex.quote to prevent path injection
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
        Internal stop method, does not acquire the async lock

        Args:
            session_id: Session identifier

        Returns:
            Whether the session was successfully stopped (whether it existed)
        """
        with self._lock:
            session = self._sessions.pop(session_id, None)
        
        if not session:
            return False  # Already does not exist

        # Stop container
        try:
            await self._run_docker_command(
                "stop", session.container_id,
                timeout=10.0
            )
        except Exception as e:
            print(f"[DockerSandbox] Error stopping container {session_id}: {e}")
        
        # Clean up temporary files/directories
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
        Stop and clean up a sandbox session

        Args:
            session_id: Session identifier

        Returns:
            {"success": True}
        """
        async with self._async_lock:
            await self._stop_internal(session_id)
        return {"success": True}
    
    async def status(self, session_id: str) -> dict:
        """
        Get sandbox session status

        Args:
            session_id: Session identifier

        Returns:
            {"active": bool, ...} including other metadata
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
        """Stop all sandbox sessions (used during service shutdown)"""
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

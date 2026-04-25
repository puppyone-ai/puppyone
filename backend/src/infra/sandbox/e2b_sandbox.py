"""E2B cloud sandbox implementation"""

import asyncio
import inspect
import json
import os
import shlex
import time
import threading
from typing import Any, Callable, Optional

from .base import SandboxBase, SandboxSession


# Default sandbox session timeout (seconds)
DEFAULT_SESSION_TIMEOUT = 1800  # 30 minutes


class E2BSandbox(SandboxBase):
    """
    E2B cloud sandbox implementation

    Uses the e2b-code-interpreter SDK to provide a cloud-based isolated code execution environment.
    """

    def __init__(
        self,
        sandbox_factory: Optional[Callable[[], Any]] = None,
        session_timeout: float = DEFAULT_SESSION_TIMEOUT,
    ):
        """
        Initialize E2B sandbox service

        Args:
            sandbox_factory: Sandbox factory function (mainly for testing)
            session_timeout: Session timeout in seconds
        """
        self._sandbox_factory = sandbox_factory or _default_e2b_factory
        self._sessions: dict[str, SandboxSession] = {}
        self._lock = threading.Lock()  # Protects concurrent access to _sessions
        self._session_timeout = session_timeout
        self._cleanup_task: Optional[asyncio.Task] = None

    async def start(self, session_id: str, data: Any, readonly: bool) -> dict:
        """Create a sandbox session and preload data into /workspace/data.json"""
        if data is None:
            return {"success": False, "error": "data is required"}

        await self.stop(session_id)

        # Create a fresh sandbox instance for this session.
        try:
            sandbox = await _call_maybe_async(self._sandbox_factory)
        except Exception as e:
            msg = str(e)
            # e2b-code-interpreter raises this type of error when authentication is not configured:
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

        # Start cleanup task (if not already running)
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
        Create a sandbox session and preload multiple files

        Args:
            session_id: Unique session identifier
            files: List of SandboxFile, each containing path, content, s3_key
            readonly: Whether to use read-only mode
            s3_service: S3 service instance (for downloading S3 files)
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

        # Download all files in parallel
        prepared_files, failed_files = await prepare_files_for_sandbox(files, s3_service)

        # Create directories and write files to the sandbox
        created_dirs: set[str] = set()
        write_failures: list[dict] = []

        # First ensure /workspace directory exists
        # E2B sandbox runs as a regular user, needs sudo to create folders in the root directory
        try:
            mkdir_result = await _call_maybe_async(
                sandbox.commands.run,
                "sudo mkdir -p /workspace && sudo chmod 777 /workspace"
            )
            exit_code = getattr(mkdir_result, "exit_code", None)
            if exit_code is not None and exit_code != 0:
                stderr = getattr(mkdir_result, "stderr", "")
                print(f"[E2BSandbox] Warning: Failed to create /workspace directory with sudo: exit_code={exit_code}, stderr={stderr}")
                # Try using user directory as fallback
                fallback_result = await _call_maybe_async(
                    sandbox.commands.run,
                    "mkdir -p ~/workspace && sudo ln -sf ~/workspace /workspace 2>/dev/null || true"
                )
                fallback_code = getattr(fallback_result, "exit_code", None)
                if fallback_code == 0:
                    print("[E2BSandbox] Created /workspace via symlink to ~/workspace")
                else:
                    print("[E2BSandbox] Fallback also failed, continuing anyway...")
            else:
                print("[E2BSandbox] Created /workspace directory with sudo")
        except Exception as e:
            print(f"[E2BSandbox] Error creating /workspace directory: {e}")

        for f in prepared_files:
            path = f["path"]
            content = f["content"]

            # Security check: prevent path traversal attacks
            # Normalize path using posixpath (not os.path which uses backslashes on Windows)
            import posixpath
            normalized_path = posixpath.normpath(path)
            # Only allow paths under /workspace
            if not normalized_path.startswith("/workspace/") and normalized_path != "/workspace":
                # If path doesn't start with /workspace, automatically add the prefix
                if normalized_path.startswith("/"):
                    normalized_path = "/workspace" + normalized_path
                else:
                    normalized_path = "/workspace/" + normalized_path
            # Check for .. escape attempts
            if ".." in normalized_path.split("/"):
                write_failures.append({
                    "path": path,
                    "error": "Path traversal detected: path contains .."
                })
                print(f"[E2BSandbox] Path traversal attempt blocked: {path}")
                continue

            # Use the normalized path
            path = normalized_path
            print(f"[E2BSandbox] Writing file to: {path}")

            # Create parent directories (use shlex.quote to prevent command injection)
            # Since /workspace was already created with sudo and set to 777, subdirectories shouldn't need sudo
            # But as a safety measure, try sudo if regular mkdir fails
            dir_path = posixpath.dirname(path)
            if dir_path and dir_path not in created_dirs:
                try:
                    safe_dir_path = shlex.quote(dir_path)
                    mkdir_result = await _call_maybe_async(sandbox.commands.run, f"mkdir -p {safe_dir_path}")
                    exit_code = getattr(mkdir_result, "exit_code", None)
                    if exit_code is not None and exit_code != 0:
                        # Try using sudo
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

        # Merge all failed files
        all_failures = failed_files + write_failures

        now = time.time()
        with self._lock:
            self._sessions[session_id] = SandboxSession(
                sandbox=sandbox, readonly=bool(readonly), created_at=now, last_activity=now
            )

        # Start cleanup task (if not already running)
        await self._ensure_cleanup_task()

        result: dict[str, Any] = {"success": True}
        if all_failures:
            result["warnings"] = all_failures
        return result

    async def exec(self, session_id: str, command: str) -> dict:
        """Execute a command in the sandbox and return its output"""
        with self._lock:
            session = self._sessions.get(session_id)

        if not session:
            return {
                "success": False,
                "error": "Sandbox session not found. Call start first.",
            }

        # Update last activity time
        session.last_activity = time.time()

        # Execute in sandbox and normalize output to text.
        # Always run commands in /workspace so agent file operations land in the right place.
        try:
            result = await _call_maybe_async(session.sandbox.commands.run, command, cwd="/workspace")
            # E2B SDK v1+ uses .stdout/.stderr; older versions use .text
            output = getattr(result, "text", None)
            if output is None:
                stdout = getattr(result, "stdout", "")
                stderr = getattr(result, "stderr", "")
                output = stdout if stdout else stderr if stderr else str(result)

            # Check for error output (E2B may return errors in stderr)
            stderr = getattr(result, "stderr", None)
            exit_code = getattr(result, "exit_code", None)

            if exit_code is not None and exit_code != 0:
                # Command execution failed
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
        """Read and parse JSON data from /workspace/data.json"""
        with self._lock:
            session = self._sessions.get(session_id)

        if not session:
            return {"success": False, "error": "Sandbox session not found"}

        # Update last activity time
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
        Read a file at the specified path in the sandbox

        Args:
            session_id: Session identifier
            path: File path (e.g. /workspace/myfile.json)
            parse_json: Whether to parse as JSON

        Returns:
            {"success": True, "content": str/dict} or {"success": False, "error": str}
        """
        with self._lock:
            session = self._sessions.get(session_id)

        if not session:
            return {"success": False, "error": "Sandbox session not found"}

        # Update last activity time
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
            return {"success": False, "error": f"Failed to read {path}: {e!s}"}

    async def stop(self, session_id: str) -> dict:
        """Close and remove sandbox session"""
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
        """Return session status and basic metadata"""
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
        """Stop all sandbox sessions (used during service shutdown)"""
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
        """Ensure the cleanup task is running"""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_sessions())

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

                for session_id in expired_sessions:
                    print(f"[E2BSandbox] Cleaning up expired session: {session_id}")
                    await self.stop(session_id)

                # If no active sessions, exit the cleanup task
                with self._lock:
                    if not self._sessions:
                        break
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[E2BSandbox] Cleanup task error: {e}")


def _default_e2b_factory():
    """Default factory: create an E2B sandbox instance"""
    from e2b_code_interpreter import Sandbox

    return Sandbox.create()


async def _call_maybe_async(func: Callable[..., Any], *args, **kwargs):
    """Run synchronous calls in a thread; directly await async calls"""
    if inspect.iscoroutinefunction(func):
        return await func(*args, **kwargs)
    result = await asyncio.to_thread(func, *args, **kwargs)
    if inspect.isawaitable(result):
        return await result
    return result

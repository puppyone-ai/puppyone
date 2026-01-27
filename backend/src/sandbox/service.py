from dataclasses import dataclass
import asyncio
import inspect
import json
import os
from typing import Any, Callable, Optional


@dataclass
class SandboxSession:
    """Runtime holder for a sandbox session."""
    sandbox: Any
    readonly: bool


class SandboxService:
    """Sandbox lifecycle using e2b SDK."""

    def __init__(self, sandbox_factory: Optional[Callable[[], Any]] = None):
        """Initialize with a sandbox factory (mainly for testing)."""
        self._sandbox_factory = sandbox_factory or _default_sandbox_factory
        self._sessions: dict[str, SandboxSession] = {}

    async def start(self, session_id: str, data, readonly: bool):
        """Create a sandbox session and preload data into /workspace/data.json."""
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
                    "- Disable bash access in the chat access points (shell_access / shell_access_readonly).\n"
                    f"- Detected E2B_API_KEY={'set' if os.getenv('E2B_API_KEY') else 'missing'}"
                )
                msg = f"{hint}\nOriginal error: {msg}"
            return {"success": False, "error": msg}
        # Persist JSON data so bash tools can operate on it.
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        await _call_maybe_async(sandbox.files.write, "/workspace/data.json", payload)
        self._sessions[session_id] = SandboxSession(
            sandbox=sandbox, readonly=bool(readonly)
        )
        return {"success": True}

    async def start_with_files(self, session_id: str, files: list, readonly: bool, s3_service=None):
        """
        Create a sandbox session and preload multiple files.
        
        Args:
            session_id: Unique session identifier
            files: List of SandboxFile objects with path, content, and/or s3_key
            readonly: Whether the sandbox is read-only
            s3_service: Optional S3Service for downloading files from S3
        """
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
                    "- Disable bash access in the chat access points.\n"
                    f"- Detected E2B_API_KEY={'set' if os.getenv('E2B_API_KEY') else 'missing'}"
                )
                msg = f"{hint}\nOriginal error: {msg}"
            return {"success": False, "error": msg}
        
        # Create necessary directories and write files
        created_dirs = set()
        for f in files:
            path = f.path if isinstance(f, dict) else getattr(f, 'path', None)
            content = f.get('content') if isinstance(f, dict) else getattr(f, 'content', None)
            s3_key = f.get('s3_key') if isinstance(f, dict) else getattr(f, 's3_key', None)
            
            if not path:
                continue
            
            # Create parent directories
            dir_path = os.path.dirname(path)
            if dir_path and dir_path not in created_dirs:
                try:
                    await _call_maybe_async(sandbox.commands.run, f"mkdir -p {dir_path}")
                    created_dirs.add(dir_path)
                except Exception:
                    pass
            
            # Write file content
            if content is not None:
                # Text/JSON content - write directly
                await _call_maybe_async(sandbox.files.write, path, content)
            elif s3_key and s3_service:
                # S3 file - download and write
                try:
                    file_bytes = await s3_service.download_file(s3_key)
                    if isinstance(file_bytes, bytes):
                        # Binary file - write as bytes
                        await _call_maybe_async(sandbox.files.write, path, file_bytes)
                    else:
                        await _call_maybe_async(sandbox.files.write, path, str(file_bytes))
                except Exception as e:
                    # Log but continue - don't fail the entire sandbox
                    print(f"[SandboxService] Failed to download S3 file {s3_key}: {e}")
        
        self._sessions[session_id] = SandboxSession(
            sandbox=sandbox, readonly=bool(readonly)
        )
        return {"success": True}

    async def exec(self, session_id: str, command: str):
        """Run a command inside the sandbox and return its output."""
        session = self._sessions.get(session_id)
        if not session:
            return {
                "success": False,
                "error": "Sandbox session not found. Call start first.",
            }
        # Execute in sandbox and normalize output to text.
        result = await _call_maybe_async(session.sandbox.commands.run, command)
        output = getattr(result, "text", str(result))
        return {"success": True, "output": output}

    async def read(self, session_id: str):
        """Read and parse JSON data from /workspace/data.json."""
        session = self._sessions.get(session_id)
        if not session:
            return {"success": False, "error": "Sandbox session not found"}
        raw = await _call_maybe_async(session.sandbox.files.read, "/workspace/data.json")
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            data = json.loads(raw)
            return {"success": True, "data": data}
        except Exception:
            return {"success": False, "error": "Failed to parse JSON"}

    async def stop(self, session_id: str):
        """Close and remove a sandbox session."""
        session = self._sessions.pop(session_id, None)
        if not session:
            return {"success": True}
        # Some sandbox implementations expose close(); guard it.
        close = getattr(session.sandbox, "close", None)
        if callable(close):
            await _call_maybe_async(close)
        return {"success": True}

    async def status(self, session_id: str):
        """Return session status and basic metadata."""
        session = self._sessions.get(session_id)
        if not session:
            return {"active": False}
        sandbox_id = getattr(session.sandbox, "id", None)
        return {
            "active": True,
            "sandbox_id": sandbox_id,
            "readonly": session.readonly,
        }


def _default_sandbox_factory():
    """Default factory: create an e2b sandbox."""
    from e2b_code_interpreter import Sandbox

    return Sandbox.create()


async def _call_maybe_async(func: Callable[..., Any], *args, **kwargs):
    """Run sync calls in a thread; await async calls in-place."""
    if inspect.iscoroutinefunction(func):
        return await func(*args, **kwargs)
    result = await asyncio.to_thread(func, *args, **kwargs)
    if inspect.isawaitable(result):
        return await result
    return result

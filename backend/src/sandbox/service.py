from dataclasses import dataclass
import asyncio
import inspect
import json
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
        sandbox = await _call_maybe_async(self._sandbox_factory)
        # Persist JSON data so bash tools can operate on it.
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        await _call_maybe_async(sandbox.files.write, "/workspace/data.json", payload)
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

from dataclasses import dataclass
import inspect
import json
from typing import Any, Callable, Optional


@dataclass
class SandboxSession:
    sandbox: Any
    readonly: bool


class SandboxService:
    """Sandbox lifecycle using e2b SDK."""

    def __init__(self, sandbox_factory: Optional[Callable[[], Any]] = None):
        self._sandbox_factory = sandbox_factory or _default_sandbox_factory
        self._sessions: dict[str, SandboxSession] = {}

    async def start(self, session_id: str, data, readonly: bool):
        if data is None:
            return {"success": False, "error": "data is required"}
        await self.stop(session_id)
        sandbox = await _maybe_await(self._sandbox_factory())
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        await _maybe_await(sandbox.files.write("/workspace/data.json", payload))
        self._sessions[session_id] = SandboxSession(
            sandbox=sandbox, readonly=bool(readonly)
        )
        return {"success": True}

    async def exec(self, session_id: str, command: str):
        session = self._sessions.get(session_id)
        if not session:
            return {
                "success": False,
                "error": "Sandbox session not found. Call start first.",
            }
        result = session.sandbox.commands.run(command)
        output = getattr(result, "text", str(result))
        return {"success": True, "output": output}

    async def read(self, session_id: str):
        session = self._sessions.get(session_id)
        if not session:
            return {"success": False, "error": "Sandbox session not found"}
        raw = await _maybe_await(session.sandbox.files.read("/workspace/data.json"))
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            data = json.loads(raw)
            return {"success": True, "data": data}
        except Exception:
            return {"success": False, "error": "Failed to parse JSON"}

    async def stop(self, session_id: str):
        session = self._sessions.pop(session_id, None)
        if not session:
            return {"success": True}
        close = getattr(session.sandbox, "close", None)
        if callable(close):
            await _maybe_await(close())
        return {"success": True}

    async def status(self, session_id: str):
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
    from e2b_code_interpreter import Sandbox

    return Sandbox.create()


async def _maybe_await(result):
    if inspect.isawaitable(result):
        return await result
    return result

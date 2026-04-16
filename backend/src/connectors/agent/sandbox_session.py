"""
Agent sandbox session management — reuse MUT-backed sandboxes across chat messages.

Each AgentSandboxSession holds a MutEphemeralClient that was cloned once at
session start. When the session ends (explicit or idle timeout), the client
pushes modified files back via MUT protocol.

Lifecycle:
  1. Agent chat starts → clone MUT scope → mount in sandbox → register session
  2. Subsequent messages → reuse same sandbox + MUT client (touch heartbeat)
  3. Chat ends / idle timeout → read changed files → client.push() → destroy sandbox
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Optional, Any

from loguru import logger

from src.mut_engine.services.ephemeral_client import MutEphemeralClient


@dataclass
class SandboxFile:
    """A file to mount in a sandbox container."""
    path: str
    content: str | None = None
    s3_key: str | None = None
    content_type: str = "application/octet-stream"
    mut_path: str | None = None
    node_type: str | None = None
    base_version: int = 0


@dataclass
class SandboxData:
    """Prepared sandbox data from MUT clone."""
    files: list[SandboxFile] = field(default_factory=list)
    node_type: str = "json"
    root_path: str = ""
    root_node_name: str = ""
    node_path_map: dict = field(default_factory=dict)


IDLE_TIMEOUT_SECONDS = 4 * 60  # 4 minutes


async def prepare_sandbox_data(
    ops,
    project_id: str,
    path: str,
) -> SandboxData:
    """Prepare files from MUT tree for sandbox mounting.

    Reads the MUT tree at `path` and returns SandboxFile objects
    suitable for sandbox_service.start_with_files().
    """

    entry = ops.stat(project_id, path)
    if not entry:
        raise ValueError(f"Path not found: {path}")

    node_type = entry.type or "json"
    node_name = entry.name or path.rsplit("/", 1)[-1]

    if node_type == "folder":
        children = ops.list_tree(project_id, path)
        files: list[SandboxFile] = []
        for child in children:
            if child.type == "folder":
                continue
            relative = child.path
            if relative.startswith(path + "/"):
                relative = relative[len(path) + 1:]
            try:
                raw = ops.read_file(project_id, child.path)
                text = raw.decode("utf-8", errors="replace")
            except Exception:
                continue
            files.append(SandboxFile(
                path=f"/workspace/{relative}",
                content=text,
                content_type="application/json" if child.type == "json" else "text/markdown" if child.type == "markdown" else "text/plain",
                mut_path=child.path,
                node_type=child.type,
            ))
        return SandboxData(files=files, node_type="folder", root_path=path, root_node_name=node_name)

    raw = ops.read_file(project_id, path)
    text = raw.decode("utf-8", errors="replace")
    sf = SandboxFile(
        path=f"/workspace/{node_name}" if node_type != "json" else "/workspace/data.json",
        content=text,
        content_type="application/json" if node_type == "json" else "text/markdown" if node_type == "markdown" else "text/plain",
        mut_path=path,
        node_type=node_type,
    )
    return SandboxData(files=[sf], node_type=node_type, root_path=path, root_node_name=node_name)


@dataclass
class AgentSandboxSession:
    sandbox_session_id: str
    chat_session_id: str
    agent_id: str
    mut_client: MutEphemeralClient
    cloned_files: dict[str, bytes]
    scope_path: str
    created_at: float
    last_active: float
    readonly: bool = False
    project_id: str = ""
    parent_path: str = ""


class AgentSandboxRegistry:
    """In-memory registry of active agent sandbox sessions.

    Keyed by chat_session_id for O(1) lookup on each message.
    """

    def __init__(self):
        self._sessions: dict[str, AgentSandboxSession] = {}

    def get(self, chat_session_id: str) -> Optional[AgentSandboxSession]:
        return self._sessions.get(chat_session_id)

    def register(
        self,
        chat_session_id: str,
        sandbox_session_id: str,
        agent_id: str,
        mut_client: MutEphemeralClient,
        cloned_files: dict[str, bytes],
        scope_path: str = "",
        readonly: bool = False,
        project_id: str = "",
        parent_path: str = "",
    ) -> AgentSandboxSession:
        now = time.time()
        session = AgentSandboxSession(
            sandbox_session_id=sandbox_session_id,
            chat_session_id=chat_session_id,
            agent_id=agent_id,
            mut_client=mut_client,
            cloned_files=cloned_files,
            scope_path=scope_path,
            created_at=now,
            last_active=now,
            readonly=readonly,
            project_id=project_id,
            parent_path=parent_path,
        )
        self._sessions[chat_session_id] = session
        logger.info(
            f"[AgentSandbox] Registered: chat={chat_session_id} "
            f"→ sandbox={sandbox_session_id} scope={scope_path}"
        )
        return session

    def touch(self, chat_session_id: str) -> None:
        session = self._sessions.get(chat_session_id)
        if session:
            session.last_active = time.time()

    def remove(self, chat_session_id: str) -> Optional[AgentSandboxSession]:
        return self._sessions.pop(chat_session_id, None)

    def get_idle_sessions(self) -> list[AgentSandboxSession]:
        now = time.time()
        return [
            s for s in self._sessions.values()
            if (now - s.last_active) >= IDLE_TIMEOUT_SECONDS
        ]

    def all_sessions(self) -> list[AgentSandboxSession]:
        return list(self._sessions.values())

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# ── Write-back ────────────────────────────────────────────

async def writeback_and_destroy(
    session: AgentSandboxSession,
    sandbox_service,
) -> list[dict]:
    """Read changed files from sandbox, push to MUT, then destroy the container.

    Returns list of updated node info dicts.
    """
    updated_nodes: list[dict] = []

    if not session.readonly and session.project_id:
        try:
            modified = await _read_modified_files(
                sandbox_service,
                session.sandbox_session_id,
                session.cloned_files,
                "/workspace",
                session.scope_path,
            )
            if modified:
                from src.mut_engine.services.hooks import push_and_finalize
                push_result = await push_and_finalize(
                    session.mut_client,
                    session.project_id,
                    modified=modified,
                    message=f"Agent write-back ({len(modified)} files)",
                    who=f"agent:{session.agent_id}",
                )
                logger.info(
                    f"[AgentSandbox] MUT push: v={push_result.get('version')} "
                    f"merged={push_result.get('merged', False)} files={len(modified)}"
                )
                for path in modified:
                    node_name = path.rsplit("/", 1)[-1] if "/" in path else path
                    updated_nodes.append({
                        "nodeId": path,
                        "nodeName": node_name,
                        "mergeStrategy": "mut_push",
                    })
        except Exception as e:
            logger.error(f"[AgentSandbox] Write-back failed: {e}")

    try:
        await sandbox_service.stop(session.sandbox_session_id)
    except Exception as e:
        logger.warning(f"[AgentSandbox] Failed to stop sandbox: {e}")

    return updated_nodes


async def _read_modified_files(
    sandbox_service,
    sandbox_session_id: str,
    original_files: dict[str, bytes],
    mount_path: str,
    scope_path: str,
) -> dict[str, bytes]:
    """Read files from sandbox container, return only changed ones.

    Args:
        mount_path: Container path to scan (e.g. "/workspace" or "/workspace/data").
        scope_path: MUT tree prefix to prepend to relative paths.

    Returns:
        {mut_path: content_bytes} for files that changed vs original_files.
    """
    scan_path = mount_path or "/workspace"
    hash_result = await sandbox_service.exec(
        sandbox_session_id,
        f"find {scan_path} -type f -exec sha256sum {{}} \\; 2>/dev/null"
    )
    if not hash_result.get("success"):
        return {}

    original_hashes: dict[str, str] = {}
    for mut_path, content in original_files.items():
        original_hashes[mut_path] = hashlib.sha256(content).hexdigest()

    modified: dict[str, bytes] = {}
    for line in (hash_result.get("output") or "").strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        current_hash, sandbox_path = parts

        if not sandbox_path.startswith(scan_path + "/"):
            continue

        relative = sandbox_path[len(scan_path) + 1:]
        if any(part.startswith(".") for part in relative.split("/")):
            continue

        mut_path = f"{scope_path}/{relative}" if scope_path else relative

        if mut_path in original_hashes and original_hashes[mut_path] == current_hash:
            continue

        read_result = await sandbox_service.read_file(sandbox_session_id, sandbox_path)
        if not read_result.get("success"):
            continue

        content = read_result.get("content", "")
        if isinstance(content, (dict, list)):
            content_bytes = json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
        elif isinstance(content, str):
            content_bytes = content.encode("utf-8")
        else:
            content_bytes = str(content).encode("utf-8")

        modified[mut_path] = content_bytes

    return modified


# ── Singleton ─────────────────────────────────────────────

_registry: Optional[AgentSandboxRegistry] = None


def get_agent_sandbox_registry() -> AgentSandboxRegistry:
    global _registry
    if _registry is None:
        _registry = AgentSandboxRegistry()
    return _registry

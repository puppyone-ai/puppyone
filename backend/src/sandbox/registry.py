"""
SandboxRegistry — Session-level sandbox lifecycle management.

Maps chat_session_id → live sandbox session, enabling:
- Sandbox reuse across messages within a single chat session
- Idle timeout with automatic write-back (4 min)
- Manifest tracking for diff-based write-back
"""

import hashlib
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from loguru import logger


@dataclass
class SandboxManifest:
    """Snapshot of file hashes at mount time."""
    files: dict[str, "ManifestEntry"] = field(default_factory=dict)  # sandbox_path → entry


@dataclass
class ManifestEntry:
    path: str
    node_type: str
    hash: str
    version: int
    json_path: str = ""
    readonly: bool = False
    base_content: Any = None


@dataclass
class LiveSession:
    sandbox_session_id: str
    chat_session_id: str
    agent_id: str
    manifest: SandboxManifest
    created_at: float
    last_active: float
    readonly: bool = False
    project_id: str = ""
    parent_path: str = ""


IDLE_TIMEOUT_SECONDS = 4 * 60  # 4 minutes


class SandboxRegistry:
    """
    In-memory registry of active sandbox sessions.

    Keyed by chat_session_id for O(1) lookup on each message.
    """

    def __init__(self):
        self._sessions: dict[str, LiveSession] = {}  # chat_session_id → LiveSession

    def get(self, chat_session_id: str) -> Optional[LiveSession]:
        return self._sessions.get(chat_session_id)

    def register(
        self,
        chat_session_id: str,
        sandbox_session_id: str,
        agent_id: str,
        manifest: SandboxManifest,
        readonly: bool = False,
        project_id: str = "",
        parent_path: str = "",
    ) -> LiveSession:
        now = time.time()
        session = LiveSession(
            sandbox_session_id=sandbox_session_id,
            chat_session_id=chat_session_id,
            agent_id=agent_id,
            manifest=manifest,
            created_at=now,
            last_active=now,
            readonly=readonly,
            project_id=project_id,
            parent_path=parent_path,
        )
        self._sessions[chat_session_id] = session
        logger.info(
            f"[SandboxRegistry] Registered: chat={chat_session_id} → sandbox={sandbox_session_id}"
        )
        return session

    def touch(self, chat_session_id: str):
        session = self._sessions.get(chat_session_id)
        if session:
            session.last_active = time.time()

    def remove(self, chat_session_id: str) -> Optional[LiveSession]:
        return self._sessions.pop(chat_session_id, None)

    def get_idle_sessions(self) -> list[LiveSession]:
        now = time.time()
        return [
            s for s in self._sessions.values()
            if (now - s.last_active) >= IDLE_TIMEOUT_SECONDS
        ]

    def all_sessions(self) -> list[LiveSession]:
        return list(self._sessions.values())

    @property
    def active_count(self) -> int:
        return len(self._sessions)


def build_manifest(sandbox_files: list, node_path_map: dict) -> SandboxManifest:
    """
    Build a manifest from the files about to be mounted into the sandbox.

    Args:
        sandbox_files: list of SandboxFile objects
        node_path_map: dict of mut_path → {path, node_type, readonly, base_version, ...}
    """
    manifest = SandboxManifest()

    for f in sandbox_files:
        if not f.mut_path:
            continue

        content_hash = ""
        if f.content is not None:
            content_hash = hashlib.sha256(f.content.encode("utf-8")).hexdigest()

        info = node_path_map.get(f.mut_path, {})

        manifest.files[f.path] = ManifestEntry(
            path=f.mut_path,
            node_type=f.node_type or "",
            hash=content_hash,
            version=f.base_version,
            json_path=info.get("json_path", ""),
            readonly=info.get("readonly", False),
            base_content=info.get("base_content"),
        )

    return manifest


async def diff_and_writeback(
    sandbox_service,
    sandbox_session_id: str,
    manifest: SandboxManifest,
    ops,
    operator_info: dict,
):
    """
    Diff sandbox state against manifest, write back only changed files
    via MutOps (clone → push under the hood).

    Args:
        ops: MutOps instance for reading existing content and writing back changes.

    Returns list of updated node info dicts.
    """
    import json

    updated_nodes = []

    hash_result = await sandbox_service.exec(
        sandbox_session_id,
        "find /workspace -type f -exec sha256sum {} \\; 2>/dev/null"
    )

    if not hash_result.get("success"):
        logger.warning("[SandboxRegistry] Failed to get file hashes from sandbox")
        return updated_nodes

    current_hashes: dict[str, str] = {}
    for line in (hash_result.get("output") or "").strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) == 2:
            current_hashes[parts[1]] = parts[0]

    project_id = operator_info.get("project_id", "")
    operator_str = f"{operator_info.get('type', 'agent')}:{operator_info.get('id', 'unknown')}"

    modified_files: dict[str, bytes] = {}

    for sandbox_path, entry in manifest.files.items():
        if entry.readonly:
            continue
        if entry.node_type not in ("json", "markdown"):
            continue

        current_hash = current_hashes.get(sandbox_path, "")
        if current_hash == entry.hash:
            continue

        if not current_hash:
            logger.info(f"[SandboxRegistry] File deleted in sandbox: {sandbox_path}")
            continue

        parse_json = (entry.node_type == "json")
        read_result = await sandbox_service.read_file(
            sandbox_session_id, sandbox_path, parse_json=parse_json
        )

        if not read_result.get("success"):
            logger.warning(f"[SandboxRegistry] Failed to read changed file: {sandbox_path}")
            continue

        sandbox_content = read_result.get("content")

        if entry.node_type == "json" and entry.json_path and ops and project_id:
            from src.connectors.agent.sandbox_data import merge_data_by_path
            try:
                existing_bytes = ops.read_file(project_id, entry.path)
            except Exception:
                existing_bytes = b"{}"
            try:
                existing_json = json.loads(existing_bytes.decode("utf-8"))
            except Exception:
                existing_json = {}
            sandbox_content = merge_data_by_path(
                existing_json or {}, entry.json_path, sandbox_content
            )

        try:
            if isinstance(sandbox_content, (dict, list)):
                content_bytes = json.dumps(sandbox_content, ensure_ascii=False, indent=2).encode("utf-8")
            elif isinstance(sandbox_content, str):
                content_bytes = sandbox_content.encode("utf-8")
            else:
                content_bytes = str(sandbox_content).encode("utf-8")

            modified_files[entry.path] = content_bytes

            node_name = entry.path.rsplit("/", 1)[-1] if "/" in entry.path else entry.path
            updated_nodes.append({
                "nodeId": entry.path,
                "nodeName": node_name,
                "mergeStrategy": "mut_push",
            })
        except Exception as e:
            logger.warning(f"[SandboxRegistry] Prepare write-back failed for {entry.path}: {e}")

    if project_id and operator_info.get("parent_path") is not None:
        parent_path = operator_info["parent_path"]

        for sandbox_path, current_hash in current_hashes.items():
            if not sandbox_path.startswith("/workspace/"):
                continue
            if sandbox_path in manifest.files:
                continue

            relative = sandbox_path.replace("/workspace/", "", 1)
            if any(part.startswith(".") for part in relative.split("/")):
                continue

            try:
                read_result = await sandbox_service.read_file(
                    sandbox_session_id, sandbox_path, parse_json=sandbox_path.endswith(".json")
                )
                if not read_result.get("success"):
                    continue

                content = read_result.get("content")
                file_name = relative.split("/")[-1]

                if sandbox_path.endswith(".json"):
                    node_content = content if isinstance(content, (dict, list)) else {}
                    content_bytes = json.dumps(node_content, ensure_ascii=False, indent=2).encode("utf-8")
                elif sandbox_path.endswith(".md"):
                    content_bytes = (str(content) if content else "").encode("utf-8")
                else:
                    continue

                new_path = f"{parent_path}/{file_name}" if parent_path else file_name
                modified_files[new_path] = content_bytes

                updated_nodes.append({
                    "nodeId": new_path,
                    "nodeName": file_name,
                    "mergeStrategy": "created",
                })
            except Exception as e:
                logger.warning(f"[SandboxRegistry] Failed to prepare new file {sandbox_path}: {e}")

    if modified_files and ops and project_id:
        try:
            result = await ops.bulk_write(
                project_id,
                modified_files,
                who=operator_str,
                message=f"Agent write-back ({len(modified_files)} files)",
            )
            logger.info(
                f"[SandboxRegistry] MUT push: v={result.version} "
                f"merged={result.merged} files={len(modified_files)}"
            )
        except Exception as e:
            logger.error(f"[SandboxRegistry] MUT push failed: {e}")
            updated_nodes = []

    return updated_nodes


# Singleton
_registry: Optional[SandboxRegistry] = None


def get_sandbox_registry() -> SandboxRegistry:
    global _registry
    if _registry is None:
        _registry = SandboxRegistry()
    return _registry

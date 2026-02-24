"""
macOS APFS Clone WorkspaceProvider

使用 APFS 文件系统的 clonefile 能力（cp -c）创建 Agent 工作区：
- 克隆速度：和文件数量成正比，和文件大小无关
- 存储消耗：零（CoW，只有改动的文件占额外空间）
- 权限要求：零

仅限 macOS（APFS 文件系统）。
"""

import asyncio
import hashlib
import json
import os
import shutil
import time
from typing import Optional

from src.workspace.provider import (
    WorkspaceProvider, WorkspaceInfo, WorkspaceChanges,
)
from src.sync.schemas import SyncResult
from src.utils.logger import log_info, log_error, log_debug


class APFSWorkspaceProvider(WorkspaceProvider):
    """macOS APFS Clone 实现"""

    def __init__(self, base_dir: str = "/tmp/contextbase"):
        self._base_dir = base_dir
        self._lower_dir = os.path.join(base_dir, "lower")
        self._workspaces_dir = os.path.join(base_dir, "workspaces")
        self._registry: dict[str, WorkspaceInfo] = {}  # agent_id → WorkspaceInfo

        # 确保基础目录存在
        os.makedirs(self._lower_dir, exist_ok=True)
        os.makedirs(self._workspaces_dir, exist_ok=True)

    def get_lower_path(self, project_id: str) -> str:
        return os.path.join(self._lower_dir, project_id)

    async def create_workspace(
        self, agent_id: str, project_id: str, base_snapshot_id: Optional[int] = None
    ) -> WorkspaceInfo:
        """
        使用 APFS Clone 创建 Agent 工作区
        
        cp -cR lower/{project_id}/ workspaces/{agent_id}/
        每个文件用 clonefile 系统调用，瞬间完成，零额外存储。
        """
        lower_path = self.get_lower_path(project_id)
        workspace_path = os.path.join(self._workspaces_dir, agent_id)

        # 清理旧工作区（如果存在）
        if os.path.exists(workspace_path):
            shutil.rmtree(workspace_path)

        if not os.path.exists(lower_path):
            # Lower 目录不存在，创建空工作区
            os.makedirs(workspace_path, exist_ok=True)
            log_info(f"[APFS] Created empty workspace for {agent_id} (lower not synced yet)")
        else:
            # APFS Clone：cp -cR（每个文件使用 clonefile，零拷贝）
            start = time.time()
            proc = await asyncio.create_subprocess_exec(
                "cp", "-cR", f"{lower_path}/", workspace_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()

            if proc.returncode != 0:
                # APFS clone 失败（可能不在 APFS 卷上），fallback 到普通复制
                error_msg = stderr.decode().strip()
                log_info(f"[APFS] Clone failed ({error_msg}), falling back to regular copy")
                shutil.copytree(lower_path, workspace_path, dirs_exist_ok=True)

            elapsed = time.time() - start
            file_count = sum(len(files) for _, _, files in os.walk(workspace_path))
            log_info(f"[APFS] Created workspace for {agent_id}: {file_count} files, {elapsed:.3f}s")

        info = WorkspaceInfo(
            path=workspace_path,
            agent_id=agent_id,
            project_id=project_id,
            base_snapshot_id=base_snapshot_id,
            lower_path=lower_path,
        )
        self._registry[agent_id] = info
        return info

    async def detect_changes(self, agent_id: str) -> WorkspaceChanges:
        """
        检测 Agent 改了什么
        
        对比 workspace 和 lower 中每个文件的 hash：
        - hash 不同 → modified
        - workspace 有但 lower 没有 → modified（新建）
        - lower 有但 workspace 没有 → deleted
        """
        info = self._registry.get(agent_id)
        if not info:
            return WorkspaceChanges(agent_id=agent_id)

        lower_path = info.lower_path
        workspace_path = info.path
        modified = {}
        deleted = []

        # 扫描 workspace 中的所有文件
        if os.path.exists(workspace_path):
            for root, _, files in os.walk(workspace_path):
                for fname in files:
                    if fname.startswith("."):  # 跳过隐藏文件（.metadata.json 等）
                        continue

                    ws_file = os.path.join(root, fname)
                    rel_path = os.path.relpath(ws_file, workspace_path)
                    lower_file = os.path.join(lower_path, rel_path)

                    ws_hash = _file_hash(ws_file)

                    if not os.path.exists(lower_file):
                        # workspace 有但 lower 没有 → 新建的文件
                        modified[rel_path] = _read_file(ws_file)
                    else:
                        lower_hash = _file_hash(lower_file)
                        if ws_hash != lower_hash:
                            # hash 不同 → 修改的文件
                            modified[rel_path] = _read_file(ws_file)

        # 检查 lower 中有但 workspace 中没有的文件 → 删除
        if os.path.exists(lower_path):
            for root, _, files in os.walk(lower_path):
                for fname in files:
                    if fname.startswith("."):
                        continue

                    lower_file = os.path.join(root, fname)
                    rel_path = os.path.relpath(lower_file, lower_path)
                    ws_file = os.path.join(workspace_path, rel_path)

                    if not os.path.exists(ws_file):
                        deleted.append(rel_path)

        log_info(f"[APFS] Changes for {agent_id}: {len(modified)} modified, {len(deleted)} deleted")

        return WorkspaceChanges(
            agent_id=agent_id,
            base_snapshot_id=info.base_snapshot_id,
            modified=modified,
            deleted=deleted,
        )

    async def cleanup(self, agent_id: str) -> None:
        """清理 Agent 的工作区"""
        info = self._registry.pop(agent_id, None)
        if info and os.path.exists(info.path):
            shutil.rmtree(info.path, ignore_errors=True)
            log_debug(f"[APFS] Cleaned up workspace for {agent_id}")

    async def sync_lower(self, project_id: str) -> SyncResult:
        """
        同步 S3+PG 数据到 Lower 目录
        
        注意：这个方法需要外部注入 node_repo 和 s3_service。
        在实际使用中，SyncWorker 会调用这个方法。
        这里只负责目录管理，具体同步逻辑在 sync_worker.py 中。
        """
        lower_path = self.get_lower_path(project_id)
        os.makedirs(lower_path, exist_ok=True)
        # 实际同步逻辑由 SyncWorker 执行
        return SyncResult()


def _file_hash(path: str) -> str:
    """计算文件的 SHA-256 hash"""
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
    except (OSError, IOError):
        return ""
    return h.hexdigest()


def _read_file(path: str) -> str:
    """读取文件内容为字符串"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        # 二进制文件，返回空（二进制文件的 diff 需要单独处理）
        return ""
    except (OSError, IOError):
        return ""

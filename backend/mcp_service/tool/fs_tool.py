"""
POSIX 风格文件系统工具实现
无状态设计 — 每次调用完全自包含，通过全路径寻址。

工具清单:
  ls    — 列出目录内容
  cat   — 读取文件内容
  write — 写入/创建文件
  mkdir — 创建文件夹
  rm    — 移入废纸篓（软删除）
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..rpc.client import InternalApiClient


class FsToolImplementation:
    """无状态 POSIX 风格文件系统工具"""

    def __init__(self, rpc_client: InternalApiClient):
        self.rpc = rpc_client

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _build_root_accesses(self, accesses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """从 Agent config 的 accesses 中提取路径解析所需的 root_accesses 结构（保留权限字段）"""
        return [
            {
                "node_id": a.get("node_id", ""),
                "node_name": a.get("node_name", ""),
                "node_type": a.get("node_type", ""),
                "bash_readonly": a.get("bash_readonly", True),
            }
            for a in accesses
        ]

    def _is_single_root(self, accesses: List[Dict[str, Any]]) -> bool:
        """判断是否为单根模式（仅一个 folder access）"""
        return (
            len(accesses) == 1
            and accesses[0].get("node_type") == "folder"
        )

    def _format_entry(
        self,
        child: Dict[str, Any],
        parent_path: str,
    ) -> Dict[str, Any]:
        """格式化单个条目，附带完整路径"""
        name = child.get("name", "")
        child_type = child.get("type", "")
        # folder 名称后缀加 /
        display_name = f"{name}/" if child_type == "folder" else name
        child_path = f"{parent_path.rstrip('/')}/{name}" if parent_path != "/" else f"/{name}"

        entry: Dict[str, Any] = {
            "name": display_name,
            "path": child_path,
            "type": child_type,
        }
        if child_type == "folder":
            pass  # 文件夹不需要 size_bytes
        else:
            entry["size_bytes"] = child.get("size_bytes", 0)
        if child.get("updated_at"):
            entry["updated_at"] = child["updated_at"]
        return entry

    # ------------------------------------------------------------------
    # ls — 列出目录内容
    # ------------------------------------------------------------------

    async def ls(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str = "/",
    ) -> Dict[str, Any]:
        """
        列出目录内容，返回带完整 path 的条目列表。
        不传 path 或传 "/" 默认列出根目录。
        """
        root_accesses = self._build_root_accesses(accesses)
        path = (path or "/").strip() or "/"

        # 解析路径
        resolved = await self.rpc.resolve_path(project_id, root_accesses, path)

        if resolved.get("virtual_root"):
            # 多根模式的虚拟根 — 直接把 accesses 作为条目返回
            entries = []
            for a in accesses:
                name = a.get("node_name", "")
                node_type = a.get("node_type", "")
                display_name = f"{name}/" if node_type == "folder" else name
                entries.append({
                    "name": display_name,
                    "path": f"/{name}",
                    "type": node_type,
                })
            return {"path": "/", "entries": entries}

        node_id = resolved["node_id"]
        node_type = resolved.get("type", "")
        display_path = resolved.get("path", path)

        if node_type != "folder":
            return {"error": f"Not a directory: {display_path}"}

        result = await self.rpc.list_children(node_id, project_id)
        children = result.get("children", [])

        entries = [
            self._format_entry(child, display_path)
            for child in children
        ]

        return {"path": display_path, "entries": entries}

    # ------------------------------------------------------------------
    # cat — 读取文件内容
    # ------------------------------------------------------------------

    async def cat(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
    ) -> Dict[str, Any]:
        """读取文件内容。如果是文件夹则等同 ls。"""
        root_accesses = self._build_root_accesses(accesses)
        resolved = await self.rpc.resolve_path(project_id, root_accesses, path)

        if resolved.get("virtual_root"):
            return await self.ls(project_id, accesses, "/")

        node_id = resolved["node_id"]
        node_type = resolved.get("type", "")
        display_path = resolved.get("path", path)

        if node_type == "folder":
            # 文件夹 — 列出内容
            return await self.ls(project_id, accesses, path)

        content_data = await self.rpc.read_node_content(node_id, project_id)
        content_data["path"] = display_path
        return content_data

    # ------------------------------------------------------------------
    # write — 写入/创建文件
    # ------------------------------------------------------------------

    async def write(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
        content: Any,
    ) -> Dict[str, Any]:
        """
        写入/创建文件。
        - 文件已存在: 更新内容
        - 文件不存在: 创建新文件（按扩展名推断类型）
        """
        root_accesses = self._build_root_accesses(accesses)

        # 尝试解析路径 — 如果存在则更新
        try:
            resolved = await self.rpc.resolve_path(project_id, root_accesses, path)
            if not resolved.get("virtual_root"):
                node_id = resolved["node_id"]
                display_path = resolved.get("path", path)
                result = await self.rpc.write_node_content(node_id, project_id, content)
                result["path"] = display_path
                return result
        except RuntimeError:
            pass  # 路径不存在，继续创建

        # 文件不存在 — 解析父路径并创建
        path_clean = path.strip().rstrip("/")
        segments = [s for s in path_clean.strip("/").split("/") if s]
        if not segments:
            return {"error": "Path cannot be empty"}

        file_name = segments[-1]
        parent_segments = segments[:-1]

        # 解析父目录
        if parent_segments:
            parent_path = "/" + "/".join(parent_segments)
            try:
                parent_resolved = await self.rpc.resolve_path(
                    project_id, root_accesses, parent_path
                )
                if parent_resolved.get("virtual_root"):
                    return {"error": "Cannot create files at virtual root in multi-root mode"}
                parent_id = parent_resolved["node_id"]
            except RuntimeError as e:
                return {"error": f"Parent directory not found: {str(e)[:200]}"}
        else:
            # 根目录下创建
            if self._is_single_root(accesses):
                parent_id = accesses[0]["node_id"]
            else:
                return {"error": "Cannot create files at virtual root in multi-root mode"}

        # 推断类型
        node_type = self._infer_type(file_name, content)
        if node_type is None:
            return {"error": f"Cannot infer file type for: {file_name}. Use .md or .json extension."}

        result = await self.rpc.create_node(
            project_id=project_id,
            parent_id=parent_id,
            name=file_name,
            node_type=node_type,
            content=content,
        )
        # 构建显示路径
        result["path"] = path
        return result

    @staticmethod
    def _infer_type(name: str, content: Any) -> Optional[str]:
        """从文件名和内容推断节点类型"""
        lower = name.lower()
        if lower.endswith(".md") or lower.endswith(".markdown"):
            return "markdown"
        if lower.endswith(".json"):
            return "json"
        # 如果 content 是 dict 或 list，认为是 JSON
        if isinstance(content, (dict, list)):
            return "json"
        # 如果 content 是字符串，默认 markdown
        if isinstance(content, str):
            return "markdown"
        return None

    # ------------------------------------------------------------------
    # mkdir — 创建文件夹
    # ------------------------------------------------------------------

    async def mkdir(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
    ) -> Dict[str, Any]:
        """创建文件夹"""
        root_accesses = self._build_root_accesses(accesses)

        path_clean = path.strip().rstrip("/")
        segments = [s for s in path_clean.strip("/").split("/") if s]
        if not segments:
            return {"error": "Path cannot be empty"}

        folder_name = segments[-1]
        parent_segments = segments[:-1]

        if parent_segments:
            parent_path = "/" + "/".join(parent_segments)
            try:
                parent_resolved = await self.rpc.resolve_path(
                    project_id, root_accesses, parent_path
                )
                if parent_resolved.get("virtual_root"):
                    return {"error": "Cannot create folders at virtual root in multi-root mode"}
                parent_id = parent_resolved["node_id"]
            except RuntimeError as e:
                return {"error": f"Parent directory not found: {str(e)[:200]}"}
        else:
            if self._is_single_root(accesses):
                parent_id = accesses[0]["node_id"]
            else:
                return {"error": "Cannot create folders at virtual root in multi-root mode"}

        result = await self.rpc.create_node(
            project_id=project_id,
            parent_id=parent_id,
            name=folder_name,
            node_type="folder",
        )
        result["path"] = path
        return result

    # ------------------------------------------------------------------
    # rm — 移入废纸篓
    # ------------------------------------------------------------------

    async def rm(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
        user_id: str = "system",
    ) -> Dict[str, Any]:
        """软删除：将节点移入 .trash 文件夹"""
        root_accesses = self._build_root_accesses(accesses)

        try:
            resolved = await self.rpc.resolve_path(project_id, root_accesses, path)
        except RuntimeError as e:
            return {"error": f"No such file or directory: {str(e)[:200]}"}

        if resolved.get("virtual_root"):
            return {"error": "Cannot remove the root directory"}

        node_id = resolved["node_id"]
        display_path = resolved.get("path", path)

        result = await self.rpc.trash_node(node_id, project_id, user_id)
        result["path"] = display_path
        return result

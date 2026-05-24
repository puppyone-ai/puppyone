"""
POSIX-style file system tool implementation (Version Engine backed).
Stateless — all operations addressed by path, resolved server-side.

Tools:
  ls    — list directory
  cat   — read file content
  write — write/create file
  mkdir — create directory
  rm    — remove file or directory
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..rpc.client import InternalApiClient


class FsToolImplementation:
    """Stateless POSIX-style file system tools backed by Tree API."""

    def __init__(self, rpc_client: InternalApiClient):
        self.rpc = rpc_client

    # ------------------------------------------------------------------
    # ls
    # ------------------------------------------------------------------

    async def ls(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str = "/",
        acting_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        path = (path or "/").strip() or "/"
        normalized = path.lstrip("/")

        scope = self._extract_scope(accesses)
        if scope and normalized and not self._path_in_scope(normalized, scope):
            return {"error": f"Access denied: {path}"}

        result = await self.rpc.list_dir(project_id, normalized, acting_user_id=acting_user_id)
        entries = result.get("entries", [])

        if scope:
            entries = [e for e in entries if self._entry_in_scope(e, scope)]

        return {"path": path, "entries": entries}

    # ------------------------------------------------------------------
    # cat
    # ------------------------------------------------------------------

    async def cat(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
        acting_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized = path.strip().lstrip("/")
        if not normalized:
            return await self.ls(project_id, accesses, "/", acting_user_id=acting_user_id)

        scope = self._extract_scope(accesses)
        if scope and not self._path_in_scope(normalized, scope):
            return {"error": f"Access denied: {path}"}

        result = await self.rpc.read_file(project_id, normalized, acting_user_id=acting_user_id)
        result["path"] = path
        return result

    # ------------------------------------------------------------------
    # write
    # ------------------------------------------------------------------

    async def write(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
        content: Any,
        acting_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized = path.strip().lstrip("/")
        if not normalized:
            return {"error": "Path cannot be empty"}

        scope = self._extract_scope(accesses)
        if scope and not self._path_in_scope(normalized, scope):
            return {"error": f"Access denied: {path}"}
        if scope and self._is_readonly(accesses):
            return {"error": f"Read-only access: {path}"}

        file_type = self._infer_type(normalized, content)
        content_str = content if isinstance(content, str) else (
            __import__("json").dumps(content, ensure_ascii=False, indent=2)
        )

        result = await self.rpc.write_file(
            project_id=project_id,
            path=normalized,
            content=content_str,
            file_type=file_type,
            acting_user_id=acting_user_id,
        )
        result["path"] = path
        return result

    # ------------------------------------------------------------------
    # mkdir
    # ------------------------------------------------------------------

    async def mkdir(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
        acting_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized = path.strip().lstrip("/").rstrip("/")
        if not normalized:
            return {"error": "Path cannot be empty"}

        scope = self._extract_scope(accesses)
        if scope and not self._path_in_scope(normalized, scope):
            return {"error": f"Access denied: {path}"}
        if scope and self._is_readonly(accesses):
            return {"error": f"Read-only access: {path}"}

        result = await self.rpc.mkdir(project_id, normalized, acting_user_id=acting_user_id)
        result["path"] = path
        return result

    # ------------------------------------------------------------------
    # rm
    # ------------------------------------------------------------------

    async def rm(
        self,
        project_id: str,
        accesses: List[Dict[str, Any]],
        path: str,
        user_id: str = "system",
        acting_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized = path.strip().lstrip("/")
        if not normalized:
            return {"error": "Cannot remove the root directory"}

        scope = self._extract_scope(accesses)
        if scope and not self._path_in_scope(normalized, scope):
            return {"error": f"Access denied: {path}"}
        if scope and self._is_readonly(accesses):
            return {"error": f"Read-only access: {path}"}

        result = await self.rpc.delete(project_id, normalized, acting_user_id=acting_user_id)
        result["path"] = path
        return result

    # ------------------------------------------------------------------
    # Scope helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_scope(accesses: List[Dict[str, Any]]) -> Optional[List[str]]:
        """Extract allowed path prefixes from scope config."""
        if not accesses:
            return None
        paths = []
        for a in accesses:
            scope = a.get("scope", {}) if isinstance(a, dict) else {}
            prefix = scope.get("path_prefix", "")
            if prefix:
                paths.append(prefix.strip("/"))
            elif a.get("path"):
                paths.append(a["path"])
        return paths if paths else None

    @staticmethod
    def _path_in_scope(path: str, scope_prefixes: List[str]) -> bool:
        if not scope_prefixes:
            return True
        for prefix in scope_prefixes:
            if path == prefix or path.startswith(prefix + "/"):
                return True
        return False

    @staticmethod
    def _entry_in_scope(entry: Dict[str, Any], scope_prefixes: List[str]) -> bool:
        entry_path = entry.get("path", "").lstrip("/")
        if not entry_path:
            return True
        for prefix in scope_prefixes:
            if entry_path == prefix or entry_path.startswith(prefix + "/") or prefix.startswith(entry_path + "/"):
                return True
        return False

    @staticmethod
    def _is_readonly(accesses: List[Dict[str, Any]]) -> bool:
        for a in accesses:
            scope = a.get("scope", {}) if isinstance(a, dict) else {}
            if scope.get("mode") == "rw" or not scope.get("readonly", True):
                return False
        return True

    @staticmethod
    def _infer_type(name: str, content: Any) -> Optional[str]:
        lower = name.lower()
        if lower.endswith(".md") or lower.endswith(".markdown"):
            return "markdown"
        if lower.endswith(".json"):
            return "json"
        if isinstance(content, (dict, list)):
            return "json"
        if isinstance(content, str):
            return "markdown"
        return None

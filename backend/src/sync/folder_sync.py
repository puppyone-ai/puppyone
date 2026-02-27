"""
Folder-level file sync service.

Implements the "Daemon Stateless Mirror" architecture:
- All operations use filename as identity (no node_id exposed)
- Backend resolves filename → node_id internally via (project_id, parent_id, name) lookup
- Push auto-detects create vs update
"""

import os
import uuid as _uuid
import json as _json
from typing import Optional, Any
from datetime import datetime

from src.content_node.repository import ContentNodeRepository
from src.sync.repository import SyncRepository
from src.sync.changelog import SyncChangelogRepository
from src.collaboration.service import CollaborationService
from src.collaboration.version_service import VersionService
from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
from src.collaboration.lock_service import LockService
from src.collaboration.conflict_service import ConflictService
from src.collaboration.audit_service import AuditService
from src.collaboration.audit_repository import AuditRepository
from src.s3.service import get_s3_service_instance
from src.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error

INLINE_TYPES = {"json", "markdown"}


class FolderSyncService:
    """
    Folder-level sync service — the core of the Daemon Stateless Mirror architecture.

    All public methods accept (project_id, folder_id, filename) — never node_id.
    The daemon only sees filenames; all ID resolution happens here.
    """

    def __init__(self, supabase: SupabaseClient):
        self._supabase = supabase
        self._node_repo = ContentNodeRepository(supabase)
        self._sync_repo = SyncRepository(supabase)
        self._changelog = SyncChangelogRepository(supabase)
        self._s3 = get_s3_service_instance()

    def _build_version_service(self) -> VersionService:
        return VersionService(
            node_repo=self._node_repo,
            version_repo=FileVersionRepository(self._supabase),
            snapshot_repo=FolderSnapshotRepository(self._supabase),
            s3_service=self._s3,
            changelog_repo=self._changelog,
        )

    def _build_collab_service(self) -> CollaborationService:
        return CollaborationService(
            node_repo=self._node_repo,
            lock_service=LockService(self._node_repo),
            conflict_service=ConflictService(),
            version_service=self._build_version_service(),
            audit_service=AuditService(
                audit_repo=AuditRepository(self._supabase),
            ),
        )

    # ----------------------------------------------------------
    # Pull
    # ----------------------------------------------------------

    def pull(
        self,
        project_id: str,
        folder_id: str,
        cursor: int = 0,
        source_id: Optional[int] = None,
    ) -> dict:
        if cursor == 0:
            return self._pull_full(project_id, folder_id)
        return self._pull_incremental(project_id, folder_id, cursor, source_id)

    def _pull_full(self, project_id: str, folder_id: str) -> dict:
        result_files = self._list_all_files_recursive(project_id, folder_id)
        new_cursor = self._changelog.get_latest_cursor(project_id)

        return {
            "files": result_files,
            "cursor": new_cursor,
            "is_full_sync": True,
            "has_more": False,
        }

    def _pull_incremental(
        self,
        project_id: str,
        folder_id: str,
        cursor: int,
        source_id: Optional[int],
    ) -> dict:
        min_available = self._changelog.min_cursor()
        latest = self._changelog.get_latest_cursor(project_id)

        if min_available > 0 and cursor < min_available:
            return self._pull_full(project_id, folder_id)
        if latest > 0 and cursor > latest:
            return self._pull_full(project_id, folder_id)

        limit = 500
        entries = self._changelog.list_since(project_id, cursor, limit)

        if not entries:
            return {
                "files": [],
                "cursor": max(cursor, latest),
                "is_full_sync": False,
                "has_more": False,
            }

        descendant_ids = self._get_all_descendant_ids(project_id, folder_id)

        update_ids = list(dict.fromkeys(
            e.node_id for e in entries
            if e.action != "delete" and e.node_id in descendant_ids
        ))

        delete_entries = [
            e for e in entries if e.action == "delete"
        ]

        nodes_data = self._node_repo.get_by_ids(update_ids)
        nodes_map = {n.id: n for n in nodes_data}

        result_files = []
        seen_updates = set()
        for nid in update_ids:
            if nid in seen_updates:
                continue
            seen_updates.add(nid)
            node = nodes_map.get(nid)
            if not node or node.type == "folder":
                continue
            entry = self._serialize_file(node)
            entry["name"] = self._build_relative_path(node, folder_id)
            entry["action"] = "update"
            result_files.append(entry)

        seen_deletes = set()
        for e in delete_entries:
            if e.node_id in seen_deletes:
                continue
            seen_deletes.add(e.node_id)
            node = self._node_repo.get_by_id(e.node_id)
            if node:
                filename = self._build_relative_path(node, folder_id)
            else:
                filename = e.filename or e.hash
            if filename:
                result_files.append({"name": filename, "action": "delete"})

        new_cursor = entries[-1].id
        has_more = len(entries) >= limit

        return {
            "files": result_files,
            "cursor": new_cursor,
            "is_full_sync": False,
            "has_more": has_more,
        }

    def _resolve_deleted_filename(
        self, node_id: str, source_id: Optional[int] = None,
    ) -> Optional[str]:
        """Best-effort filename resolution for a deleted node."""
        node = self._node_repo.get_by_id(node_id)
        if node:
            return self._node_to_filename(node)
        return None

    # ----------------------------------------------------------
    # Push (auto-detects create vs update)
    # ----------------------------------------------------------

    def push(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        content: Any,
        base_version: int,
        node_type: str,
        operator_id: str,
        operator_name: str,
        source_id: Optional[int] = None,
    ) -> dict:
        invalid_path = self._validate_filename_or_error(
            filename=filename,
            operation="push",
            operator_id=operator_id,
            source_id=source_id,
        )
        if invalid_path:
            return invalid_path

        parent_id, leaf = self._resolve_parent(project_id, folder_id, filename)
        name = self._leaf_to_node_name(leaf, node_type)
        existing = self._node_repo.get_child_by_name(project_id, parent_id, name)

        if existing:
            return self._do_update(
                existing, content, base_version, node_type,
                operator_id, operator_name, source_id, filename,
            )
        return self._do_create(
            project_id, parent_id, name, filename, content,
            node_type, operator_id, operator_name, source_id,
        )

    def _do_create(
        self,
        project_id: str,
        folder_id: str,
        name: str,
        filename: str,
        content: Any,
        node_type: str,
        operator_id: str,
        operator_name: str,
        source_id: Optional[int],
    ) -> dict:
        new_id = str(_uuid.uuid4())
        created_by = self._get_project_owner(project_id)

        try:
            if node_type == "json":
                json_content = content if isinstance(content, (dict, list)) else {}
                size_bytes = len(
                    _json.dumps(json_content, ensure_ascii=False).encode("utf-8")
                )
                node = self._node_repo.create(
                    project_id=project_id,
                    name=name,
                    node_type="json",
                    id_path=f"{project_id}/{new_id}",
                    parent_id=folder_id,
                    created_by=created_by,
                    preview_json=json_content,
                    mime_type="application/json",
                    size_bytes=size_bytes,
                )
            else:
                content_str = content if isinstance(content, str) else str(content or "")
                size_bytes = len(content_str.encode("utf-8"))
                node = self._node_repo.create(
                    project_id=project_id,
                    name=name,
                    node_type="markdown",
                    id_path=f"{project_id}/{new_id}",
                    parent_id=folder_id,
                    created_by=created_by,
                    preview_md=content_str,
                    mime_type="text/markdown",
                    size_bytes=size_bytes,
                )

            version_svc = self._build_version_service()
            if node_type == "json":
                version_svc.create_version(
                    node_id=node.id,
                    operator_type="agent",
                    operation="create",
                    content_json=content if isinstance(content, (dict, list)) else {},
                    operator_id=operator_id,
                    summary=f"CLI create from '{operator_name}'",
                )
            else:
                version_svc.create_version(
                    node_id=node.id,
                    operator_type="agent",
                    operation="create",
                    content_text=content if isinstance(content, str) else str(content or ""),
                    operator_id=operator_id,
                    summary=f"CLI create from '{operator_name}'",
                )

            version = getattr(node, "current_version", 1) or 1
            log_info(f"[FolderSync] CREATE {filename} in folder {folder_id}")
            return {"ok": True, "version": version, "status": "created"}

        except Exception as e:
            log_error(f"[FolderSync] CREATE failed for {filename}: {e}")
            return {"ok": False, "error": "create_failed", "message": str(e)}

    def _do_update(
        self,
        node,
        content: Any,
        base_version: int,
        node_type: str,
        operator_id: str,
        operator_name: str,
        source_id: Optional[int],
        filename: str,
    ) -> dict:
        collab_svc = self._build_collab_service()

        try:
            result = collab_svc.commit(
                node_id=node.id,
                new_content=content,
                base_version=base_version,
                node_type=node_type,
                operator_type="agent",
                operator_id=operator_id,
                summary=f"CLI push from '{operator_name}'",
            )

            log_info(f"[FolderSync] UPDATE {filename} → v{result.version}")
            return {"ok": True, "version": result.version, "status": result.status}

        except Exception as e:
            log_error(f"[FolderSync] UPDATE failed for {filename}: {e}")
            return {"ok": False, "error": "commit_failed", "message": str(e)}

    # ----------------------------------------------------------
    # Delete
    # ----------------------------------------------------------

    def delete_file(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        source_id: Optional[int] = None,
    ) -> dict:
        invalid_path = self._validate_filename_or_error(
            filename=filename,
            operation="delete_file",
            source_id=source_id,
        )
        if invalid_path:
            return invalid_path

        node = self._find_node_by_path(project_id, folder_id, filename)
        if not node:
            return {"ok": True, "status": "not_found"}

        try:
            version_svc = self._build_version_service()
            version_svc.create_version(
                node_id=node.id,
                operator_type="agent",
                operation="delete",
                operator_id="system",
                summary=f"CLI delete: {filename}",
            )

            self._node_repo.delete(node.id)

            log_info(f"[FolderSync] DELETE {filename} from folder {folder_id}")
            return {"ok": True, "status": "deleted"}

        except Exception as e:
            log_error(f"[FolderSync] DELETE failed for {filename}: {e}")
            return {"ok": False, "error": "delete_failed", "message": str(e)}

    # ----------------------------------------------------------
    # File upload (presigned URL flow for non-JSON/MD)
    # ----------------------------------------------------------

    def request_upload_url(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        content_type: str,
        size_bytes: int,
        operator_id: str,
        source_id: Optional[int] = None,
    ) -> dict:
        invalid_path = self._validate_filename_or_error(
            filename=filename,
            operation="request_upload_url",
            operator_id=operator_id,
            source_id=source_id,
        )
        if invalid_path:
            return invalid_path

        parent_id, leaf = self._resolve_parent(project_id, folder_id, filename)
        name = self._leaf_to_node_name(leaf, "file")
        existing = self._node_repo.get_child_by_name(project_id, parent_id, name)

        if existing:
            node_id = existing.id
            s3_key = existing.s3_key or self._make_s3_key(project_id, node_id, filename)
        else:
            node_id = str(_uuid.uuid4())
            s3_key = self._make_s3_key(project_id, node_id, filename)
            created_by = self._get_project_owner(project_id)

            node = self._node_repo.create(
                project_id=project_id,
                name=name,
                node_type="file",
                id_path=f"{project_id}/{node_id}",
                parent_id=parent_id,
                created_by=created_by,
                s3_key=s3_key,
                mime_type=content_type,
                size_bytes=size_bytes,
            )
            node_id = node.id

        try:
            params = {"Bucket": self._s3.bucket_name, "Key": s3_key}
            if content_type:
                params["ContentType"] = content_type
            upload_url = self._s3.client.generate_presigned_url(
                ClientMethod="put_object",
                Params=params,
                ExpiresIn=3600,
            )
        except Exception as e:
            log_error(f"[FolderSync] Upload URL failed: {e}")
            return {"ok": False, "error": "s3_error", "message": str(e)}

        return {"ok": True, "filename": filename, "upload_url": upload_url}

    def confirm_upload(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        size_bytes: int,
        operator_id: str,
        operator_name: str,
        content_hash: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> dict:
        invalid_path = self._validate_filename_or_error(
            filename=filename,
            operation="confirm_upload",
            operator_id=operator_id,
            source_id=source_id,
        )
        if invalid_path:
            return invalid_path

        node = self._find_node_by_path(project_id, folder_id, filename)
        if not node:
            return {
                "ok": False, "error": "not_found",
                "message": f"File '{filename}' not found in folder",
            }

        self._node_repo.update(node_id=node.id, size_bytes=size_bytes)

        version_svc = self._build_version_service()
        is_new = (node.current_version or 0) == 0
        try:
            version = version_svc.create_version(
                node_id=node.id,
                operator_type="agent",
                operation="create" if is_new else "update",
                s3_key=node.s3_key,
                operator_id=operator_id,
                summary=f"CLI upload from '{operator_name}'",
            )
            new_version = version.version if version else 1

            log_info(
                f"[FolderSync] CONFIRM {filename} v{new_version} ({size_bytes} bytes)"
            )
            return {"ok": True, "version": new_version, "status": "uploaded"}

        except Exception as e:
            log_error(f"[FolderSync] CONFIRM failed for {filename}: {e}")
            return {"ok": False, "error": "confirm_failed", "message": str(e)}

    # ----------------------------------------------------------
    # Helpers
    # ----------------------------------------------------------

    def _serialize_file(self, node) -> dict:
        entry = {
            "name": self._node_to_filename(node),
            "type": node.type,
            "version": node.current_version or 0,
        }
        if node.type in INLINE_TYPES:
            entry["content"] = (
                node.preview_json if node.type == "json" else node.preview_md
            )
        else:
            entry["s3_key"] = node.s3_key
            entry["mime_type"] = node.mime_type
            entry["size_bytes"] = node.size_bytes or 0
            if node.s3_key:
                try:
                    url = self._s3.client.generate_presigned_url(
                        ClientMethod="get_object",
                        Params={
                            "Bucket": self._s3.bucket_name,
                            "Key": node.s3_key,
                        },
                        ExpiresIn=3600,
                    )
                    entry["download_url"] = url
                except Exception:
                    entry["download_url"] = None
        return entry

    @staticmethod
    def _node_to_filename(node) -> str:
        name = node.name
        if node.type == "json":
            return name if name.endswith(".json") else f"{name}.json"
        if node.type == "markdown":
            return name if name.endswith(".md") else f"{name}.md"
        return name

    @staticmethod
    def _strip_extension(filename: str) -> str:
        return os.path.splitext(filename)[0] if "." in filename else filename

    @staticmethod
    def _leaf_to_node_name(leaf: str, node_type: str) -> str:
        if node_type in INLINE_TYPES:
            return FolderSyncService._strip_extension(leaf)
        return leaf

    @staticmethod
    def _make_s3_key(project_id: str, node_id: str, filename: str) -> str:
        safe_name = filename.replace("/", "_").replace("\\", "_")
        return f"projects/{project_id}/openclaw/{node_id}/{safe_name}"

    def _get_project_owner(self, project_id: str) -> Optional[str]:
        from src.project.repository import ProjectRepositorySupabase
        try:
            repo = ProjectRepositorySupabase()
            project = repo.get_by_id(project_id)
            return project.user_id if project else None
        except Exception:
            return None

    # ----------------------------------------------------------
    # Path-based helpers (nested folder support)
    # ----------------------------------------------------------

    def _parse_path(self, filename: str) -> tuple[list[str], str]:
        """Split 'a/b/c.md' into (['a','b'], 'c.md')."""
        parts = filename.replace("\\", "/").split("/")
        for segment in parts:
            if segment in ("", ".", "..") or "\x00" in segment:
                raise ValueError(f"Invalid filename path segment: {segment!r}")
        return parts[:-1], parts[-1]

    def _validate_filename_or_error(
        self,
        filename: str,
        operation: str,
        source_id: Optional[int] = None,
        operator_id: Optional[str] = None,
    ) -> Optional[dict]:
        try:
            self._parse_path(filename)
            return None
        except ValueError as e:
            self._audit_invalid_path(
                operation=operation,
                filename=filename,
                source_id=source_id,
                operator_id=operator_id,
                reason=str(e),
            )
            return {"ok": False, "error": "invalid_path", "message": str(e)}

    @staticmethod
    def _audit_invalid_path(
        operation: str,
        filename: str,
        source_id: Optional[int],
        operator_id: Optional[str],
        reason: str,
    ) -> None:
        log_error(
            "[FolderSync][SECURITY] Reject invalid path "
            f"(op={operation}, source_id={source_id}, operator_id={operator_id}): "
            f"{filename!r} ({reason})"
        )

    def _ensure_folder_path(
        self, project_id: str, root_folder_id: str, dir_segments: list[str],
    ) -> str:
        """Walk/create intermediate folders. Returns deepest folder ID."""
        current_parent = root_folder_id
        for segment in dir_segments:
            existing = self._node_repo.get_child_by_name(
                project_id, current_parent, segment,
            )
            if existing and existing.type == "folder":
                current_parent = existing.id
            else:
                new_id = str(_uuid.uuid4())
                created_by = self._get_project_owner(project_id)
                folder = self._node_repo.create(
                    project_id=project_id,
                    name=segment,
                    node_type="folder",
                    id_path=f"{project_id}/{new_id}",
                    parent_id=current_parent,
                    created_by=created_by,
                )
                current_parent = folder.id
                log_info(f"[FolderSync] Auto-created folder '{segment}' ({folder.id})")
        return current_parent

    def _resolve_parent(self, project_id: str, folder_id: str, filename: str) -> tuple[str, str]:
        """Resolve filename with path to (parent_id, leaf_filename)."""
        dirs, leaf = self._parse_path(filename)
        if dirs:
            parent_id = self._ensure_folder_path(project_id, folder_id, dirs)
        else:
            parent_id = folder_id
        return parent_id, leaf

    def _find_node_by_path(self, project_id: str, root_folder_id: str, rel_path: str):
        """Find a node by relative path from sync root. Returns node or None."""
        dirs, leaf = self._parse_path(rel_path)
        current_parent = root_folder_id
        for seg in dirs:
            folder = self._node_repo.get_child_by_name(project_id, current_parent, seg)
            if not folder or folder.type != "folder":
                return None
            current_parent = folder.id
        exact = self._node_repo.get_child_by_name(project_id, current_parent, leaf)
        if exact:
            return exact

        legacy_name = self._strip_extension(leaf)
        if legacy_name == leaf:
            return None

        legacy = self._node_repo.get_child_by_name(
            project_id, current_parent, legacy_name,
        )
        if not legacy or legacy.type not in INLINE_TYPES:
            return None

        _, ext = os.path.splitext(leaf.lower())
        if ext == ".json" and legacy.type != "json":
            return None
        if ext == ".md" and legacy.type != "markdown":
            return None
        return legacy
        return None

    def _list_all_files_recursive(
        self, project_id: str, folder_id: str, prefix: str = "",
    ) -> list[dict]:
        """Recursively list all files under folder tree with relative paths."""
        result: list[dict] = []
        children = self._node_repo.list_children(
            project_id=project_id, parent_id=folder_id,
        )
        for node in children:
            if node.type == "folder":
                sub_prefix = f"{prefix}{node.name}/"
                result.extend(
                    self._list_all_files_recursive(project_id, node.id, sub_prefix)
                )
            else:
                entry = self._serialize_file(node)
                entry["name"] = f"{prefix}{self._node_to_filename(node)}"
                result.append(entry)
        return result

    def _build_relative_path(self, node, root_folder_id: str) -> str:
        """Build relative path from sync root to this node."""
        parts = [self._node_to_filename(node)]
        current_parent_id = node.parent_id
        while current_parent_id and current_parent_id != root_folder_id:
            parent = self._node_repo.get_by_id(current_parent_id)
            if not parent:
                break
            parts.insert(0, parent.name)
            current_parent_id = parent.parent_id
        return "/".join(parts)

    def _get_all_descendant_ids(self, project_id: str, folder_id: str) -> set[str]:
        """Recursively get IDs of all descendants (files + sub-folders)."""
        ids: set[str] = set()
        children = self._node_repo.list_children(
            project_id=project_id, parent_id=folder_id,
        )
        for child in children:
            ids.add(child.id)
            if child.type == "folder":
                ids.update(self._get_all_descendant_ids(project_id, child.id))
        return ids

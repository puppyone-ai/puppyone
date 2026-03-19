"""
Folder-level file sync service.

Implements server-side of the Filesystem Sync architecture:
- Client daemon does all watch/diff/sync logic locally
- Client uses MUT HTTP protocol (clone/push/pull) for data transfer
- Server provides supplementary APIs: list, pull files, push, delete

All write operations go through MUT protocol (MutEphemeralClient).
Read operations use MutTreeReader for lightweight access.
"""

import json as _json
from typing import Optional, Any

from src.infra.s3.service import get_s3_service_instance
from src.utils.logger import log_info, log_error

INLINE_TYPES = {"json", "markdown"}


class FolderSyncService:
    """
    Folder-level sync service.

    The client daemon handles all watch/diff/sync logic via MUT protocol.
    This service provides supplementary operations for the backend API
    and legacy CLI push/pull endpoints.
    """

    def __init__(self, supabase=None):
        self._supabase = supabase

    def _build_tree_reader(self):
        from src.mut_engine.dependencies import create_tree_reader
        return create_tree_reader()

    def _make_ephemeral_client(self, project_id: str, operator: str = "sync:filesystem"):
        from src.mut_engine.dependencies import create_ephemeral_client
        auth_ctx = {
            "agent": operator,
            "_scope": {"id": "_filesystem", "path": "", "exclude": [], "mode": "rw"},
        }
        return create_ephemeral_client(project_id, auth_ctx)

    # ================================================================
    # PULL — read files from MUT tree
    # ================================================================

    def pull(
        self,
        project_id: str,
        folder_id: str,
        cursor: int = 0,
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Pull files from the MUT tree for a folder sync."""
        reader = self._build_tree_reader()
        folder_path = folder_id

        try:
            entries = reader.list_tree(project_id, folder_path)
        except Exception:
            entries = []

        files = []
        for e in entries:
            if e.type == "dir":
                continue
            rel = e.path
            if rel.startswith(folder_path):
                rel = rel[len(folder_path):].lstrip("/")

            try:
                content_bytes = reader.read_file(project_id, e.path)
                if e.path.endswith(".json"):
                    try:
                        content = _json.loads(content_bytes.decode("utf-8"))
                    except Exception:
                        content = content_bytes.decode("utf-8", errors="replace")
                else:
                    content = content_bytes.decode("utf-8", errors="replace")
            except Exception:
                content = ""

            files.append({
                "name": rel,
                "path": e.path,
                "type": "json" if e.path.endswith(".json") else "markdown",
                "content": content,
                "size": e.size,
            })

        return {
            "cursor": 0,
            "files": files,
            "is_full_sync": True,
            "has_more": False,
        }

    # ================================================================
    # PUSH — write a single file via MUT protocol
    # ================================================================

    def push(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        content: Any,
        base_version: int = 0,
        node_type: str = "json",
        operator_id: str = "sync:filesystem",
        operator_name: str = "OpenClaw CLI",
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Push a single file to the MUT tree."""
        file_path = f"{folder_id}/{filename}" if folder_id else filename

        if isinstance(content, dict) or isinstance(content, list):
            content_bytes = _json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
        elif isinstance(content, str):
            content_bytes = content.encode("utf-8")
        elif isinstance(content, bytes):
            content_bytes = content
        else:
            content_bytes = str(content).encode("utf-8")

        try:
            client = self._make_ephemeral_client(project_id, operator_id)
            client.clone()
            push_result = client.push(
                modified={file_path: content_bytes},
                message=f"Push {filename}",
                who=operator_id,
            )

            version = push_result.get("version", 0)
            log_info(f"[FolderSync] Pushed {file_path} v{version}")
            return {"ok": True, "path": file_path, "version": version}
        except Exception as e:
            log_error(f"[FolderSync] Push failed for {file_path}: {e}")
            return {"ok": False, "error": "push_failed", "message": str(e)}

    # ================================================================
    # DELETE — remove a file via MUT protocol
    # ================================================================

    def delete_file(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Delete a file from the MUT tree."""
        file_path = f"{folder_id}/{filename}" if folder_id else filename

        try:
            client = self._make_ephemeral_client(project_id, f"sync:{source_id}")
            client.clone()
            client.push(
                deleted=[file_path],
                message=f"Delete {filename}",
                who=f"sync:{source_id}",
            )
            log_info(f"[FolderSync] Deleted {file_path}")
            return {"ok": True, "path": file_path}
        except Exception as e:
            log_error(f"[FolderSync] Delete failed for {file_path}: {e}")
            return {"ok": False, "error": "delete_failed", "message": str(e)}

    # ================================================================
    # UPLOAD URL — S3 presigned URL for binary files
    # ================================================================

    def request_upload_url(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        content_type: str = "application/octet-stream",
        size_bytes: int = 0,
        operator_id: str = "sync:filesystem",
        **kwargs,
    ) -> dict:
        """Get S3 presigned upload URL for large/binary files."""
        import uuid
        import os

        _, ext = os.path.splitext(filename)
        safe_name = f"{uuid.uuid4()}{ext}"
        s3_key = f"projects/{project_id}/filesystem/{folder_id}/{safe_name}"

        try:
            s3 = get_s3_service_instance()
            if not s3:
                return {"ok": False, "error": "s3_unavailable", "message": "S3 service not available"}

            import asyncio
            loop = asyncio.get_event_loop()
            upload_url = loop.run_until_complete(
                s3.generate_presigned_upload_url(
                    key=s3_key,
                    content_type=content_type,
                    expires_in=3600,
                )
            )

            return {
                "ok": True,
                "upload_url": upload_url,
                "s3_key": s3_key,
                "filename": filename,
            }
        except Exception as e:
            log_error(f"[FolderSync] Upload URL failed: {e}")
            return {"ok": False, "error": "upload_url_failed", "message": str(e)}

    # ================================================================
    # CONFIRM UPLOAD — create MUT tree reference after S3 upload
    # ================================================================

    def confirm_upload(
        self,
        project_id: str,
        folder_id: str,
        filename: str,
        s3_key: str,
        operator_id: str = "sync:filesystem",
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Confirm that a binary file has been uploaded to S3."""
        file_path = f"{folder_id}/{filename}" if folder_id else filename

        ref_content = _json.dumps({
            "_type": "file_ref",
            "_s3_key": s3_key,
            "filename": filename,
        }, ensure_ascii=False, indent=2).encode("utf-8")

        try:
            client = self._make_ephemeral_client(project_id, operator_id)
            client.clone()
            push_result = client.push(
                modified={file_path: ref_content},
                message=f"Upload binary: {filename}",
                who=operator_id,
            )

            log_info(f"[FolderSync] Confirmed upload: {file_path} → {s3_key}")
            return {
                "ok": True,
                "path": file_path,
                "s3_key": s3_key,
                "version": push_result.get("version", 0),
            }
        except Exception as e:
            log_error(f"[FolderSync] Confirm upload failed: {e}")
            return {"ok": False, "error": "confirm_failed", "message": str(e)}

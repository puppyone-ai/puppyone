"""
Folder-level file sync service.

Implements server-side of the Filesystem Sync architecture:
- Client daemon does all watch/diff/sync logic locally
- Client uses MUT HTTP protocol (clone/push/pull) for data transfer
- Server provides supplementary APIs: list, pull files, push, delete

All write operations go through MutOps.
Read operations use MutOps for lightweight access.
"""

import json as _json
import re
from typing import Optional, Any

from src.infra.s3.service import get_s3_service_instance
from src.mut_engine.ops import MutOps
from src.utils.logger import log_info, log_error

INLINE_TYPES = {"json", "markdown"}

_FORBIDDEN_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')
_FORBIDDEN_NAMES = frozenset([".", "..", "CON", "PRN", "AUX", "NUL"] +
                              [f"COM{i}" for i in range(1, 10)] +
                              [f"LPT{i}" for i in range(1, 10)])


def _validate_filename(filename: str) -> str | None:
    """Return error message if filename is invalid, else None."""
    if not filename or not filename.strip():
        return "Filename must not be empty"
    if filename.startswith("/"):
        return f"Absolute path not allowed: {filename}"
    if "\\" in filename:
        return f"Backslash not allowed: {filename}"

    segments = filename.split("/")
    if any(segment == "" for segment in segments):
        return f"Double slash not allowed: {filename}"
    if any(segment == "." for segment in segments):
        return f"Relative path not allowed: {filename}"
    if any(segment == ".." for segment in segments):
        return f"Path traversal not allowed: {filename}"
    if _FORBIDDEN_CHARS.search(filename):
        return f"Filename contains forbidden characters: {filename}"
    basename = filename.rsplit("/", 1)[-1].split(".")[0].upper()
    if basename in _FORBIDDEN_NAMES:
        return f"Reserved filename: {filename}"
    if len(filename) > 255:
        return "Filename too long (max 255)"
    return None


def _extract_file_ref(content_bytes: bytes) -> str | None:
    """Return S3 key from a MUT file_ref blob, if present."""
    try:
        payload = _json.loads(content_bytes.decode("utf-8"))
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None
    if payload.get("_type") != "file_ref":
        return None

    s3_key = payload.get("_s3_key")
    return s3_key if isinstance(s3_key, str) and s3_key else None


def _build_download_url(s3_key: str) -> str | None:
    """Build a presigned download URL synchronously for legacy pull APIs."""
    s3 = get_s3_service_instance()
    if not s3 or not getattr(s3, "client", None):
        return None

    try:
        return s3.client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": s3.bucket_name, "Key": s3_key},
            ExpiresIn=3600,
        )
    except Exception as e:
        log_error(f"[FolderSync] Download URL failed for {s3_key}: {e}")
        return None


class FolderSyncService:
    """
    Folder-level sync service.

    The client daemon handles all watch/diff/sync logic via MUT protocol.
    This service provides supplementary operations for the backend API
    and legacy CLI push/pull endpoints.
    """

    def __init__(self, supabase=None):
        self._supabase = supabase

    def _get_ops(self) -> MutOps:
        from src.mut_engine.dependencies import create_mut_ops
        return create_mut_ops()

    # ================================================================
    # PULL — read files from MUT tree
    # ================================================================

    def pull(
        self,
        project_id: str,
        folder_path: str,
        cursor: int = 0,
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Pull files from the MUT tree for a folder sync."""
        ops = self._get_ops()
        current_version = 0

        try:
            current_version = ops.get_version(project_id)
        except Exception:
            current_version = 0

        try:
            entries = ops.list_tree(project_id, folder_path)
        except Exception:
            entries = []

        files = []
        for e in entries:
            if e.type == "folder":
                continue
            rel = e.path
            if rel.startswith(folder_path):
                rel = rel[len(folder_path):].lstrip("/")

            file_info = {
                "name": rel,
                "path": e.path,
                "type": e.type,
                "size": e.size_bytes or 0,
                "version": current_version,
            }

            try:
                content_bytes = ops.read_file(project_id, e.path)
                if e.type == "json":
                    try:
                        file_info["content"] = _json.loads(content_bytes.decode("utf-8"))
                    except Exception:
                        file_info["content"] = content_bytes.decode("utf-8", errors="replace")
                elif e.type == "markdown":
                    file_info["content"] = content_bytes.decode("utf-8", errors="replace")
                else:
                    s3_key = _extract_file_ref(content_bytes)
                    if s3_key:
                        file_info["s3_key"] = s3_key
                        download_url = _build_download_url(s3_key)
                        if download_url:
                            file_info["download_url"] = download_url
            except Exception:
                if e.type in INLINE_TYPES:
                    file_info["content"] = ""

            files.append(file_info)

        return {
            "cursor": 0,
            "version": current_version,
            "files": files,
            "is_full_sync": True,
            "has_more": False,
        }

    # ================================================================
    # PUSH — write a single file via MutOps
    # ================================================================

    async def push(
        self,
        project_id: str,
        folder_path: str,
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
        err = _validate_filename(filename)
        if err:
            return {"ok": False, "error": "invalid_path", "message": err}

        file_path = f"{folder_path}/{filename}" if folder_path else filename

        if isinstance(content, dict) or isinstance(content, list):
            content_bytes = _json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
        elif isinstance(content, str):
            content_bytes = content.encode("utf-8")
        elif isinstance(content, bytes):
            content_bytes = content
        else:
            content_bytes = str(content).encode("utf-8")

        try:
            ops = self._get_ops()

            result = await ops.write_file(
                project_id, file_path, content_bytes,
                who=operator_id, message=f"Push {filename}",
            )

            log_info(f"[FolderSync] Pushed {file_path} v{result.version}")
            return {"ok": True, "path": file_path, "version": result.version}
        except Exception as e:
            log_error(f"[FolderSync] Push failed for {file_path}: {e}")
            return {"ok": False, "error": "push_failed", "message": str(e)}

    # ================================================================
    # DELETE — remove a file via MutOps
    # ================================================================

    async def delete_file(
        self,
        project_id: str,
        folder_path: str,
        filename: str,
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Delete a file from the MUT tree."""
        err = _validate_filename(filename)
        if err:
            return {"ok": False, "error": "invalid_path", "message": err}

        file_path = f"{folder_path}/{filename}" if folder_path else filename

        try:
            ops = self._get_ops()
            await ops.delete(
                project_id, [file_path],
                who=f"sync:{source_id}", message=f"Delete {filename}",
            )
            log_info(f"[FolderSync] Deleted {file_path}")
            return {"ok": True, "path": file_path}
        except Exception as e:
            log_error(f"[FolderSync] Delete failed for {file_path}: {e}")
            return {"ok": False, "error": "delete_failed", "message": str(e)}

    # ================================================================
    # UPLOAD URL — S3 presigned URL for binary files
    # ================================================================

    async def request_upload_url(
        self,
        project_id: str,
        folder_path: str,
        filename: str,
        content_type: str = "application/octet-stream",
        size_bytes: int = 0,
        operator_id: str = "sync:filesystem",
        **kwargs,
    ) -> dict:
        """Get S3 presigned upload URL for large/binary files."""
        err = _validate_filename(filename)
        if err:
            return {"ok": False, "error": "invalid_path", "message": err}

        import uuid
        import os

        _, ext = os.path.splitext(filename)
        safe_name = f"{uuid.uuid4()}{ext}"
        s3_key = f"projects/{project_id}/filesystem/{folder_path}/{safe_name}"

        try:
            s3 = get_s3_service_instance()
            if not s3:
                return {"ok": False, "error": "s3_unavailable", "message": "S3 service not available"}

            upload_url = await s3.generate_presigned_upload_url(
                key=s3_key,
                content_type=content_type,
                expires_in=3600,
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

    async def confirm_upload(
        self,
        project_id: str,
        folder_path: str,
        filename: str,
        s3_key: str,
        operator_id: str = "sync:filesystem",
        source_id: str = "",
        **kwargs,
    ) -> dict:
        """Confirm that a binary file has been uploaded to S3."""
        err = _validate_filename(filename)
        if err:
            return {"ok": False, "error": "invalid_path", "message": err}

        file_path = f"{folder_path}/{filename}" if folder_path else filename

        ref_content = _json.dumps({
            "_type": "file_ref",
            "_s3_key": s3_key,
            "filename": filename,
        }, ensure_ascii=False, indent=2).encode("utf-8")

        try:
            ops = self._get_ops()
            result = await ops.write_file(
                project_id, file_path, ref_content,
                who=operator_id, message=f"Upload binary: {filename}",
            )

            log_info(f"[FolderSync] Confirmed upload: {file_path} → {s3_key}")
            return {
                "ok": True,
                "path": file_path,
                "s3_key": s3_key,
                "version": result.version,
            }
        except Exception as e:
            log_error(f"[FolderSync] Confirm upload failed: {e}")
            return {"ok": False, "error": "confirm_failed", "message": str(e)}

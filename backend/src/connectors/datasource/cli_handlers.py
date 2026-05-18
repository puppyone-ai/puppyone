"""
CLI-driven sync handler logic.

Extracted from router.py to keep route handlers thin.
Contains the core business logic for push-file and pull-files endpoints.
"""

import os
import json as _json

from src.connectors.datasource.service import SyncService


def _notify_folder_source(action: str, sync_id: str) -> None:
    """Filesystem sync is now client-side — no server notification needed."""


def _sync_resp(s):
    """Convert a sync ORM/model object into a SyncResponse-compatible dict."""
    return {
        "id": s.id,
        "project_id": s.project_id,
        "path": s.path,
        "direction": s.direction,
        "provider": s.provider,
        "config": s.config,
        "status": s.status,
        "last_sync_commit_id": s.last_sync_commit_id,
        "error_message": s.error_message,
    }


async def process_push_file(
    commands,
    project_id: str,
    body,
    user_id: str,
    *,
    sync_svc: SyncService,
    parent_sync,
) -> dict:
    """
    Core logic for pushing a local file to PuppyOne.
    Creates a new node if no sync binding exists, updates if it does.

    Returns a dict with keys: path, external_resource_id, action, version.
    """
    is_json = body.content_json is not None

    existing = sync_svc.sync_repo.find_by_config_key(
        parent_sync.provider, "external_resource_id", body.external_resource_id,
    )

    if existing:
        # Skip if content unchanged
        if existing.remote_hash == body.content_hash:
            return {
                "path": existing.path,
                "external_resource_id": body.external_resource_id,
                "action": "skipped",
                "commit_id": existing.last_sync_commit_id,
            }

        # Update existing file
        content_bytes = (
            _json.dumps(body.content_json, ensure_ascii=False, indent=2)
            if is_json
            else (body.content_md or "")
        ).encode("utf-8")

        outcome = await commands.write_bytes(
            project_id, existing.path, content_bytes,
            actor=f"sync:cli:{body.external_resource_id}",
            message=f"push update {body.external_resource_id}",
        )
        write_result = outcome.result
        commit_id = write_result.commit_id

        sync_svc.sync_repo.update_sync_point(
            sync_id=existing.id,
            last_sync_commit_id=commit_id,
            remote_hash=body.content_hash,
        )
        return {
            "path": existing.path,
            "external_resource_id": body.external_resource_id,
            "action": "updated",
            "commit_id": commit_id,
        }

    # Create new file
    file_name = body.name or os.path.splitext(
        os.path.basename(body.external_resource_id)
    )[0]
    target_folder_path = parent_sync.config.get("target_folder_id", "")

    ext = ".json" if is_json else ".md"
    file_path = (
        f"{target_folder_path}/{file_name}{ext}"
        if target_folder_path
        else f"{file_name}{ext}"
    )

    content_bytes = (
        _json.dumps(body.content_json, ensure_ascii=False, indent=2)
        if is_json
        else (body.content_md or "")
    ).encode("utf-8")

    outcome = await commands.write_bytes(
        project_id, file_path, content_bytes,
        actor=f"sync:cli:{body.external_resource_id}",
        message=f"push create {body.external_resource_id}",
    )
    write_result = outcome.result
    commit_id = write_result.commit_id

    return {
        "path": file_path,
        "external_resource_id": body.external_resource_id,
        "action": "created",
        "commit_id": commit_id,
    }


def process_pull_files(
    ops,
    project_id: str,
    body,
    *,
    sync_svc: SyncService,
    parent_sync,
) -> list[dict]:
    """
    Core logic for pulling files that changed on the server since last sync.

    Returns a list of dicts, each with keys:
    path, external_resource_id, content_json, content_md, node_type, head_commit_id.

    ``head_commit_id`` identifies the project-wide Git commit snapshot
    these files were read at. Skipping logic is equality-based: a sync
    whose ``last_sync_commit_id`` already equals the current head gets
    filtered out.
    """
    files: list[dict] = []

    syncs = sync_svc.sync_repo.list_by_provider(
        parent_sync.project_id, parent_sync.provider,
    )

    head_commit_id = ops.get_head_commit_id(project_id)

    for s in syncs:
        if not s.path:
            continue

        if head_commit_id and s.last_sync_commit_id == head_commit_id:
            continue

        ext_resource_id = s.config.get("external_resource_id", "")
        path = s.path

        try:
            content = ops.read_file(project_id, path)
        except FileNotFoundError:
            continue

        from src.version_engine.services.tree_reader import detect_type
        node_type = detect_type(path)
        is_json = node_type == "json"

        if is_json:
            try:
                json_content = _json.loads(content.decode("utf-8"))
                text_content = None
            except (ValueError, UnicodeDecodeError):
                json_content = None
                text_content = content.decode("utf-8", errors="replace")
        else:
            json_content = None
            text_content = content.decode("utf-8", errors="replace")

        files.append({
            "path": path,
            "external_resource_id": ext_resource_id,
            "content_json": json_content if is_json else None,
            "content_md": text_content if not is_json else None,
            "node_type": "json" if is_json else "markdown",
            "head_commit_id": head_commit_id,
        })

    return files

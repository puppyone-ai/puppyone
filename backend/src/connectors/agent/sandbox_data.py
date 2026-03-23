"""
Agent — Sandbox Data Preparation

Sandbox data preparation logic extracted from agent/service.py:
- SandboxFile / SandboxData data classes
- prepare_sandbox_data() unified entry point
- extract_data_by_path() / merge_data_by_path() JSON path utilities

Responsibility: prepare the list of files to mount in the sandbox based on access point node type.

NOTE: Reads directly from the Mut Merkle tree via MutOps, does not depend on content_nodes (PG).
"""

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from loguru import logger


@dataclass
class SandboxFile:
    """A file in the sandbox."""
    path: str
    content: str | None = None
    s3_key: str | None = None
    content_type: str = "application/octet-stream"
    mut_path: str | None = None
    node_type: str | None = None
    base_version: int = 0


@dataclass
class SandboxData:
    """Sandbox data."""
    files: list[SandboxFile] = field(default_factory=list)
    node_type: str = "json"
    root_path: str = ""
    root_node_name: str = ""
    node_path_map: dict = field(default_factory=dict)


async def prepare_sandbox_data(
    ops,
    project_id: str,
    path: str,
    json_path: str | None,
    user_id: str,
) -> SandboxData:
    """
    Unified sandbox data preparation function.

    Returns different sandbox data depending on the node type:
    - json: export content as data.json (optionally extract sub-data via json_path)
    - folder: recursively fetch child file list
    - file/pdf/image/etc: single file info

    Args:
        ops: MutOps instance
        project_id: project UUID
        path: Mut tree path (e.g. "my-folder" or "data.json")
        json_path: optional JSON Pointer sub-path
        user_id: current user id (for logging)
    """
    entry = ops.stat(project_id, path)
    if not entry:
        raise ValueError(f"Path not found: {path}")

    logger.info(f"[prepare_sandbox_data] path={path}, type={entry.type}, name={entry.name}")

    files: list[SandboxFile] = []
    node_type = entry.type or "json"
    node_name = entry.name or path.rsplit("/", 1)[-1]

    if node_type == "json":
        raw = ops.read_file(project_id, path)
        try:
            content = json.loads(raw.decode("utf-8"))
        except Exception:
            content = {}
        if json_path:
            content = extract_data_by_path(content, json_path)

        files.append(SandboxFile(
            path="/workspace/data.json",
            content=json.dumps(content, ensure_ascii=False, indent=2),
            content_type="application/json",
            mut_path=path,
            node_type="json",
        ))
        logger.info(f"[prepare_sandbox_data] JSON node, content size={len(str(content))}")

    elif node_type == "folder":
        children = ops.list_tree(project_id, path)
        logger.info(f"[prepare_sandbox_data] Folder node, children count={len(children)}")

        folder_name = node_name or "data"

        for child in children:
            if child.type == "folder":
                continue

            relative_path = child.path
            if relative_path.startswith(path + "/"):
                relative_path = relative_path[len(path) + 1:]

            if not relative_path:
                relative_path = f"{folder_name}/{child.name}"

            if child.type == "json":
                try:
                    child_raw = ops.read_file(project_id, child.path)
                    child_json = json.loads(child_raw.decode("utf-8"))
                except Exception:
                    child_json = {}
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}",
                    content=json.dumps(child_json, ensure_ascii=False, indent=2),
                    content_type="application/json",
                    mut_path=child.path,
                    node_type="json",
                ))
            elif child.type == "markdown":
                try:
                    child_raw = ops.read_file(project_id, child.path)
                    child_text = child_raw.decode("utf-8", errors="replace")
                except Exception:
                    child_text = None
                if child_text is not None:
                    md_path = relative_path if relative_path.endswith(".md") else f"{relative_path}.md"
                    files.append(SandboxFile(
                        path=f"/workspace/{md_path}",
                        content=child_text,
                        content_type="text/markdown",
                        mut_path=child.path,
                        node_type="markdown",
                    ))
            elif child.content_hash:
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}",
                    s3_key=None,
                    content_type=child.mime_type or "application/octet-stream",
                    mut_path=child.path,
                    node_type=child.type or "file",
                ))
    else:
        file_name = node_name or "file"

        try:
            raw = ops.read_file(project_id, path)
            fallback_json = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            fallback_json = None
        except FileNotFoundError:
            fallback_json = None

        if fallback_json and isinstance(fallback_json, (dict, list)):
            files.append(SandboxFile(
                path=f"/workspace/{file_name}.json",
                content=json.dumps(fallback_json, ensure_ascii=False, indent=2),
                content_type="application/json",
            ))
        elif entry.content_hash:
            files.append(SandboxFile(
                path=f"/workspace/{file_name}",
                s3_key=None,
                content_type=entry.mime_type or "application/octet-stream",
            ))
        else:
            logger.warning(f"[prepare_sandbox_data] Path has no content: {path}")

    return SandboxData(
        files=files,
        node_type=node_type,
        root_path=path,
        root_node_name=node_name,
    )


def extract_data_by_path(data, json_path: str):
    """Extract the node at the specified path from JSON data."""
    if not json_path or json_path == "/" or json_path == "":
        return data

    segments = [segment for segment in json_path.split("/") if segment]
    current = data
    for segment in segments:
        if current is None:
            return None
        if isinstance(current, list):
            try:
                index = int(segment)
            except (TypeError, ValueError):
                return None
            if index < 0 or index >= len(current):
                return None
            current = current[index]
        elif isinstance(current, dict):
            current = current.get(segment)
        else:
            return None
    return current


def merge_data_by_path(original_data, json_path: str, new_node_data):
    """Merge new data back into the original data at the specified path."""
    if not json_path or json_path == "/" or json_path == "":
        return new_node_data

    result = json.loads(json.dumps(original_data))
    segments = [segment for segment in json_path.split("/") if segment]

    current = result
    for segment in segments[:-1]:
        if isinstance(current, list):
            current = current[int(segment)]
        elif isinstance(current, dict):
            current = current[segment]

    last_segment = segments[-1]
    if isinstance(current, list):
        current[int(last_segment)] = new_node_data
    elif isinstance(current, dict):
        current[last_segment] = new_node_data

    return result

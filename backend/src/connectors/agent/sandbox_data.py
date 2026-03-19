"""
Agent — 沙盒数据准备

从 agent/service.py 提取的沙盒数据准备逻辑：
- SandboxFile / SandboxData 数据类
- prepare_sandbox_data() 统一入口
- extract_data_by_path() / merge_data_by_path() JSON 路径工具

职责：根据 access point 的节点类型，准备要挂载到沙盒的文件列表。

NOTE: 使用 MutTreeReader 直接从 Mut Merkle tree 读取，不依赖 content_nodes (PG)。
"""

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from loguru import logger


@dataclass
class SandboxFile:
    """沙盒中的文件"""
    path: str
    content: str | None = None
    s3_key: str | None = None
    content_type: str = "application/octet-stream"
    node_id: str | None = None
    node_type: str | None = None
    base_version: int = 0


@dataclass
class SandboxData:
    """沙盒数据"""
    files: list[SandboxFile] = field(default_factory=list)
    node_type: str = "json"
    root_node_id: str = ""
    root_node_name: str = ""
    node_path_map: dict = field(default_factory=dict)


async def prepare_sandbox_data(
    tree_reader,
    project_id: str,
    path: str,
    json_path: str | None,
    user_id: str,
) -> SandboxData:
    """
    统一的沙盒数据准备函数

    根据节点类型返回不同的沙盒数据：
    - json: 导出 content 为 data.json（可选 json_path 提取子数据）
    - folder: 递归获取子文件列表
    - file/pdf/image/etc: 单个文件信息

    Args:
        tree_reader: MutTreeReader instance
        project_id: project UUID
        path: Mut tree path (e.g. "my-folder" or "data.json")
        json_path: optional JSON Pointer sub-path
        user_id: current user id (for logging)
    """
    entry = tree_reader.stat(project_id, path)
    if not entry:
        raise ValueError(f"Path not found: {path}")

    logger.info(f"[prepare_sandbox_data] path={path}, type={entry.type}, name={entry.name}")

    files: list[SandboxFile] = []
    node_type = entry.type or "json"
    node_name = entry.name or path.rsplit("/", 1)[-1]

    if node_type == "json":
        raw = tree_reader.read_file(project_id, path)
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
            node_id=path,
            node_type="json",
        ))
        logger.info(f"[prepare_sandbox_data] JSON node, content size={len(str(content))}")

    elif node_type == "folder":
        children = tree_reader.list_tree(project_id, path)
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
                    child_raw = tree_reader.read_file(project_id, child.path)
                    child_json = json.loads(child_raw.decode("utf-8"))
                except Exception:
                    child_json = {}
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}",
                    content=json.dumps(child_json, ensure_ascii=False, indent=2),
                    content_type="application/json",
                    node_id=child.path,
                    node_type="json",
                ))
            elif child.type == "markdown":
                try:
                    child_raw = tree_reader.read_file(project_id, child.path)
                    child_text = child_raw.decode("utf-8", errors="replace")
                except Exception:
                    child_text = None
                if child_text is not None:
                    md_path = relative_path if relative_path.endswith(".md") else f"{relative_path}.md"
                    files.append(SandboxFile(
                        path=f"/workspace/{md_path}",
                        content=child_text,
                        content_type="text/markdown",
                        node_id=child.path,
                        node_type="markdown",
                    ))
            elif child.content_hash:
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}",
                    s3_key=None,
                    content_type=child.mime_type or "application/octet-stream",
                    node_id=child.path,
                    node_type=child.type or "file",
                ))
    else:
        file_name = node_name or "file"

        try:
            raw = tree_reader.read_file(project_id, path)
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
        root_node_id=path,
        root_node_name=node_name,
    )


def extract_data_by_path(data, json_path: str):
    """从 JSON 数据中提取指定路径的节点"""
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
    """将新数据合并回原数据的指定路径"""
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

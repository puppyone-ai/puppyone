"""
Agent — 沙盒数据准备

从 agent/service.py 提取的沙盒数据准备逻辑：
- SandboxFile / SandboxData 数据类
- prepare_sandbox_data() 统一入口
- extract_data_by_path() / merge_data_by_path() JSON 路径工具

职责：根据 access point 的节点类型，准备要挂载到沙盒的文件列表。
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
    node_service,
    node_id: str,
    json_path: str | None,
    user_id: str,
) -> SandboxData:
    """
    统一的沙盒数据准备函数

    根据节点类型返回不同的沙盒数据：
    - json: 导出 content 为 data.json（可选 json_path 提取子数据）
    - folder: 递归获取子文件列表
    - github_repo: 从 S3 目录下载所有文件（单节点模式）
    - file/pdf/image/etc: 单个文件信息
    """
    node = node_service.get_by_id_unsafe(node_id)
    if not node:
        raise ValueError(f"Node not found: {node_id}")

    logger.info(f"[prepare_sandbox_data] node.id={node.id}, type={node.type}, name={node.name}")

    files: list[SandboxFile] = []
    node_type = node.type or "json"

    if node_type == "github_repo":
        content = node.preview_json or {}
        file_list = content.get("files", [])
        repo_name = content.get("repo", node.name or "repo")

        logger.info(f"[prepare_sandbox_data] GitHub repo node, file_count={len(file_list)}")

        for file_info in file_list:
            file_path = file_info.get("path", "")
            s3_key = file_info.get("s3_key", "")
            if not file_path or not s3_key:
                continue
            files.append(SandboxFile(
                path=f"/workspace/{repo_name}/{file_path}",
                s3_key=s3_key,
                content_type="text/plain",
            ))

    elif node_type == "json":
        content = node.preview_json or {}
        if json_path:
            content = extract_data_by_path(content, json_path)

        files.append(SandboxFile(
            path="/workspace/data.json",
            content=json.dumps(content, ensure_ascii=False, indent=2),
            content_type="application/json",
            node_id=node.id,
            node_type="json",
            base_version=getattr(node, "current_version", 0),
        ))
        logger.info(f"[prepare_sandbox_data] JSON node, content size={len(str(content))}")

    elif node_type == "folder":
        children = node_service.list_descendants(node.project_id, node_id)
        logger.info(f"[prepare_sandbox_data] Folder node, children count={len(children)}")

        id_to_node: dict[str, Any] = {node.id: node}
        for child in children:
            id_to_node[child.id] = child

        folder_name = node.name or "data"

        def build_name_path(target_node) -> str:
            path_parts = []
            current = target_node
            while current and current.id != node.id:
                path_parts.append(current.name)
                if current.parent_id and current.parent_id in id_to_node:
                    current = id_to_node[current.parent_id]
                else:
                    break
            path_parts.append(folder_name)
            path_parts.reverse()
            return "/".join(path_parts)

        for child in children:
            if child.type == "folder":
                continue

            relative_path = build_name_path(child)
            if not relative_path:
                relative_path = f"{folder_name}/{child.name}"

            child_version = getattr(child, "current_version", 0)

            if child.type == "json":
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}.json",
                    content=json.dumps(child.preview_json or {}, ensure_ascii=False, indent=2),
                    content_type="application/json",
                    node_id=child.id,
                    node_type="json",
                    base_version=child_version,
                ))
            elif child.preview_md is not None:
                md_path = relative_path if relative_path.endswith(".md") else f"{relative_path}.md"
                files.append(SandboxFile(
                    path=f"/workspace/{md_path}",
                    content=child.preview_md,
                    content_type="text/markdown",
                    node_id=child.id,
                    node_type="markdown",
                    base_version=child_version,
                ))
            elif child.s3_key:
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}",
                    s3_key=child.s3_key,
                    content_type=child.mime_type or "application/octet-stream",
                    node_id=child.id,
                    node_type=child.type or "file",
                    base_version=child_version,
                ))
    else:
        file_name = node.name or "file"

        if node.preview_json and isinstance(node.preview_json, (dict, list)):
            files.append(SandboxFile(
                path=f"/workspace/{file_name}.json",
                content=json.dumps(node.preview_json, ensure_ascii=False, indent=2),
                content_type="application/json",
            ))
        elif node.s3_key:
            files.append(SandboxFile(
                path=f"/workspace/{file_name}",
                s3_key=node.s3_key,
                content_type=node.mime_type or "application/octet-stream",
            ))
        else:
            logger.warning(f"[prepare_sandbox_data] Node has no content or s3_key: {node_id}")

    return SandboxData(
        files=files,
        node_type=node_type,
        root_node_id=node.id,
        root_node_name=node.name or "",
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

from pathlib import Path
import json
import os
import re
import time
from typing import Any, AsyncGenerator, Iterable

from src.agent.schemas import AgentRequest

BASH_TOOL = {"type": "bash_20250124", "name": "bash"}
FILE_TOOLS = [
    {
        "name": "read_file",
        "description": "Read the contents of a file at the specified path",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "The file path to read"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "glob_search",
        "description": "Search for files matching a glob pattern",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern to match files",
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory for the search",
                },
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "grep_search",
        "description": "Search for a pattern in files",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for",
                },
                "path": {
                    "type": "string",
                    "description": "File or directory path to search in",
                },
            },
            "required": ["pattern"],
        },
    },
]


class AgentService:
    """Agent core logic."""

    def __init__(self, anthropic_client=None):
        self._anthropic = anthropic_client or _default_anthropic_client()

    async def should_use_bash(self, node_data, bash_access) -> bool:
        if not bash_access:
            return False
        return node_data is not None

    async def stream_events(
        self,
        request: AgentRequest,
        current_user,
        table_service,
        sandbox_service,
        max_iterations: int = 15,
    ) -> AsyncGenerator[dict, None]:
        table_data = None
        node_data = None
        node_path = ""
        readonly = False

        bash_access = (
            request.bashAccessPoints[0]
            if request.bashAccessPoints
            else None
        )
        if bash_access:
            node_path = bash_access.path or ""
            readonly = bash_access.mode == "readonly"

        if request.table_id and table_service and current_user:
            table = table_service.get_by_id_with_access_check(
                request.table_id, current_user.user_id
            )
            table_data = table.data
            if bash_access:
                node_data = extract_data_by_path(table_data, node_path)

        use_bash = await self.should_use_bash(node_data, [bash_access] if bash_access else None)
        session_id = None
        if use_bash and sandbox_service:
            session_id = f"agent-{int(time.time() * 1000)}"
            start_result = await sandbox_service.start(
                session_id=session_id, data=node_data, readonly=readonly
            )
            if not start_result.get("success"):
                yield {
                    "type": "error",
                    "message": start_result.get("error", "Failed to start sandbox"),
                }
                return
            yield {
                "type": "status",
                "message": "Sandbox ready",
            }

        tools = [BASH_TOOL] if use_bash else FILE_TOOLS
        system_prompt = (
            generate_system_prompt(readonly, node_path)
            if use_bash
            else "You are Puppy 🐶, a helpful AI assistant."
        )
        messages = []
        if request.chatHistory:
            for item in request.chatHistory:
                messages.append({"role": item.role, "content": item.content})
        messages.append({"role": "user", "content": request.prompt})

        tool_index = 0
        iterations = 0
        while iterations < max_iterations:
            iterations += 1
            response = await self._anthropic.messages.create(
                model=os.getenv(
                    "ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929"
                ),
                max_tokens=4096,
                system=system_prompt,
                tools=tools,
                messages=messages,
            )
            tool_uses = []
            for block in response.content:
                block_type = _get_attr(block, "type")
                if block_type == "text":
                    yield {"type": "text", "content": _get_attr(block, "text")}
                elif block_type == "tool_use":
                    tool_uses.append(block)

            if not tool_uses:
                break

            tool_results = []
            for tool in tool_uses:
                current_tool_index = tool_index
                tool_index += 1
                tool_name = _get_attr(tool, "name")
                tool_input = _get_attr(tool, "input")
                yield {
                    "type": "tool_start",
                    "toolId": current_tool_index,
                    "toolName": tool_name,
                    "toolInput": (
                        tool_input.get("command")
                        if tool_name == "bash"
                        else json.dumps(tool_input)
                    ),
                }
                success = True
                output = ""
                try:
                    if tool_name == "bash" and use_bash and sandbox_service:
                        exec_result = await sandbox_service.exec(
                            session_id, tool_input.get("command", "")
                        )
                        if exec_result.get("success"):
                            output = exec_result.get("output", "")
                        else:
                            success = False
                            output = exec_result.get("error", "")
                    else:
                        output = execute_file_tool(
                            tool_name,
                            tool_input,
                            request.workingDirectory or os.getcwd(),
                        )
                except Exception as exc:
                    success = False
                    output = f"Error: {exc}"

                yield {
                    "type": "tool_end",
                    "toolId": current_tool_index,
                    "toolName": tool_name,
                    "output": output[:500],
                    "success": success,
                }
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": _get_attr(tool, "id"),
                        "content": output,
                        "is_error": not success,
                    }
                )

            messages.append(
                {
                    "role": "assistant",
                    "content": _normalize_content(response.content),
                }
            )
            messages.append({"role": "user", "content": tool_results})
            if getattr(response, "stop_reason", None) == "end_turn":
                break

        if use_bash and sandbox_service:
            read_result = await sandbox_service.read(session_id)
            if read_result.get("success"):
                if readonly:
                    updated_data = table_data
                    modified_path = None
                else:
                    updated_data = merge_data_by_path(
                        table_data, node_path, read_result.get("data")
                    )
                    modified_path = node_path
                    if table_service:
                        table_service.repo.update_context_data(
                            request.table_id, updated_data
                        )
                yield {
                    "type": "result",
                    "success": True,
                    "updatedData": updated_data,
                    "modifiedPath": modified_path,
                }
            else:
                yield {
                    "type": "result",
                    "success": False,
                    "error": read_result.get("error"),
                }
            await sandbox_service.stop(session_id)
        else:
            yield {"type": "result", "success": True}


def generate_system_prompt(is_readonly: bool, node_path: str) -> str:
    path_desc = f"节点路径: {node_path}" if node_path else "根节点"
    if is_readonly:
        return (
            "你是一个 JSON 数据查看助手。\n\n"
            "当前 JSON 数据文件位于: /workspace/data.json\n"
            f"{path_desc}\n\n"
            "⚠️ 重要：你只有【只读权限】，不能修改数据！\n"
        )
    return (
        "你是一个 JSON 数据编辑助手。\n\n"
        "当前 JSON 数据文件位于: /workspace/data.json\n"
        f"{path_desc}\n"
    )


def extract_data_by_path(data, json_path: str):
    if not json_path or json_path == "/":
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
    if not json_path or json_path == "/":
        return new_node_data

    result = _deep_copy_json(original_data)
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


def execute_file_tool(name: str, input_data: dict, cwd: str) -> str:
    cwd_path = Path(cwd).resolve()
    try:
        if name == "read_file":
            target = cwd_path / input_data["path"]
            if not target.exists():
                return f"Error: File not found: {input_data['path']}"
            return target.read_text(encoding="utf-8")

        if name == "glob_search":
            pattern = input_data["pattern"]
            search_cwd = cwd_path
            if "cwd" in input_data:
                search_cwd = (cwd_path / input_data["cwd"]).resolve()
            files = list(search_cwd.glob(pattern))
            if not files:
                return "No files found"
            return "\n".join(str(p.relative_to(search_cwd)) for p in files[:100])

        if name == "grep_search":
            pattern = input_data["pattern"]
            search_root = cwd_path / input_data.get("path", ".")
            regex = re.compile(pattern)
            results = []
            for file_path in search_root.rglob("*"):
                if not file_path.is_file():
                    continue
                try:
                    content = file_path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                for idx, line in enumerate(content.splitlines(), start=1):
                    if regex.search(line):
                        results.append(
                            f"{file_path.relative_to(search_root)}:{idx}:{line}"
                        )
                        if len(results) >= 100:
                            break
                if len(results) >= 100:
                    break
            return "\n".join(results) if results else "No matches found"

        return f"Unknown tool: {name}"
    except Exception as exc:
        return f"Error: {exc}"


def _deep_copy_json(data):
    return json.loads(json.dumps(data))


def _default_anthropic_client():
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def _get_attr(obj, name: str, default=None):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _normalize_content(content: Iterable[Any]):
    normalized = []
    for block in content:
        block_type = _get_attr(block, "type")
        if block_type == "text":
            normalized.append({"type": "text", "text": _get_attr(block, "text")})
        elif block_type == "tool_use":
            normalized.append(
                {
                    "type": "tool_use",
                    "id": _get_attr(block, "id"),
                    "name": _get_attr(block, "name"),
                    "input": _get_attr(block, "input"),
                }
            )
    return normalized

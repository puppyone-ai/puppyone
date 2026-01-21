"""
Agent Service - 简化版

前端只需要传 active_tool_ids，后端自动处理一切：
1. 根据 tool_id 查库获取 tool 配置
2. 如果是 bash tool，自动查表数据、启动沙盒
3. 构建 Claude 请求
"""

import json
import time
from typing import Any, AsyncGenerator, Iterable, Optional

from loguru import logger

from src.agent.schemas import AgentRequest
from src.config import settings
from src.agent.chat.service import ChatService

# Anthropic 官方 bash 工具
BASH_TOOL = {"type": "bash_20250124", "name": "bash"}


class AgentService:
    """Agent 核心逻辑"""

    def __init__(self, anthropic_client=None):
        self._anthropic = anthropic_client or _default_anthropic_client()

    async def stream_events(
        self,
        request: AgentRequest,
        current_user,
        table_service,
        tool_service,
        sandbox_service,
        chat_service: Optional[ChatService] = None,
        max_iterations: int = 15,
    ) -> AsyncGenerator[dict, None]:
        """
        处理 Agent 请求的主入口

        前端只传 active_tool_ids，后端自动：
        1. 查库获取 tool 配置
        2. 如果有 bash tool，查表数据、启动沙盒
        3. 构建 Claude 消息
        """

        # ========== 1. 解析 active_tool_ids，查库获取配置 ==========
        bash_tool = None  # {table_id, json_path, readonly}

        if request.active_tool_ids and current_user and tool_service:
            for tool_id in request.active_tool_ids:
                try:
                    tool = tool_service.get_by_id(tool_id)
                    if tool and tool.user_id == current_user.user_id:
                        tool_type = (tool.type or "").strip()
                        if tool_type in ("shell_access", "shell_access_readonly"):
                            # 只取第一个 bash tool（互斥）
                            if bash_tool is None:
                                bash_tool = {
                                    "table_id": tool.table_id,
                                    "json_path": (tool.json_path or "").strip(),
                                    "readonly": tool_type == "shell_access_readonly",
                                }
                                logger.info(f"[Agent] Found bash tool: {bash_tool}")
                except Exception as e:
                    logger.warning(f"[Agent] Failed to get tool {tool_id}: {e}")

        # ========== 2. Chat persistence (best-effort) ==========
        persisted_session_id: str | None = None
        created_session = False
        should_persist = current_user is not None and chat_service is not None

        if should_persist:
            try:
                persisted_session_id, created_session = chat_service.ensure_session(
                    user_id=current_user.user_id,
                    session_id=request.session_id,
                    mode="agent",
                )
                if created_session and persisted_session_id:
                    yield {"type": "session", "sessionId": persisted_session_id}
            except Exception:
                persisted_session_id = None
                should_persist = False

        # 加载历史消息
        messages: list[dict[str, Any]] = []
        if should_persist and persisted_session_id:
            try:
                history = chat_service.load_history_for_llm(
                    user_id=current_user.user_id,
                    session_id=persisted_session_id,
                    limit=60,
                )
                messages.extend(history)
            except Exception:
                if request.chatHistory:
                    for item in request.chatHistory:
                        messages.append({"role": item.role, "content": item.content})
        else:
            if request.chatHistory:
                for item in request.chatHistory:
                    messages.append({"role": item.role, "content": item.content})

        # 保存用户消息
        if should_persist and persisted_session_id:
            try:
                chat_service.add_user_message(
                    session_id=persisted_session_id, content=request.prompt
                )
                if created_session:
                    chat_service.maybe_set_title_on_first_message(
                        user_id=current_user.user_id,
                        session_id=persisted_session_id,
                        first_message=request.prompt,
                    )
            except Exception:
                pass

        # ========== 3. 如果有 bash tool，查表数据、启动沙盒 ==========
        use_bash = bash_tool is not None
        node_data = None
        sandbox_session_id = None

        if use_bash and table_service and current_user:
            try:
                table = table_service.get_by_id_with_access_check(
                    bash_tool["table_id"], current_user.user_id
                )
                logger.info(f"[Agent] Found table: id={table.id}, name={table.name}")
                logger.info(
                    f"[Agent] table.data type={type(table.data).__name__}, value={str(table.data)[:500] if table.data else 'None'}"
                )

                # 提取指定路径的数据
                if table.data:
                    node_data = extract_data_by_path(table.data, bash_tool["json_path"])
                    logger.info(
                        f"[Agent] Extracted node_data for path '{bash_tool['json_path']}': {str(node_data)[:100] if node_data else 'None'}..."
                    )
                else:
                    logger.warning("[Agent] table.data is None or empty!")
            except Exception as e:
                logger.warning(f"[Agent] Failed to get table data: {e}")

        if use_bash and sandbox_service:
            sandbox_session_id = f"agent-{int(time.time() * 1000)}"
            sandbox_data = node_data if node_data is not None else {}

            start_result = await sandbox_service.start(
                session_id=sandbox_session_id,
                data=sandbox_data,
                readonly=bash_tool["readonly"],
            )

            if not start_result.get("success"):
                err_msg = start_result.get("error", "Failed to start sandbox")
                yield {"type": "error", "message": err_msg}
                if should_persist and persisted_session_id:
                    try:
                        chat_service.add_assistant_message(
                            session_id=persisted_session_id,
                            content=err_msg,
                            parts=[{"type": "text", "content": err_msg}],
                        )
                    except Exception:
                        pass
                return

            yield {"type": "status", "message": "Sandbox ready"}

        # ========== 4. 构建 Claude 请求 ==========
        tools = [BASH_TOOL] if use_bash else []

        system_prompt = (
            "你是 Puppy 🐶，一个 JSON 数据处理助手。使用 bash 工具来查看和操作数据。"
            if use_bash
            else "You are Puppy 🐶, a helpful AI assistant."
        )

        # 构建用户消息：如果使用 bash，添加数据上下文
        user_content = request.prompt
        if use_bash:
            json_path = bash_tool["json_path"] or "/"
            readonly = bash_tool["readonly"]
            context_prefix = (
                f"[数据上下文]\n"
                f"当前 JSON 数据文件: /workspace/data.json\n"
                f"节点路径: {json_path}\n"
                f"权限: {'⚠️ 只读模式' if readonly else '可读写模式'}\n"
                f"[用户消息]\n"
            )
            user_content = context_prefix + request.prompt

        messages.append({"role": "user", "content": user_content})

        # ========== 5. 调用 Claude，处理工具调用 ==========
        persisted_parts: list[dict[str, Any]] = []
        tool_index = 0
        iterations = 0

        while iterations < max_iterations:
            iterations += 1

            logger.info(
                f"[CLAUDE REQUEST] Iteration {iterations}:\n{json.dumps({'model': settings.ANTHROPIC_MODEL, 'system': system_prompt, 'tools': tools, 'messages': messages}, ensure_ascii=False, indent=2)}"
            )

            try:
                response = await self._anthropic.messages.create(
                    model=settings.ANTHROPIC_MODEL,
                    max_tokens=4096,
                    system=system_prompt,
                    tools=tools,
                    messages=messages,
                )

                logger.info(
                    f"[CLAUDE RESPONSE] Iteration {iterations}: stop_reason={response.stop_reason}"
                )

            except Exception as e:
                msg = str(e)
                yield {"type": "error", "message": msg}
                if should_persist and persisted_session_id:
                    try:
                        chat_service.add_assistant_message(
                            session_id=persisted_session_id,
                            content=msg,
                            parts=[{"type": "text", "content": msg}],
                        )
                    except Exception:
                        pass
                if sandbox_session_id and sandbox_service:
                    try:
                        await sandbox_service.stop(sandbox_session_id)
                    except Exception:
                        pass
                return

            # 处理响应
            tool_uses = []
            for block in response.content:
                block_type = _get_attr(block, "type")
                if block_type == "text":
                    text = _get_attr(block, "text")
                    yield {"type": "text", "content": text}
                    persisted_parts.append({"type": "text", "content": text})
                elif block_type == "tool_use":
                    tool_uses.append(block)

            if not tool_uses:
                break

            # 执行工具
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
                    "toolInput": tool_input.get("command")
                    if tool_name == "bash"
                    else json.dumps(tool_input),
                }

                persisted_parts.append(
                    {
                        "type": "tool",
                        "toolId": str(current_tool_index),
                        "toolName": tool_name or "tool",
                        "toolInput": tool_input.get("command")
                        if tool_name == "bash"
                        else json.dumps(tool_input),
                        "toolStatus": "running",
                    }
                )

                success = True
                output = ""

                if tool_name == "bash" and use_bash and sandbox_service:
                    exec_result = await sandbox_service.exec(
                        sandbox_session_id, tool_input.get("command", "")
                    )
                    if exec_result.get("success"):
                        output = exec_result.get("output", "")
                    else:
                        success = False
                        output = exec_result.get("error", "")
                else:
                    output = f"Unknown tool: {tool_name}"
                    success = False

                yield {
                    "type": "tool_end",
                    "toolId": current_tool_index,
                    "toolName": tool_name,
                    "output": output[:500],
                    "success": success,
                }

                # 更新持久化状态
                for i in range(len(persisted_parts) - 1, -1, -1):
                    p = persisted_parts[i]
                    if p.get("type") == "tool" and p.get("toolId") == str(
                        current_tool_index
                    ):
                        p["toolStatus"] = "completed" if success else "error"
                        p["toolOutput"] = output[:500]
                        break

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": _get_attr(tool, "id"),
                        "content": output,
                        "is_error": not success,
                    }
                )

            messages.append(
                {"role": "assistant", "content": _normalize_content(response.content)}
            )
            messages.append({"role": "user", "content": tool_results})

            if getattr(response, "stop_reason", None) == "end_turn":
                break

        # ========== 6. 保存结果、清理沙盒 ==========
        if should_persist and persisted_session_id:
            try:
                for p in persisted_parts:
                    if p.get("type") == "tool" and p.get("toolStatus") == "running":
                        p["toolStatus"] = "completed"
                final_content = "\n\n".join(
                    [
                        p.get("content", "")
                        for p in persisted_parts
                        if p.get("type") == "text"
                    ]
                ).strip()
                chat_service.add_assistant_message(
                    session_id=persisted_session_id,
                    content=final_content,
                    parts=persisted_parts,
                )
            except Exception:
                pass

        if use_bash and sandbox_service and sandbox_session_id:
            # 读取沙盒数据并更新数据库
            read_result = await sandbox_service.read(sandbox_session_id)
            if read_result.get("success"):
                if bash_tool["readonly"]:
                    yield {"type": "result", "success": True}
                else:
                    # 合并数据回数据库
                    if table_service and bash_tool["table_id"]:
                        try:
                            table = table_service.get_by_id(bash_tool["table_id"])
                            if table and table.data:
                                updated_data = merge_data_by_path(
                                    table.data,
                                    bash_tool["json_path"],
                                    read_result.get("data"),
                                )
                                table_service.repo.update_context_data(
                                    bash_tool["table_id"], updated_data
                                )
                                yield {
                                    "type": "result",
                                    "success": True,
                                    "updatedData": updated_data,
                                    "modifiedPath": bash_tool["json_path"],
                                }
                            else:
                                yield {"type": "result", "success": True}
                        except Exception as e:
                            logger.warning(f"[Agent] Failed to update table: {e}")
                            yield {"type": "result", "success": True}
                    else:
                        yield {"type": "result", "success": True}
            else:
                yield {
                    "type": "result",
                    "success": False,
                    "error": read_result.get("error"),
                }

            await sandbox_service.stop(sandbox_session_id)
        else:
            yield {"type": "result", "success": True}


# ========== 工具函数 ==========


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


def _default_anthropic_client():
    from anthropic import AsyncAnthropic

    api_key = settings.ANTHROPIC_API_KEY or None
    base_url = settings.ANTHROPIC_BASE_URL or None
    return AsyncAnthropic(api_key=api_key, base_url=base_url)


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

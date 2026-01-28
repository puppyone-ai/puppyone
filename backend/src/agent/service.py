"""
Agent Service - 简化版

前端只需要传 active_tool_ids，后端自动处理一切：
1. 根据 tool_id 查库获取 tool 配置
2. 如果是 bash tool，自动查表数据、启动沙盒
3. 构建 Claude 请求

支持的节点类型：
- folder: 递归获取子文件，在沙盒中重建目录结构
- json: 导出 content 为 data.json（可选 json_path 提取子数据）
- file/pdf/image/etc: 下载单个文件
"""
import json
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Iterable, Optional

from loguru import logger

from src.agent.schemas import AgentRequest
from src.config import settings
from src.agent.chat.service import ChatService
from src.agent.config.service import AgentConfigService

# Anthropic 官方 bash 工具
BASH_TOOL = {"type": "bash_20250124", "name": "bash"}


@dataclass
class SandboxFile:
    """沙盒中的文件"""
    path: str               # 沙盒中的路径，如 /workspace/data.json
    content: str | None = None      # 文本内容（JSON/文本文件）
    s3_key: str | None = None       # S3 key（二进制文件需要下载）
    content_type: str = "application/octet-stream"


@dataclass
class SandboxData:
    """沙盒数据"""
    files: list[SandboxFile] = field(default_factory=list)
    node_type: str = "json"
    root_node_id: str = ""
    root_node_name: str = ""
    # 用于多文件回写：node_id -> {sandbox_path, node_type}
    node_path_map: dict = field(default_factory=dict)


class AgentService:
    """Agent 核心逻辑"""

    def __init__(self, anthropic_client=None):
        self._anthropic = anthropic_client or _default_anthropic_client()

    async def stream_events(
        self,
        request: AgentRequest,
        current_user,
        node_service,  # ContentNodeService，用于获取 content_nodes 数据
        tool_service,
        sandbox_service,
        chat_service: Optional[ChatService] = None,
        s3_service=None,  # S3Service，用于下载文件
        agent_config_service: Optional[AgentConfigService] = None,  # 新版 agent 配置服务
        max_iterations: int = 15,
    ) -> AsyncGenerator[dict, None]:
        """
        处理 Agent 请求的主入口
        
        优先级：
        1. 如果有 agent_id，从 agent_access 表读取配置（新版）
        2. 否则，从 active_tool_ids 查 tool 表（旧版兼容）
        """
        
        # ========== 1. 解析配置，优先使用新版 agent_access ==========
        bash_tools: list[dict] = []  # [{node_id, json_path, readonly}, ...]
        
        logger.info(f"[Agent DEBUG] agent_id={request.agent_id}, active_tool_ids={request.active_tool_ids}")
        
        # 新版：如果有 agent_id，从 agent_access 表读取配置
        if request.agent_id and current_user and agent_config_service:
            try:
                agent = agent_config_service.get_agent(request.agent_id)
                if agent and agent.user_id == current_user.user_id:
                    logger.info(f"[Agent] Found agent config: id={agent.id}, accesses={len(agent.accesses)}")
                    # 收集所有有 terminal 权限的 access（支持多个）
                    for access in agent.accesses:
                        if access.terminal:
                            bash_tools.append({
                                "node_id": access.node_id,
                                "json_path": (access.json_path or "").strip(),
                                "readonly": access.terminal_readonly,
                            })
                            logger.info(f"[Agent] Found bash access from agent_access: node_id={access.node_id}")
                    logger.info(f"[Agent] Total bash accesses collected: {len(bash_tools)}")
                else:
                    logger.warning(f"[Agent] Agent not found or unauthorized: {request.agent_id}")
            except Exception as e:
                logger.warning(f"[Agent] Failed to get agent config: {e}")
        
        # 旧版兼容：如果没有从 agent_access 获取到配置，fallback 到 tool 表
        if len(bash_tools) == 0 and request.active_tool_ids and current_user and tool_service:
            logger.info(f"[Agent] Fallback to tool table for bash config")
            for tool_id in request.active_tool_ids:
                try:
                    tool = tool_service.get_by_id(tool_id)
                    logger.info(f"[Agent DEBUG] tool_id={tool_id}, tool={tool}")
                    if tool:
                        logger.info(f"[Agent DEBUG] tool.user_id={tool.user_id}, current_user.user_id={current_user.user_id}")
                        logger.info(f"[Agent DEBUG] tool.type={tool.type}, tool.node_id={tool.node_id}")
                    if tool and tool.user_id == current_user.user_id:
                        tool_type = (tool.type or "").strip()
                        if tool_type in ("shell_access", "shell_access_readonly"):
                            bash_tools.append({
                                "node_id": tool.node_id,
                                    "json_path": (tool.json_path or "").strip(),
                                    "readonly": tool_type == "shell_access_readonly",
                            })
                            logger.info(f"[Agent] Found bash tool from tool table: node_id={tool.node_id}")
                except Exception as e:
                    logger.warning(f"[Agent] Failed to get tool {tool_id}: {e}")
        
        # ========== 2. Chat persistence (best-effort) ==========
        persisted_session_id: str | None = None
        created_session = False
        should_persist = current_user is not None and chat_service is not None
        
        logger.info(f"[Chat Persist] should_persist={should_persist}, current_user={current_user is not None}, chat_service={chat_service is not None}")
        
        if should_persist:
            try:
                persisted_session_id, created_session = chat_service.ensure_session(
                    user_id=current_user.user_id,
                    session_id=request.session_id,
                    agent_id=request.agent_id,
                    mode="agent",
                )
                logger.info(f"[Chat Persist] Session ready: id={persisted_session_id}, created={created_session}")
                if created_session and persisted_session_id:
                    yield {"type": "session", "sessionId": persisted_session_id}
            except Exception as e:
                logger.error(f"[Chat Persist] Failed to ensure session: {e}")
                persisted_session_id = None
                should_persist = False

        # 加载历史消息
        messages: list[dict[str, Any]] = []
        if should_persist and persisted_session_id:
            try:
                history = chat_service.load_history_for_llm(
                    user_id=current_user.user_id, session_id=persisted_session_id, limit=60
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
                chat_service.add_user_message(session_id=persisted_session_id, content=request.prompt)
                logger.info(f"[Chat Persist] User message saved to session {persisted_session_id}")
                if created_session:
                    chat_service.maybe_set_title_on_first_message(
                        user_id=current_user.user_id,
                        session_id=persisted_session_id,
                        first_message=request.prompt,
                    )
            except Exception as e:
                logger.error(f"[Chat Persist] Failed to save user message: {e}")

        # ========== 3. 如果有 bash tools，准备沙盒数据、启动沙盒 ==========
        use_bash = len(bash_tools) > 0
        sandbox_data: SandboxData | None = None
        sandbox_session_id = None
        # 如果任意一个 access 不是 readonly，则整个沙盒不是 readonly
        sandbox_readonly = all(tool["readonly"] for tool in bash_tools) if bash_tools else True
        
        if use_bash and node_service and current_user:
            # 收集所有 bash access 的文件
            all_files: list[SandboxFile] = []
            primary_node_type = "folder"  # 默认类型
            primary_node_id = ""
            primary_node_name = ""
            # 追踪每个 node 对应的沙盒路径和类型，用于回写
            node_path_map: dict = {}  # {node_id: {path, node_type, json_path}}
            
            for i, tool in enumerate(bash_tools):
                try:
                    data = await prepare_sandbox_data(
                        node_service=node_service,
                        node_id=tool["node_id"],
                        json_path=tool["json_path"],
                        user_id=current_user.user_id,
                    )
                    logger.info(f"[Agent] Prepared sandbox data for access {i+1}/{len(bash_tools)}: "
                               f"node_id={tool['node_id']}, type={data.node_type}, files={len(data.files)}")
                    all_files.extend(data.files)
                    
                    # 记录路径映射（用于回写）
                    if data.files:
                        # 对于 JSON 和单文件，记录主文件路径
                        main_path = data.files[0].path
                        node_path_map[tool["node_id"]] = {
                            "path": main_path,
                            "node_type": data.node_type,
                            "json_path": tool["json_path"],
                            "readonly": tool["readonly"],
                        }
                    
                    # 第一个 access 决定主类型
                    if i == 0:
                        primary_node_type = data.node_type
                        primary_node_id = data.root_node_id
                        primary_node_name = data.root_node_name
                except Exception as e:
                    logger.warning(f"[Agent] Failed to prepare sandbox data for node {tool['node_id']}: {e}")
            
            sandbox_data = SandboxData(
                files=all_files,
                node_type=primary_node_type if len(bash_tools) == 1 else "multi",  # 多个时标记为 multi
                root_node_id=primary_node_id,
                root_node_name=primary_node_name,
                node_path_map=node_path_map,
            )
            logger.info(f"[Agent] Total sandbox files: {len(all_files)} from {len(bash_tools)} accesses, path_map={list(node_path_map.keys())}")

        if use_bash and sandbox_service:
            sandbox_session_id = f"agent-{int(time.time() * 1000)}"
            
            # 根据节点类型选择启动方式
            if sandbox_data and sandbox_data.node_type == "json" and len(bash_tools) == 1:
                # 单个 JSON 节点：使用现有的 data 参数
                json_content = {}
                if sandbox_data.files:
                    try:
                        json_content = json.loads(sandbox_data.files[0].content or "{}")
                    except:
                        json_content = {}
                start_result = await sandbox_service.start(
                    session_id=sandbox_session_id,
                    data=json_content,
                    readonly=sandbox_readonly,
                )
            else:
                # Folder/File/多个节点：使用 files 参数
                start_result = await sandbox_service.start_with_files(
                    session_id=sandbox_session_id,
                    files=sandbox_data.files if sandbox_data else [],
                    readonly=sandbox_readonly,
                    s3_service=s3_service,
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
        
        # 根据节点类型构建系统提示
        if use_bash and sandbox_data:
            node_type = sandbox_data.node_type
            if node_type == "json":
                system_prompt = "You are an AI agent specialized in JSON data processing. Use the bash tool to view and manipulate data in /workspace/data.json."
            elif node_type == "folder":
                system_prompt = "You are an AI agent with access to a file system. Use the bash tool to explore and manipulate files in /workspace/."
            elif node_type == "multi":
                system_prompt = "You are an AI agent with access to multiple files and folders. Use the bash tool to explore and manipulate files in /workspace/."
            else:
                system_prompt = f"You are an AI agent with access to a {node_type} file. Use the bash tool to analyze the file in /workspace/."
        else:
            system_prompt = "You are an AI agent, a helpful assistant."

        # 构建用户消息：如果使用 bash，添加数据上下文
        user_content = request.prompt
        if use_bash and sandbox_data:
            node_type = sandbox_data.node_type
            
            if node_type == "json" and len(bash_tools) == 1:
                json_path = bash_tools[0]["json_path"] or "/"
                context_prefix = (
                    f"[数据上下文]\n"
                    f"节点类型: JSON\n"
                    f"数据文件: /workspace/data.json\n"
                    f"JSON 路径: {json_path}\n"
                    f"权限: {'⚠️ 只读模式' if sandbox_readonly else '可读写模式'}\n"
                    f"[用户消息]\n"
                )
            elif node_type == "folder":
                context_prefix = (
                    f"[数据上下文]\n"
                    f"节点类型: 文件夹\n"
                    f"文件夹名: {sandbox_data.root_node_name}\n"
                    f"工作目录: /workspace/\n"
                    f"文件数量: {len(sandbox_data.files)}\n"
                    f"权限: {'⚠️ 只读模式' if sandbox_readonly else '可读写模式'}\n"
                    f"[用户消息]\n"
                )
            elif node_type == "multi":
                # 多个 access
                context_prefix = (
                    f"[数据上下文]\n"
                    f"节点类型: 多个文件/文件夹\n"
                    f"访问数量: {len(bash_tools)} 个\n"
                    f"工作目录: /workspace/\n"
                    f"文件数量: {len(sandbox_data.files)}\n"
                    f"权限: {'⚠️ 只读模式' if sandbox_readonly else '可读写模式'}\n"
                    f"[用户消息]\n"
                )
            else:
                # file/pdf/image 等
                file_name = sandbox_data.files[0].path.split("/")[-1] if sandbox_data.files else "file"
            context_prefix = (
                f"[数据上下文]\n"
                    f"节点类型: {node_type}\n"
                    f"文件名: {file_name}\n"
                    f"文件路径: /workspace/{file_name}\n"
                    f"权限: {'⚠️ 只读模式' if sandbox_readonly else '可读写模式'}\n"
                f"[用户消息]\n"
            )
            user_content = context_prefix + request.prompt
        
        messages.append({"role": "user", "content": user_content})

        # ========== 5. 调用 Claude (流式)，处理工具调用 ==========
        persisted_parts: list[dict[str, Any]] = []
        tool_index = 0
        iterations = 0

        while iterations < max_iterations:
            iterations += 1
            
            logger.info(f"[CLAUDE REQUEST] Iteration {iterations} (streaming)")
            logger.info(f"[CLAUDE DEBUG] system_prompt = {system_prompt}")
            logger.info(f"[CLAUDE DEBUG] tools = {json.dumps(tools, ensure_ascii=False)}")
            logger.info(f"[CLAUDE DEBUG] messages = {json.dumps(messages, ensure_ascii=False, default=str)[:2000]}")
            
            try:
                # ===== 流式调用 Claude =====
                current_text_content = ""
                tool_uses: list[dict[str, Any]] = []
                current_tool: dict[str, Any] | None = None
                current_tool_input_json = ""
                stop_reason = None
                response_content: list[Any] = []
                
                async with self._anthropic.messages.stream(
                    model=settings.ANTHROPIC_MODEL,
                    max_tokens=4096,
                    system=system_prompt,
                    tools=tools,
                    messages=messages,
                ) as stream:
                    async for event in stream:
                        event_type = getattr(event, "type", None)
                        
                        if event_type == "content_block_start":
                            block = getattr(event, "content_block", None)
                            block_type = getattr(block, "type", None) if block else None
                            
                            if block_type == "text":
                                current_text_content = ""
                            elif block_type == "tool_use":
                                current_tool = {
                                    "id": getattr(block, "id", ""),
                                    "name": getattr(block, "name", ""),
                                    "input": {},
                                }
                                current_tool_input_json = ""
                        
                        elif event_type == "content_block_delta":
                            delta = getattr(event, "delta", None)
                            delta_type = getattr(delta, "type", None) if delta else None
                            
                            if delta_type == "text_delta":
                                text = getattr(delta, "text", "")
                                if text:
                                    current_text_content += text
                                    # 实时 yield 每个文本片段！
                                    yield {"type": "text_delta", "content": text}
                            
                            elif delta_type == "input_json_delta":
                                partial_json = getattr(delta, "partial_json", "")
                                if partial_json:
                                    current_tool_input_json += partial_json
                        
                        elif event_type == "content_block_stop":
                            if current_text_content:
                                # 文本块结束，保存完整文本
                                persisted_parts.append({"type": "text", "content": current_text_content})
                                response_content.append({"type": "text", "text": current_text_content})
                                current_text_content = ""
                            
                            if current_tool:
                                # 工具块结束，解析 JSON 输入
                                try:
                                    current_tool["input"] = json.loads(current_tool_input_json) if current_tool_input_json else {}
                                except json.JSONDecodeError:
                                    current_tool["input"] = {"raw": current_tool_input_json}
                                
                                tool_uses.append(current_tool)
                                response_content.append({
                                    "type": "tool_use",
                                    "id": current_tool["id"],
                                    "name": current_tool["name"],
                                    "input": current_tool["input"],
                                })
                                current_tool = None
                                current_tool_input_json = ""
                        
                        elif event_type == "message_delta":
                            delta = getattr(event, "delta", None)
                            if delta:
                                stop_reason = getattr(delta, "stop_reason", None)
                
                logger.info(f"[CLAUDE RESPONSE] Iteration {iterations}: stop_reason={stop_reason}, tool_uses={len(tool_uses)}")
                
            except Exception as e:
                msg = str(e)
                logger.error(f"[CLAUDE ERROR] {msg}")
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

            # 没有工具调用，结束循环
            if not tool_uses:
                break

            # 执行工具
            tool_results = []
            for tool in tool_uses:
                current_tool_index = tool_index
                tool_index += 1
                tool_name = tool.get("name", "")
                tool_input = tool.get("input", {})
                
                yield {
                    "type": "tool_start",
                    "toolId": current_tool_index,
                    "toolName": tool_name,
                    "toolInput": tool_input.get("command") if tool_name == "bash" else json.dumps(tool_input),
                }
                
                persisted_parts.append({
                    "type": "tool",
                    "toolId": str(current_tool_index),
                    "toolName": tool_name or "tool",
                    "toolInput": tool_input.get("command") if tool_name == "bash" else json.dumps(tool_input),
                    "toolStatus": "running",
                })

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
                    if p.get("type") == "tool" and p.get("toolId") == str(current_tool_index):
                        p["toolStatus"] = "completed" if success else "error"
                        p["toolOutput"] = output[:500]
                        break

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool.get("id", ""),
                    "content": output,
                    "is_error": not success,
                })

            messages.append({"role": "assistant", "content": response_content})
            messages.append({"role": "user", "content": tool_results})
            
            if stop_reason == "end_turn":
                break

        # ========== 6. 保存结果、清理沙盒 ==========
        logger.info(f"[Chat Persist] Attempting to save assistant message: should_persist={should_persist}, session_id={persisted_session_id}, parts_count={len(persisted_parts)}")
        if should_persist and persisted_session_id:
            try:
                for p in persisted_parts:
                    if p.get("type") == "tool" and p.get("toolStatus") == "running":
                        p["toolStatus"] = "completed"
                final_content = "\n\n".join(
                    [p.get("content", "") for p in persisted_parts if p.get("type") == "text"]
                ).strip()
                logger.info(f"[Chat Persist] Saving assistant message: content_length={len(final_content)}, parts={persisted_parts}")
                chat_service.add_assistant_message(
                    session_id=persisted_session_id, content=final_content, parts=persisted_parts
                )
                logger.info(f"[Chat Persist] Assistant message saved successfully!")
            except Exception as e:
                logger.error(f"[Chat Persist] Failed to save assistant message: {e}")
        else:
            logger.warning(f"[Chat Persist] Skipping assistant message save: should_persist={should_persist}, session_id={persisted_session_id}")

        if use_bash and sandbox_service and sandbox_session_id:
            # 回写修改的数据到数据库
            updated_nodes = []
            
            if sandbox_data and sandbox_data.node_path_map and node_service and current_user:
                # 遍历所有非只读的 access，回写数据
                for node_id, info in sandbox_data.node_path_map.items():
                    if info.get("readonly"):
                        continue  # 跳过只读的
                    
                    node_type = info.get("node_type", "")
                    sandbox_path = info.get("path", "")
                    json_path = info.get("json_path", "")
                    
                    # 只回写 JSON 类型的节点
                    if node_type != "json":
                        logger.info(f"[Agent] Skipping write-back for non-JSON node: {node_id} (type={node_type})")
                        continue
                    
                    try:
                        # 从沙盒读取文件
                        read_result = await sandbox_service.read_file(
                            sandbox_session_id, 
                            sandbox_path, 
                            parse_json=True
                        )
                        
                        if not read_result.get("success"):
                            logger.warning(f"[Agent] Failed to read file from sandbox: {sandbox_path}")
                            continue
                        
                        sandbox_content = read_result.get("content")
                        
                        # 获取原节点数据
                        node = node_service.get_by_id(node_id, current_user.user_id)
                        if not node:
                            continue
                        
                        # 合并数据（如果有 json_path）
                        if json_path:
                            updated_data = merge_data_by_path(
                                node.content or {}, json_path, sandbox_content
                            )
                        else:
                            updated_data = sandbox_content
                        
                        # 写回数据库
                        node_service.update_node(
                            node_id=node_id,
                            user_id=current_user.user_id,
                            content=updated_data,
                        )
                        
                        updated_nodes.append({
                            "nodeId": node_id,
                            "nodeName": node.name,
                            "modifiedPath": json_path,
                        })
                        logger.info(f"[Agent] Successfully wrote back data to node: {node_id}")
                        
                    except Exception as e:
                        logger.warning(f"[Agent] Failed to write back data for node {node_id}: {e}")
            
            # 返回结果
            if updated_nodes:
                yield {
                    "type": "result",
                    "success": True,
                    "updatedNodes": updated_nodes,
                }
            else:
                yield {"type": "result", "success": True}
            
            await sandbox_service.stop(sandbox_session_id)
        else:
            yield {"type": "result", "success": True}


# ========== 工具函数 ==========

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
    - file/pdf/image/etc: 单个文件信息
    """
    node = node_service.get_by_id(node_id, user_id)
    if not node:
        raise ValueError(f"Node not found: {node_id}")
    
    logger.info(f"[prepare_sandbox_data] node.id={node.id}, type={node.type}, name={node.name}")
    
    files: list[SandboxFile] = []
    node_type = node.type or "json"
    
    if node_type == "json":
        # JSON 节点：导出 content 为 data.json
        content = node.content or {}
        if json_path:
            content = extract_data_by_path(content, json_path)
        
        files.append(SandboxFile(
            path="/workspace/data.json",
            content=json.dumps(content, ensure_ascii=False, indent=2),
            content_type="application/json",
        ))
        logger.info(f"[prepare_sandbox_data] JSON node, content size={len(str(content))}")
        
    elif node_type == "folder":
        # Folder 节点：递归获取所有子文件
        # 使用 list_descendants 获取所有子孙节点
        children = node_service.list_descendants(node.project_id, node_id)
        logger.info(f"[prepare_sandbox_data] Folder node, children count={len(children)}")
        
        for child in children:
            if child.type == "folder":
                continue  # 跳过子文件夹本身，只处理文件
            
            # 计算相对路径
            relative_path = child.id_path.replace(node.id_path, "").lstrip("/")
            if not relative_path:
                relative_path = child.name
            
            if child.type == "json":
                # JSON 子节点：导出为 .json 文件
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}.json",
                    content=json.dumps(child.content or {}, ensure_ascii=False, indent=2),
                    content_type="application/json",
                ))
            elif child.s3_key:
                # 其他文件类型：记录 S3 key，由沙盒服务下载
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}",
                    s3_key=child.s3_key,
                    content_type=child.mime_type or "application/octet-stream",
                ))
    else:
        # 其他文件类型（pdf, image, file 等）
        file_name = node.name or "file"
        
        if node_type == "json" or node.content:
            # 如果有 content，导出为 JSON
            files.append(SandboxFile(
                path=f"/workspace/{file_name}",
                content=json.dumps(node.content, ensure_ascii=False, indent=2) if isinstance(node.content, (dict, list)) else str(node.content or ""),
                content_type="application/json" if isinstance(node.content, (dict, list)) else "text/plain",
            ))
        elif node.s3_key:
            # S3 文件
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
            normalized.append({
                "type": "tool_use",
                "id": _get_attr(block, "id"),
                "name": _get_attr(block, "name"),
                "input": _get_attr(block, "input"),
            })
    return normalized

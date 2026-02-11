"""
Agent Service - 简化版

前端只需要传 active_tool_ids，后端自动处理一切：
1. 根据 tool_id 查库获取 tool 配置
2. 如果是 bash tool，自动查表数据、启动沙盒
3. 如果是 search tool，注册到 Claude 并直接调用 SearchService
4. 构建 Claude 请求

支持的节点类型：
- folder: 递归获取子文件，在沙盒中重建目录结构
- json: 导出 content 为 data.json（可选 json_path 提取子数据）
- file/pdf/image/etc: 下载单个文件

支持的工具类型：
- bash (sandbox): 通过 agent_bash 配置，数据沙盒执行
- search: 通过 agent_tool 关联，向量检索（Turbopuffer）
"""
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Iterable, Optional

from loguru import logger

from src.agent.schemas import AgentRequest
from src.config import settings
from src.agent.chat.service import ChatService
from src.agent.config.service import AgentConfigService
from src.analytics.service import log_context_access, log_bash_execution
import time as time_module  # For latency tracking

# Anthropic 官方 bash 工具（Computer Use 格式，仅官方 API 支持）
BASH_TOOL_NATIVE = {"type": "bash_20250124", "name": "bash"}

# 通用 bash 工具定义（兼容第三方代理网关）
BASH_TOOL_COMPAT = {
    "name": "bash",
    "description": (
        "Execute a bash command in the sandbox environment. "
        "Use this to run shell commands, view files, manipulate data, etc. "
        "Returns the command output (stdout and stderr combined)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The bash command to execute",
            }
        },
        "required": ["command"],
    },
}


def _use_native_anthropic() -> bool:
    """判断是否使用 Anthropic 官方 API（非第三方代理）"""
    base_url = settings.ANTHROPIC_BASE_URL
    if not base_url:
        return True
    return "api.anthropic.com" in base_url


def _get_bash_tool() -> dict:
    """根据 API 端点选择合适的 bash tool 定义"""
    if _use_native_anthropic():
        return BASH_TOOL_NATIVE
    return BASH_TOOL_COMPAT


def _sanitize_tool_name(name: str) -> str:
    """将工具名称转换为 Claude 兼容的格式 (仅 a-zA-Z0-9_-)"""
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    # 去掉首尾的下划线并去重连续下划线
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    return sanitized or "unnamed"


@dataclass
class SearchToolConfig:
    """Agent 关联的 Search Tool 配置"""
    tool_id: str           # tool 表的 ID
    node_id: str           # 绑定的 content_node ID
    json_path: str         # JSON 路径
    project_id: str        # 项目 ID
    node_type: str         # 节点类型（folder / json / markdown 等）
    name: str              # 工具原始名称
    description: str       # 工具描述
    claude_tool_name: str  # 注册到 Claude 的工具名称


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

    async def execute_task_sync(
        self,
        agent_id: str,
        task_content: str,
        user_id: str,
        node_service,
        sandbox_service,
        s3_service=None,
        agent_config_service=None,
        max_iterations: int = 15,
    ) -> dict:
        """
        非流式执行 Agent 任务（用于 Schedule Agent）
        
        复用 stream_events 的核心逻辑，但不需要流式输出和聊天历史。
        
        Args:
            agent_id: Agent ID
            task_content: 任务内容（来自 agent.task_content）
            user_id: 用户 ID（agent 的 owner）
            node_service: ContentNodeService
            sandbox_service: SandboxService
            s3_service: S3Service（可选）
            agent_config_service: AgentConfigService
            max_iterations: 最大迭代次数
            
        Returns:
            dict with execution results
        """
        import time
        from src.config import settings
        
        result = {
            "status": "success",
            "output_summary": "",
            "tool_calls": [],
            "updated_nodes": [],
        }
        
        try:
            # ========== 1. 获取 Agent 配置 ==========
            if not agent_config_service:
                return {"status": "failed", "error": "agent_config_service is required"}
            
            agent = agent_config_service.get_agent(agent_id)
            if not agent:
                return {"status": "failed", "error": f"Agent not found: {agent_id}"}
            
            # 通过 project 验证权限
            if not agent_config_service.verify_access(agent_id, user_id):
                return {"status": "failed", "error": "Unauthorized access to agent"}
            
            logger.info(f"[ScheduleAgent] Executing agent: {agent.name} (id={agent_id})")
            
            # ========== 2. 收集 bash tools ==========
            bash_tools: list[dict] = []
            for access in agent.accesses:
                if access.terminal:
                    bash_tools.append({
                        "node_id": access.node_id,
                        "json_path": (access.json_path or "").strip(),
                        "readonly": access.terminal_readonly,
                    })
                    logger.info(f"[ScheduleAgent] Found bash access: node_id={access.node_id}")
            
            use_bash = len(bash_tools) > 0
            sandbox_readonly = all(tool["readonly"] for tool in bash_tools) if bash_tools else True
            
            # ========== 3. 准备沙盒数据 ==========
            sandbox_data: SandboxData | None = None
            sandbox_session_id = None
            node_path_map: dict = {}
            
            if use_bash and node_service:
                all_files: list[SandboxFile] = []
                primary_node_type = "folder"
                primary_node_id = ""
                primary_node_name = ""
                
                for i, tool in enumerate(bash_tools):
                    try:
                        data = await prepare_sandbox_data(
                            node_service=node_service,
                            node_id=tool["node_id"],
                            json_path=tool["json_path"],
                            user_id=user_id,
                        )
                        logger.info(f"[ScheduleAgent] Prepared sandbox data: node_id={tool['node_id']}, files={len(data.files)}")
                        all_files.extend(data.files)
                        
                        if data.files:
                            main_path = data.files[0].path
                            node_path_map[tool["node_id"]] = {
                                "path": main_path,
                                "node_type": data.node_type,
                                "json_path": tool["json_path"],
                                "readonly": tool["readonly"],
                            }
                        
                        if i == 0:
                            primary_node_type = data.node_type
                            primary_node_id = data.root_node_id
                            primary_node_name = data.root_node_name
                    except Exception as e:
                        logger.warning(f"[ScheduleAgent] Failed to prepare sandbox data: {e}")
                
                sandbox_data = SandboxData(
                    files=all_files,
                    node_type=primary_node_type if len(bash_tools) == 1 else "multi",
                    root_node_id=primary_node_id,
                    root_node_name=primary_node_name,
                    node_path_map=node_path_map,
                )
            
            # ========== 4. 启动沙盒 ==========
            if use_bash and sandbox_service:
                sandbox_session_id = f"schedule-{int(time.time() * 1000)}"
                
                if sandbox_data and sandbox_data.node_type == "json" and len(bash_tools) == 1:
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
                    start_result = await sandbox_service.start_with_files(
                        session_id=sandbox_session_id,
                        files=sandbox_data.files if sandbox_data else [],
                        readonly=sandbox_readonly,
                        s3_service=s3_service,
                    )
                
                if not start_result.get("success"):
                    return {"status": "failed", "error": start_result.get("error", "Failed to start sandbox")}
                
                logger.info(f"[ScheduleAgent] Sandbox started: {sandbox_session_id}")
            
            # ========== 5. 构建 Claude 请求 ==========
            tools: list[dict[str, Any]] = [_get_bash_tool()] if use_bash else []
            
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
            
            # 构建用户消息
            user_content = task_content
            if use_bash and sandbox_data:
                mode_str = "⚠️ 只读模式" if sandbox_readonly else "✏️ 可读写模式"
                context_prefix = (
                    f"[数据上下文]\n"
                    f"工作目录: /workspace/\n"
                    f"文件数量: {len(sandbox_data.files)}\n"
                    f"权限: {mode_str}\n"
                    f"[任务]\n"
                )
                user_content = context_prefix + task_content
            
            messages = [{"role": "user", "content": user_content}]
            
            # ========== 6. 调用 Claude (非流式循环) ==========
            iterations = 0
            all_text_outputs = []
            
            while iterations < max_iterations:
                iterations += 1
                logger.info(f"[ScheduleAgent] Claude iteration {iterations}")
                
                try:
                    # 构建 API 调用参数（tools 为空时不传递，避免代理网关兼容问题）
                    create_kwargs: dict[str, Any] = {
                        "model": settings.ANTHROPIC_MODEL,
                        "max_tokens": 4096,
                        "system": system_prompt,
                        "messages": messages,
                    }
                    if tools:
                        create_kwargs["tools"] = tools
                    
                    response = await self._anthropic.messages.create(**create_kwargs)
                    
                    stop_reason = response.stop_reason
                    content_blocks = response.content
                    
                    # 处理响应内容
                    tool_uses = []
                    response_content = []
                    
                    for block in content_blocks:
                        block_type = getattr(block, "type", None)
                        if block_type == "text":
                            text = getattr(block, "text", "")
                            all_text_outputs.append(text)
                            response_content.append({"type": "text", "text": text})
                        elif block_type == "tool_use":
                            tool_uses.append({
                                "id": getattr(block, "id", ""),
                                "name": getattr(block, "name", ""),
                                "input": getattr(block, "input", {}),
                            })
                            response_content.append({
                                "type": "tool_use",
                                "id": getattr(block, "id", ""),
                                "name": getattr(block, "name", ""),
                                "input": getattr(block, "input", {}),
                            })
                    
                    logger.info(f"[ScheduleAgent] Claude response: stop_reason={stop_reason}, tool_uses={len(tool_uses)}")
                    
                    # 没有工具调用，结束
                    if not tool_uses:
                        break
                    
                    # 执行工具
                    tool_results = []
                    for tool in tool_uses:
                        tool_name = tool.get("name", "")
                        tool_input = tool.get("input", {})
                        
                        if tool_name == "bash" and use_bash and sandbox_service:
                            command = tool_input.get("command", "")
                            logger.info(f"[ScheduleAgent] Executing bash: {command[:100]}")
                            
                            # Track execution time
                            exec_start = time_module.time()
                            exec_result = await sandbox_service.exec(sandbox_session_id, command)
                            exec_latency = int((time_module.time() - exec_start) * 1000)
                            
                            if exec_result.get("success"):
                                output = exec_result.get("output", "")
                                result["tool_calls"].append({
                                    "command": command,
                                    "output": output[:500],
                                    "success": True,
                                })
                                # Log bash execution
                                await log_bash_execution(
                                    command=command,
                                    agent_id=request.agent_id,
                                    session_id=request.session_id,
                                    sandbox_session_id=sandbox_session_id,
                                    success=True,
                                    output=output,
                                    latency_ms=exec_latency,
                                )
                            else:
                                output = exec_result.get("error", "")
                                result["tool_calls"].append({
                                    "command": command,
                                    "output": output[:500],
                                    "success": False,
                                })
                                # Log failed bash execution
                                await log_bash_execution(
                                    command=command,
                                    agent_id=request.agent_id,
                                    session_id=request.session_id,
                                    sandbox_session_id=sandbox_session_id,
                                    success=False,
                                    error_message=output,
                                    latency_ms=exec_latency,
                                )
                        else:
                            output = f"Unknown tool: {tool_name}"
                        
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool.get("id", ""),
                            "content": output,
                        })
                    
                    messages.append({"role": "assistant", "content": response_content})
                    messages.append({"role": "user", "content": tool_results})
                    
                    if stop_reason == "end_turn":
                        break
                        
                except Exception as e:
                    logger.error(f"[ScheduleAgent] Claude error: {e}")
                    result["status"] = "failed"
                    result["error"] = str(e)
                    break
            
            # ========== 7. 回写数据到数据库 ==========
            if use_bash and sandbox_service and sandbox_session_id and not sandbox_readonly:
                if sandbox_data and sandbox_data.node_path_map and node_service:
                    for node_id, info in sandbox_data.node_path_map.items():
                        if info.get("readonly"):
                            continue
                        
                        node_type = info.get("node_type", "")
                        sandbox_path = info.get("path", "")
                        json_path_config = info.get("json_path", "")
                        
                        if node_type not in ("json", "markdown"):
                            continue
                        
                        try:
                            parse_json = (node_type == "json")
                            read_result = await sandbox_service.read_file(
                                sandbox_session_id, sandbox_path, parse_json=parse_json
                            )
                            
                            if not read_result.get("success"):
                                continue
                            
                            sandbox_content = read_result.get("content")
                            node = node_service.get_by_id_unsafe(node_id)
                            if not node:
                                continue
                            
                            if node_type == "json":
                                if json_path_config:
                                    updated_data = merge_data_by_path(
                                        node.preview_json or {}, json_path_config, sandbox_content
                                    )
                                else:
                                    updated_data = sandbox_content
                                
                                node_service.update_node(
                                    node_id=node_id,
                                    project_id=node.project_id,
                                    preview_json=updated_data,
                                )
                            elif node_type == "markdown":
                                await node_service.update_markdown_content(
                                    node_id=node_id,
                                    project_id=node.project_id,
                                    content=sandbox_content,
                                )
                            
                            result["updated_nodes"].append({
                                "nodeId": node_id,
                                "nodeName": node.name,
                            })
                            logger.info(f"[ScheduleAgent] Wrote back data to node: {node_id}")
                            
                        except Exception as e:
                            logger.warning(f"[ScheduleAgent] Failed to write back: {e}")
                
                # 停止沙盒
                await sandbox_service.stop(sandbox_session_id)
                logger.info(f"[ScheduleAgent] Sandbox stopped")
            elif sandbox_session_id and sandbox_service:
                await sandbox_service.stop(sandbox_session_id)
            
            # ========== 8. 返回结果 ==========
            result["output_summary"] = "\n".join(all_text_outputs)[:2000]
            logger.info(f"[ScheduleAgent] Execution completed: {result['status']}")
            return result
            
        except Exception as e:
            logger.error(f"[ScheduleAgent] Execution failed: {e}")
            return {"status": "failed", "error": str(e)}

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
        search_service=None,  # SearchService，用于 search tool 执行
        max_iterations: int = 15,
    ) -> AsyncGenerator[dict, None]:
        """
        处理 Agent 请求的主入口
        
        支持的工具类型：
        1. bash (sandbox) — 通过 agent_bash 配置
        2. search — 通过 agent_tool 关联的 search 类型工具
        """
        
        # ========== 1. 解析配置，优先使用新版 agent_access ==========
        bash_tools: list[dict] = []  # [{node_id, json_path, readonly}, ...]
        
        logger.info(f"[Agent DEBUG] agent_id={request.agent_id}, active_tool_ids={request.active_tool_ids}, user_id={current_user.user_id if current_user else None}")
        
        # 新版：如果有 agent_id，从 agent_bash 表读取配置
        if request.agent_id and current_user and agent_config_service:
            try:
                agent = agent_config_service.get_agent(request.agent_id)
                logger.info(f"[Agent DEBUG] Got agent: {agent.id if agent else None}, project_id={agent.project_id if agent else None}")
                
                # 验证权限：通过 project_id 检查用户是否有权限访问此 Agent
                # 注意：Agent 模型没有 user_id 字段，需要通过 project 表验证
                has_access = False
                if agent:
                    has_access = agent_config_service.verify_access(request.agent_id, current_user.user_id)
                    logger.info(f"[Agent DEBUG] Access check: has_access={has_access}")
                
                if agent and has_access:
                    logger.info(f"[Agent] Found agent config: id={agent.id}, bash_accesses={len(agent.bash_accesses)}")
                    # 收集所有 Bash 访问权限（新版架构下所有 bash_accesses 都是终端访问）
                    for bash in agent.bash_accesses:
                        bash_tools.append({
                            "node_id": bash.node_id,
                            "json_path": (bash.json_path or "").strip(),
                            "readonly": bash.readonly,
                        })
                        logger.info(f"[Agent] Found bash access from agent_bash: node_id={bash.node_id}")
                    logger.info(f"[Agent] Total bash accesses collected: {len(bash_tools)}")
                else:
                    logger.warning(f"[Agent] Agent not found or unauthorized: agent_id={request.agent_id}, has_access={has_access}")
            except Exception as e:
                logger.warning(f"[Agent] Failed to get agent config: {e}", exc_info=True)
        
        # NOTE: Legacy fallback to tool table for shell_access has been removed.
        # Shell/bash access is now managed exclusively via agent_bash table.
        # See architecture: agents → agent_bash (data access) + agent_tool (tool bindings)
        
        # ========== 1b. 收集 Search Tools（从 agent_tool 绑定） ==========
        search_tools_map: dict[str, SearchToolConfig] = {}  # {claude_tool_name: SearchToolConfig}
        
        if request.agent_id and current_user and agent_config_service and tool_service and search_service:
            try:
                agent_for_tools = agent_config_service.get_agent(request.agent_id)
                
                if agent_for_tools and agent_for_tools.tools:
                    used_names: set[str] = set()
                    for agent_tool_binding in agent_for_tools.tools:
                        if not agent_tool_binding.enabled:
                            continue
                        
                        # 从 tool 表加载完整信息
                        tool_info = tool_service.get_by_id(agent_tool_binding.tool_id)
                        if not tool_info or tool_info.type != "search":
                            continue
                        
                        # 获取节点信息以确定搜索类型
                        try:
                            node = node_service.get_by_id_unsafe(tool_info.node_id)
                            if not node:
                                continue
                        except Exception:
                            continue
                        
                        # 生成 Claude 兼容的工具名称（避免冲突）
                        base_name = _sanitize_tool_name(tool_info.name)
                        claude_name = f"search_{base_name}"
                        if claude_name in used_names:
                            claude_name = f"search_{base_name}_{tool_info.id[:8]}"
                        used_names.add(claude_name)
                        
                        search_tools_map[claude_name] = SearchToolConfig(
                            tool_id=tool_info.id,
                            node_id=tool_info.node_id,
                            json_path=tool_info.json_path or "",
                            project_id=tool_info.project_id or node.project_id,
                            node_type=node.type or "json",
                            name=tool_info.name,
                            description=tool_info.description or f"Search in {tool_info.name}",
                            claude_tool_name=claude_name,
                        )
                        logger.info(f"[Agent] Loaded search tool: {claude_name} (tool_id={tool_info.id}, node_type={node.type})")
                    
                    if search_tools_map:
                        logger.info(f"[Agent] Total search tools: {len(search_tools_map)}")
            except Exception as e:
                logger.warning(f"[Agent] Failed to load search tools: {e}", exc_info=True)
        
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
                # 如果是新建的 session，先设置 title，再通知前端
                if created_session and persisted_session_id:
                    try:
                        chat_service.maybe_set_title_on_first_message(
                            user_id=current_user.user_id,
                            session_id=persisted_session_id,
                            first_message=request.prompt,
                        )
                        logger.info(f"[Chat Persist] Session title set for {persisted_session_id}")
                    except Exception as e:
                        logger.warning(f"[Chat Persist] Failed to set session title: {e}")
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
                    
                    # Log context access (data egress tracking)
                    await log_context_access(
                        node_id=tool["node_id"],
                        node_type=data.node_type,
                        node_name=data.root_node_name,
                        user_id=current_user.user_id if current_user else None,
                        agent_id=request.agent_id,
                        session_id=request.session_id,
                    )
                    
                    # 记录路径映射（用于回写和显示）
                    if data.files:
                        # 对于 JSON 和单文件，记录主文件路径
                        main_path = data.files[0].path
                        node_path_map[tool["node_id"]] = {
                            "path": main_path,
                            "node_type": data.node_type,
                            "json_path": tool["json_path"],
                            "readonly": tool["readonly"],
                        }
                    else:
                        # 空文件夹也记录，使用文件夹名作为路径
                        node_path_map[tool["node_id"]] = {
                            "path": f"/workspace/{data.root_node_name}" if data.root_node_name else "/workspace/(empty folder)",
                            "node_type": data.node_type,
                            "json_path": tool["json_path"],
                            "readonly": tool["readonly"],
                            "is_empty": True,
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
        tools: list[dict[str, Any]] = [_get_bash_tool()] if use_bash else []
        
        # 注册 Search Tools 到 Claude
        for claude_name, stc in search_tools_map.items():
            tools.append({
                "name": claude_name,
                "description": stc.description,
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query text",
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "Number of results to return (default 5, max 20)",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            })
        
        use_search = len(search_tools_map) > 0
        
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

        # 如果有 search tools，在系统提示中补充说明
        if use_search:
            search_tool_descriptions = []
            for claude_name, stc in search_tools_map.items():
                search_tool_descriptions.append(
                    f"  - {claude_name}: {stc.description} (data source: {stc.name})"
                )
            search_prompt_suffix = (
                "\n\n[Available Search Tools]\n"
                "You have access to the following search tools for semantic retrieval:\n"
                + "\n".join(search_tool_descriptions) +
                "\nUse these tools when the user asks questions about the data. "
                "Pass a natural language query to search for relevant information."
            )
            system_prompt += search_prompt_suffix

        # 构建用户消息：如果使用 bash，添加数据上下文
        user_content = request.prompt
        if use_bash and sandbox_data:
            node_type = sandbox_data.node_type
            node_path_map = sandbox_data.node_path_map or {}
            
            # 生成详细的权限清单
            def build_access_list() -> str:
                lines = []
                for tool in bash_tools:
                    path_info = node_path_map.get(tool["node_id"], {})
                    path = path_info.get("path", "/workspace/(unknown)")
                    mode = "👁️ View Only" if tool["readonly"] else "✏️ Editable"
                    is_empty = path_info.get("is_empty", False)
                    suffix = " 📁 (empty folder)" if is_empty else ""
                    lines.append(f"  - {path} ({mode}){suffix}")
                return "\n".join(lines) if lines else "  - /workspace/ (unknown)"
            
            if node_type == "json" and len(bash_tools) == 1:
                json_path = bash_tools[0]["json_path"] or "/"
                mode_str = "⚠️ 只读模式 - 修改不会被保存" if sandbox_readonly else "✏️ 可读写模式"
                context_prefix = (
                    f"[数据上下文]\n"
                    f"节点类型: JSON\n"
                    f"数据文件: /workspace/data.json\n"
                    f"JSON 路径: {json_path}\n"
                    f"权限: {mode_str}\n"
                    f"[用户消息]\n"
                )
            elif node_type == "folder" and len(bash_tools) == 1:
                mode_str = "⚠️ 只读模式 - 修改不会被保存" if sandbox_readonly else "✏️ 可读写模式"
                context_prefix = (
                    f"[数据上下文]\n"
                    f"节点类型: 文件夹\n"
                    f"文件夹名: {sandbox_data.root_node_name}\n"
                    f"工作目录: /workspace/\n"
                    f"文件数量: {len(sandbox_data.files)}\n"
                    f"权限: {mode_str}\n"
                    f"[用户消息]\n"
                )
            elif node_type == "multi" or len(bash_tools) > 1:
                # 多个 access - 显示详细权限清单
                access_list = build_access_list()
                context_prefix = (
                    f"[数据上下文]\n"
                    f"工作目录: /workspace/\n"
                    f"总文件数: {len(sandbox_data.files)}\n\n"
                    f"📂 可访问的资源:\n"
                    f"{access_list}\n\n"
                    f"⚠️ 重要提示:\n"
                    f"  - 只有上述路径的内容会被保存\n"
                    f"  - /workspace/ 根目录不能创建新文件\n"
                    f"  - View Only 路径的修改不会被持久化\n"
                    f"[用户消息]\n"
                )
            else:
                # file/pdf/image 等单个文件
                file_name = sandbox_data.files[0].path.split("/")[-1] if sandbox_data.files else "file"
                mode_str = "⚠️ 只读模式 - 修改不会被保存" if sandbox_readonly else "✏️ 可读写模式"
                context_prefix = (
                    f"[数据上下文]\n"
                    f"节点类型: {node_type}\n"
                    f"文件名: {file_name}\n"
                    f"文件路径: /workspace/{file_name}\n"
                    f"权限: {mode_str}\n"
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
                
                # 构建 API 调用参数（tools 为空时不传递，避免代理网关兼容问题）
                stream_kwargs: dict[str, Any] = {
                    "model": settings.ANTHROPIC_MODEL,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": messages,
                }
                if tools:
                    stream_kwargs["tools"] = tools
                
                async with self._anthropic.messages.stream(**stream_kwargs) as stream:
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
                    command = tool_input.get("command", "")
                    
                    # Track execution time
                    exec_start = time_module.time()
                    exec_result = await sandbox_service.exec(sandbox_session_id, command)
                    exec_latency = int((time_module.time() - exec_start) * 1000)
                    
                    if exec_result.get("success"):
                        output = exec_result.get("output", "")
                        # Log bash execution
                        await log_bash_execution(
                            command=command,
                            user_id=current_user.user_id if current_user else None,
                            agent_id=request.agent_id,
                            session_id=persisted_session_id,  # Use chat session id
                            sandbox_session_id=sandbox_session_id,
                            success=True,
                            output=output,
                            latency_ms=exec_latency,
                        )
                    else:
                        success = False
                        output = exec_result.get("error", "")
                        # Log failed bash execution
                        await log_bash_execution(
                            command=command,
                            user_id=current_user.user_id if current_user else None,
                            agent_id=request.agent_id,
                            session_id=persisted_session_id,
                            sandbox_session_id=sandbox_session_id,
                            success=False,
                            error_message=output,
                            latency_ms=exec_latency,
                        )
                elif tool_name in search_tools_map and search_service:
                    # ===== Search Tool 执行 =====
                    stc = search_tools_map[tool_name]
                    query = tool_input.get("query", "")
                    top_k = tool_input.get("top_k", 5)
                    
                    exec_start = time_module.time()
                    try:
                        if stc.node_type == "folder":
                            results = await search_service.search_folder(
                                project_id=stc.project_id,
                                folder_node_id=stc.node_id,
                                query=query,
                                top_k=top_k,
                            )
                        else:
                            results = await search_service.search_scope(
                                project_id=stc.project_id,
                                node_id=stc.node_id,
                                tool_json_path=stc.json_path,
                                query=query,
                                top_k=top_k,
                            )
                        exec_latency = int((time_module.time() - exec_start) * 1000)
                        output = json.dumps(results, ensure_ascii=False, indent=2)
                        success = True
                        logger.info(
                            f"[Agent] Search tool executed: {tool_name}, query='{query}', "
                            f"results={len(results)}, latency={exec_latency}ms"
                        )
                    except Exception as e:
                        exec_latency = int((time_module.time() - exec_start) * 1000)
                        output = f"Search error: {str(e)}"
                        success = False
                        logger.error(f"[Agent] Search tool failed: {tool_name}, error={e}, latency={exec_latency}ms")
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
                    
                    # 支持回写的节点类型：json, markdown
                    if node_type not in ("json", "markdown"):
                        logger.info(f"[Agent] Skipping write-back for unsupported node type: {node_id} (type={node_type})")
                        continue
                    
                    try:
                        # 从沙盒读取文件
                        # JSON 文件需要解析，markdown 文件保持原样
                        parse_json = (node_type == "json")
                        read_result = await sandbox_service.read_file(
                            sandbox_session_id, 
                            sandbox_path, 
                            parse_json=parse_json
                        )
                        
                        if not read_result.get("success"):
                            logger.warning(f"[Agent] Failed to read file from sandbox: {sandbox_path}")
                            continue
                        
                        sandbox_content = read_result.get("content")
                        
                        # 获取原节点数据（内部操作，权限已通过 access points 验证）
                        node = node_service.get_by_id_unsafe(node_id)
                        if not node:
                            continue
                        
                        # 根据节点类型选择不同的更新方式
                        if node_type == "json":
                            # JSON 类型：合并数据（如果有 json_path）
                            if json_path:
                                updated_data = merge_data_by_path(
                                    node.preview_json or {}, json_path, sandbox_content
                                )
                            else:
                                updated_data = sandbox_content
                            
                            # 写回数据库（preview_json 字段）
                            node_service.update_node(
                                node_id=node_id,
                                project_id=node.project_id,
                                preview_json=updated_data,
                            )
                        elif node_type == "markdown":
                            # markdown 类型：上传到 S3
                            await node_service.update_markdown_content(
                                node_id=node_id,
                                project_id=node.project_id,
                                content=sandbox_content,
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
    - github_repo: 从 S3 目录下载所有文件（单节点模式）
    - file/pdf/image/etc: 单个文件信息
    """
    # 内部操作，权限已通过 access points 验证
    node = node_service.get_by_id_unsafe(node_id)
    if not node:
        raise ValueError(f"Node not found: {node_id}")
    
    logger.info(f"[prepare_sandbox_data] node.id={node.id}, type={node.type}, name={node.name}")
    
    files: list[SandboxFile] = []
    node_type = node.type or "json"
    
    if node_type == "github_repo":
        # GitHub Repo 节点（单节点模式）：从 preview_json.files 读取文件列表
        # 每个文件都有 s3_key，用于从 S3 下载
        content = node.preview_json or {}
        file_list = content.get("files", [])
        repo_name = content.get("repo", node.name or "repo")
        
        logger.info(f"[prepare_sandbox_data] GitHub repo node, file_count={len(file_list)}")
        
        for file_info in file_list:
            file_path = file_info.get("path", "")
            s3_key = file_info.get("s3_key", "")
            
            if not file_path or not s3_key:
                continue
            
            # 保持 repo 内的目录结构
            files.append(SandboxFile(
                path=f"/workspace/{repo_name}/{file_path}",
                s3_key=s3_key,
                content_type="text/plain",  # GitHub 文件都是文本
            ))
    
    elif node_type == "json":
        # JSON 节点：导出 preview_json 为 data.json
        content = node.preview_json or {}
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
        
        # 构建 id -> node 映射，用于计算名称路径
        # 包含根节点和所有子孙节点
        id_to_node: dict[str, Any] = {node.id: node}
        for child in children:
            id_to_node[child.id] = child
        
        def build_name_path(target_node) -> str:
            """根据 parent_id 链构建名称路径（从根文件夹下一级开始）"""
            path_parts = []
            current = target_node
            while current and current.id != node.id:
                path_parts.append(current.name)
                if current.parent_id and current.parent_id in id_to_node:
                    current = id_to_node[current.parent_id]
                else:
                    break
            path_parts.reverse()
            return "/".join(path_parts)
        
        for child in children:
            if child.type == "folder":
                continue  # 跳过子文件夹本身，只处理文件
            
            # 使用文件名构建相对路径（而非 UUID）
            relative_path = build_name_path(child)
            if not relative_path:
                relative_path = child.name
            
            if child.type == "json":
                # JSON 子节点：导出为 .json 文件
                files.append(SandboxFile(
                    path=f"/workspace/{relative_path}.json",
                    content=json.dumps(child.preview_json or {}, ensure_ascii=False, indent=2),
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
        # 其他文件类型（pdf, image, file, markdown, sync 等）
        file_name = node.name or "file"
        
        if node.preview_json and isinstance(node.preview_json, (dict, list)):
            # 如果有 JSON content，导出为 JSON
            files.append(SandboxFile(
                path=f"/workspace/{file_name}.json",
                content=json.dumps(node.preview_json, ensure_ascii=False, indent=2),
                content_type="application/json",
            ))
        elif node.s3_key:
            # S3 文件（markdown, image, pdf 等）
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

"""
Backward-compatibility shim — 代码已迁移至以下位置：

- agent/config/    Agent 配置 CRUD (agents / agent_bash / agent_tool)
- agent/chat/      Agent 聊天 (SSE 流式对话) + 核心编排
- agent/mcp/       MCP 协议运行时 (工具绑定 & 代理转发)
- sync/providers/openclaw/  OpenClaw CLI 同步 (连接管理 + 文件夹双向同步)

本目录仅保留 re-export 以兼容旧 import 路径。
"""

"""
L3 Access Layer — 统一接入层

所有外部（和内部 Agent）访问都通过此层管理，按类型分为：

- config/     共享的 Access Point 配置 CRUD（agents / agent_bash / agent_tool）
- chat/       PuppyOne 内置 Agent (SSE 流式对话)
- mcp/        MCP 协议运行时（工具绑定 & 代理转发）
- openclaw/   OpenClaw 文件夹同步运行时（CLI connect / push / pull）
"""

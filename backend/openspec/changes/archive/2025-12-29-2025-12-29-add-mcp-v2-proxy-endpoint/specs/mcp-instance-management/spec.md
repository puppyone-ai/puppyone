# mcp-instance-management (delta)

## ADDED Requirements
### Requirement: MCP v2 通过代理端点访问共享 MCP Service
系统 SHALL 提供 MCP v2 的代理访问端点，使客户端可仅凭 `mcp_v2.api_key` 访问共享 `mcp_service` 的 MCP 协议接口（如 `tools/list`、`tools/call`）；代理端点 SHALL 负责基本拦截与转发，并注入 `X-API-KEY` 以实现多租户隔离。

#### Scenario: 通过 mcp_v2 代理端点访问 tools/list
- **GIVEN** 存在启用状态的 `mcp_v2` 实例，且已绑定至少一个启用的 Tool
- **WHEN** 客户端调用 `POST /api/v1/mcp_v2/server/{api_key}` 并发送 MCP JSON-RPC `tools/list`
- **THEN** 代理端点将请求转发到共享 `mcp_service`（下游 `/mcp/*`）
- **AND** 代理端点在下游请求头中注入 `X-API-KEY={api_key}`
- **AND** 客户端获得由绑定 Tool 生成的工具列表

#### Scenario: mcp_v2 被禁用时代理端点拒绝访问
- **GIVEN** `mcp_v2.status=false`
- **WHEN** 客户端调用 `POST /api/v1/mcp_v2/server/{api_key}`
- **THEN** 系统返回 NOT_FOUND（或等价的“实例不可用”错误）
- **AND** 请求不会被转发到下游 `mcp_service`



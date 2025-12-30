## ADDED Requirements

### Requirement: 查询 MCP v2 已绑定 Tool 列表（REST）
系统 SHALL 提供对外 REST 接口，用于查询某个 `mcp_v2` 实例当前绑定的 Tool 列表；返回的工具集合 SHALL 以 `mcp_binding` 作为数据来源，并与“disabled 不暴露工具”的语义保持一致（默认仅返回 enabled 绑定）。

#### Scenario: 通过 api_key 查询绑定工具列表（默认仅 enabled）
- **GIVEN** 存在启用状态的 `mcp_v2` 实例，且其 `mcp_binding` 中存在 enabled 与 disabled 的绑定
- **WHEN** 客户端请求 `GET /api/v1/mcp/{api_key}/tools`
- **THEN** 系统返回该 `api_key` 对应 `mcp_v2` 的已绑定 Tool 列表
- **AND** 返回列表仅包含 `mcp_binding.status=true` 的 Tool
- **AND** 每条记录包含 `tool_id` 与工具最小可识别信息（至少 `name/type`），以及绑定信息（至少 `binding_id/binding_status`）

#### Scenario: 通过 api_key 查询绑定工具列表（显式包含 disabled）
- **GIVEN** 存在启用状态的 `mcp_v2` 实例，且其 `mcp_binding` 中存在 enabled 与 disabled 的绑定
- **WHEN** 客户端请求 `GET /api/v1/mcp/{api_key}/tools?include_disabled=true`
- **THEN** 系统返回该 `api_key` 对应 `mcp_v2` 的已绑定 Tool 列表
- **AND** 返回列表同时包含 `mcp_binding.status=true/false` 的 Tool

#### Scenario: 通过 mcp_id 查询绑定工具列表（需要登录 + 所有权校验）
- **GIVEN** 当前用户已登录
- **AND** 存在 `mcp_v2.id=10` 且其 `user_id` 属于当前用户
- **WHEN** 客户端请求 `GET /api/v1/mcp/id/10/tools`
- **THEN** 系统返回该 `mcp_v2` 的绑定 Tool 列表（默认仅 enabled，规则同 api_key 查询）

#### Scenario: api_key 不存在时返回 NOT_FOUND
- **GIVEN** 客户端提供的 `api_key` 不存在于 `mcp_v2` 表
- **WHEN** 客户端请求 `GET /api/v1/mcp/{api_key}/tools`
- **THEN** 系统返回 NOT_FOUND（或等价的“实例不存在”错误）



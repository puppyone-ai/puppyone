# mcp-instance-management (delta)

## ADDED Requirements
### Requirement: 创建 MCP v2 并批量绑定 Tool（原子）
系统 SHALL 提供一个原子化接口，用于在创建 MCP v2 实例的同时批量绑定多个 Tool；当任一 Tool 绑定失败时，系统 SHALL 回滚本次创建的 MCP v2 实例与已创建的绑定关系，避免产生“空入口/半绑定”的中间态。

#### Scenario: 创建 MCP v2 并批量绑定成功
- **GIVEN** 当前用户已创建多个 Tool，且这些 Tool 均归属于该用户
- **WHEN** 用户调用 `POST /mcp_v2/with_bindings` 并提供 `name` 以及 `bindings=[{tool_id,status}, ...]`
- **THEN** 系统创建一条新的 `mcp_v2` 记录（含 `api_key`）
- **AND** 系统为列表中的每个 `tool_id` 创建或更新 `mcp_binding(mcp_id, tool_id)` 记录并设置对应 `status`
- **AND** 返回包含 `mcp_v2.id` 与 `api_key` 的响应

#### Scenario: Tool 不存在或不属于当前用户时整体失败并回滚
- **GIVEN** 请求的 `bindings` 中包含一个不存在的 `tool_id`，或包含一个归属其他用户的 `tool_id`
- **WHEN** 用户调用 `POST /mcp_v2/with_bindings`
- **THEN** 系统返回 NOT_FOUND（或等价的业务错误）
- **AND** 系统 SHALL 不保留本次创建的 `mcp_v2` 记录
- **AND** 系统 SHALL 不保留本次已创建的任何 `mcp_binding` 记录

#### Scenario: 同一 MCP v2 内 Tool.name 冲突时整体失败并回滚
- **GIVEN** 请求的 `bindings` 中包含两个 Tool 且它们的 `tool.name` 相同
- **WHEN** 用户调用 `POST /mcp_v2/with_bindings`
- **THEN** 系统返回 VALIDATION_ERROR（或等价的业务错误，包含冲突的 `tool.name`）
- **AND** 系统 SHALL 不保留本次创建的 `mcp_v2` 记录
- **AND** 系统 SHALL 不保留本次已创建的任何 `mcp_binding` 记录



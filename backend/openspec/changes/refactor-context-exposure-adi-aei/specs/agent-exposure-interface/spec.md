## ADDED Requirements
### Requirement: AEI 抽象分发渠道并支持 MCP（阶段 1）
系统 SHALL 提供 AEI（Agent Exposure Interface）抽象，用于将一组 ADI 对外暴露；阶段 1 SHALL 支持 AEI 类型 `mcp`。

#### Scenario: 创建一个 AEI(MCP)
- **GIVEN** 用户已登录并具备创建分发入口的权限
- **WHEN** 用户创建一个 AEI，指定 `type="mcp"` 与 `name`
- **THEN** 系统生成可用于访问该 AEI 的 `api_key`
- **AND** 该 AEI 记录 `user_id` 与 `status`

#### Scenario: AEI(MCP) 的工具清单来自绑定信息
- **GIVEN** 一个 AEI(MCP) 已绑定多个 ADI（见 `context-exposure-bundles`）
- **WHEN** MCP Server 请求 `list_tools`
- **THEN** 系统返回的 tools MUST 等于该 AEI 绑定的 tool 集合

#### Scenario: AEI(MCP) 的 call_tool 通过绑定路由到 ADI
- **GIVEN** AEI(MCP) 中存在 tool `name="foo_query"`，其绑定指向某个 `operation_type="query_data"` 的 ADI
- **WHEN** MCP 客户端调用 `foo_query` 并传入 arguments
- **THEN** 系统 MUST 将该调用路由到绑定的 ADI 执行
- **AND** 返回 ADI 的执行结果

### Requirement: v2 AEI(MCP) 的 api_key 鉴权边界为 bindings（阶段 1）
系统 SHALL 将 v2 AEI(MCP) 的 `api_key` 视为“暴露入口凭据”，其可访问/可操作的范围由该 `api_key` 关联的 bindings 列表决定，而不是由 `api_key` payload 编码的 `table_id/json_path` 决定。

#### Scenario: api_key 不编码 table/json_path 仍可正确工作
- **GIVEN** 一个 v2 AEI(MCP) 的 api_key 不包含 table_id/json_path 信息（例如随机字符串）
- **AND** 该 AEI 绑定了两个指向不同 table/json_path 的 ADI
- **WHEN** MCP Server 使用该 api_key 执行 list_tools 与 call_tool
- **THEN** list_tools 返回来自 bindings 的工具集合
- **AND** call_tool 的作用域与权限由 bindings 决定

### Requirement: AEI(MCP) 与现有代理入口兼容（阶段 1）
系统 SHALL 在阶段 1 维持现有 MCP 访问体验（通过 proxy 访问共享 MCP Server），并在不破坏 legacy 的前提下引入 AEI(MCP)。

#### Scenario: legacy MCP instance 仍可被正常访问
- **GIVEN** 已存在 legacy `mcp_instance`（单 Context）并且 status=1
- **WHEN** 客户端通过现有 proxy 入口访问 MCP
- **THEN** list_tools/call_tool 行为保持不变



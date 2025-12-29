# mcp-tool-management Specification

## Purpose
TBD - created by archiving change 2025-12-28-refactor-mcp-tools-and-bindings. Update Purpose after archive.
## Requirements
### Requirement: Tool 实体（ADI）数据持久化
系统 SHALL 支持将 Tool（ADI）作为独立实体持久化存储，用于描述“对某个 Context（table_id + json_path）的一类操作（type）”的展示与执行配置。

#### Scenario: 创建 Tool（绑定 Context + type）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户创建一个 Tool，并提供 `table_id`、`json_path`、`type`、`name`、`description`、`input_schema`（可选 `output_schema`、`metadata`、`alias`）
- **THEN** 系统在 `tool` 表中写入对应记录
- **AND** 返回包含 `tool.id` 的 Tool 记录
 - **AND** Tool SHALL 绑定到当前 `user_id`

#### Scenario: 查询 Tool 列表
- **GIVEN** `tool` 表中存在多条 Tool 记录
- **WHEN** 用户按 owner（user_id 或 project_id，取决于最终归属方案）查询 Tool 列表
- **THEN** 系统仅返回用户有权限管理的 Tool 记录

#### Scenario: 更新 Tool 展示配置
- **GIVEN** `tool` 表中存在 `tool.id=1`
- **WHEN** 用户更新该 Tool 的 `name/alias/description/input_schema/output_schema/metadata`
- **THEN** 系统保存更新后的 Tool 配置
- **AND** 不改变该 Tool 的执行语义（除非更新了 `type/table_id/json_path`）

### Requirement: MCP 与 Tool 的绑定关系（mcp_binding）
系统 SHALL 支持通过 `mcp_binding` 表将多个 Tool 绑定到同一个 MCP 实例，并支持对绑定关系启用/禁用。

#### Scenario: 绑定 Tool 到 MCP 实例
- **GIVEN** 存在 `mcp.id=10` 与 `tool.id=1`
- **WHEN** 用户将 `tool.id=1` 绑定到 `mcp.id=10`
- **THEN** 系统在 `mcp_binding` 表中创建记录（`mcp_id=10, tool_id=1`）
- **AND** 绑定默认状态为 enabled（或显式设置）
- **AND** 同一 `(mcp_id, tool_id)` SHALL 保持唯一

#### Scenario: 禁用绑定关系后不再暴露工具
- **GIVEN** `mcp_binding(mcp_id=10, tool_id=1)` 处于 enabled
- **WHEN** 用户将该绑定状态设置为 disabled
- **THEN** MCP 工具列表中不再返回该 Tool
- **AND** MCP call_tool 对该 Tool 的调用 SHALL 返回“未启用/未注册”的明确错误

### Requirement: MCP 运行时工具列表由绑定关系决定
系统 SHALL 以 `mcp_binding`（enabled）作为 MCP 运行时工具列表的唯一来源，而非从 MCP 实例字段推导。

#### Scenario: MCP list_tools 返回多 Context 的工具集合
- **GIVEN** 一个 `mcp.id=10` 绑定了两个 Tool，且它们指向不同的 `(table_id, json_path)`
- **WHEN** MCP 客户端调用 `list_tools`
- **THEN** 系统返回两条工具定义
- **AND** 每条工具的 `name/description/inputSchema` 来自 Tool 实体

### Requirement: Tool 执行通过通用数据访问层完成
系统 SHALL 将 Tool.type 映射到通用执行路径（例如 Table context 的 schema/data CRUD/query），Tool 的执行逻辑只负责调用该访问层并进行必要的参数适配。

#### Scenario: 执行 query_data 类型 Tool
- **GIVEN** Tool.type 为 `query_data` 且 Tool 指向 `table_id/json_path`
- **WHEN** MCP 客户端 call_tool 并提供 `query`
- **THEN** 系统对该 `table_id/json_path` 执行 JMESPath 查询并返回结果

#### Scenario: 执行 create 类型 Tool
- **GIVEN** Tool.type 为 `create` 且 Tool 指向 `table_id/json_path`
- **WHEN** MCP 客户端 call_tool 并提供 `elements`
- **THEN** 系统在该挂载点创建元素并返回操作结果

### Requirement: Tool 名称冲突策略
系统 SHALL 定义并强制执行 Tool 的名称冲突策略，以保证 MCP 的 `call_tool(name)` 路由确定性；系统 SHALL 保证同一 MCP 实例（mcp_v2）内绑定的 Tool.name 唯一。

#### Scenario: 同一 MCP 内 Tool.name 冲突
- **GIVEN** `mcp.id=10` 已绑定 Tool A，且 Tool A.name = `query_orders`
- **WHEN** 用户尝试再绑定 Tool B，且 Tool B.name 也为 `query_orders`
- **THEN** 系统 SHALL 拒绝该绑定
- **AND** 返回可理解的冲突错误信息

#### Scenario: 修改已绑定 Tool.name 触发冲突时应拒绝更新
- **GIVEN** Tool A 已绑定到 `mcp_v2.id=10`，且在该 mcp_v2 内已存在 Tool B.name=`query_orders`
- **WHEN** 用户尝试将 Tool A.name 更新为 `query_orders`
- **THEN** 系统 SHALL 拒绝该更新
- **AND** 返回可理解的冲突错误信息（包含冲突的 mcp_v2 范围）

### Requirement: preview/select 显式化与默认行为
系统 SHALL 将 `preview` 与 `select` 作为独立的 Tool.type；系统 SHALL 将 `preview_keys` 下沉到 Tool.metadata；当 preview 未配置 preview_keys 时，其行为 SHALL 等价于 get_all。

#### Scenario: preview 未配置 preview_keys 时等价 get_all
- **GIVEN** Tool.type 为 `preview` 且 Tool.metadata 未配置 `preview_keys`
- **WHEN** MCP 客户端 call_tool 执行该 Tool
- **THEN** 系统返回与 get_all 等价的数据（同一 `table_id/json_path` 的完整数据）

#### Scenario: preview 配置 preview_keys 时返回精简字段
- **GIVEN** Tool.type 为 `preview`
- **AND** Tool.metadata.preview_keys = ["id","title"]
- **WHEN** MCP 客户端 call_tool 执行该 Tool
- **THEN** 系统仅返回指定字段的轻量数据

### Requirement: 按 table_id 查询 Tool 列表
系统 SHALL 支持按 `table_id` 查询当前用户在该 table 下的所有 Tool 实体。

#### Scenario: 查询某个 table_id 下的 Tool 列表（成功）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户请求 `GET /tools/by-table/{table_id}`
- **THEN** 系统返回该用户在此 `table_id` 下的 Tool 列表（可能为空）

#### Scenario: 查询某个 table_id 下的 Tool 列表（无权限/不存在）
- **GIVEN** 目标 `table_id` 不存在或当前用户无权限访问
- **WHEN** 用户请求 `GET /tools/by-table/{table_id}`
- **THEN** 系统返回 NOT_FOUND（与 table 权限校验保持一致的错误语义）


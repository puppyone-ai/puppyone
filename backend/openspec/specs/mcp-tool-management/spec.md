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

#### Scenario: 执行 search 类型 Tool
- **GIVEN** Tool.type 为 `search` 且 Tool 指向 `table_id/json_path`
- **WHEN** MCP 客户端 call_tool 并提供 `query` 与可选 `top_k`
- **THEN** 系统 SHALL 在该 Tool.scope 内执行检索并返回结构化结果
- **AND** 系统不应要求除 `query/top_k` 之外的其它输入参数才能完成检索
- **AND** 返回结果 SHALL 包含命中 chunk 的完整信息与定位信息（至少包含 `table_id/json_pointer/chunk_text/char_start/char_end/chunk_index/total_chunks/content_hash`）
- **AND** 返回结果中的 `json_path`（若返回该字段）SHALL 适配为 Search Tool 视角下、相对于 `tool.json_path` 的路径

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

### Requirement: Search Tool 异步索引构建与状态轮询
系统 SHALL 支持以“快速返回 + 异步 indexing”的方式创建 Search Tool，并提供对外轮询接口查询索引构建状态；索引构建状态 SHALL 持久化在独立的索引任务状态表（例如 `search_index_task`）中。

#### Scenario: 异步创建 Search Tool（快速返回）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户通过异步创建接口创建 `type=search` 的 Tool
- **THEN** 系统创建并返回 Tool 记录（HTTP 201）
- **AND** 系统 SHALL 在后台异步触发 indexing（chunking + embedding + upsert）
- **AND** 系统 SHALL 创建一条索引任务状态记录，并将其 status 初始设置为 pending 或 indexing

#### Scenario: 轮询 Search Tool 索引构建状态
- **GIVEN** 存在 `type=search` 的 Tool，且系统为其维护索引任务状态记录
- **WHEN** 客户端调用轮询接口查询该 Tool 的索引构建状态
- **THEN** 系统返回索引任务状态（至少包含 status 字段）
- **AND** 当 indexing 成功时，status=ready 且包含 indexed_at/*_count
- **AND** 当 indexing 失败或超时时，status=error 且包含 last_error

### Requirement: Tool.type 支持 search（检索工具）
系统 SHALL 支持 `Tool.type=search`，用于对 Tool.scope 内的大文本 chunks 执行检索，并返回结构化结果。

#### Scenario: 创建 search 类型 Tool（成功）
- **GIVEN** 当前用户有权限访问目标 `table_id`
- **WHEN** 用户创建 `Tool.type=search`
- **THEN** 系统在 `tool` 表中写入对应记录（含 `table_id/json_path/type/name/...`）
- **AND** Tool 的执行语义 SHALL 被定义为“检索”（而非 CRUD/query_data）

#### Scenario: search Tool 的配置通过 metadata 扩展（成功）
- **GIVEN** `tool` 表包含 `metadata`（JSONB）
- **WHEN** 用户创建或更新 `Tool.type=search`
- **THEN** 系统 SHOULD 将 search 的索引配置与状态写入 `tool.metadata.search_index`（最小侵入）
- **AND** 系统 SHOULD 在 `tool.metadata.search_index` 中包含可用于排障的字段（例如 chunks 数量、最后一次索引时间、失败原因）


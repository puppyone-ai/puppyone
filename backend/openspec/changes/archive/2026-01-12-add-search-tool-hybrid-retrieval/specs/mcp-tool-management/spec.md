# mcp-tool-management Specification (Delta)

## ADDED Requirements

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

## MODIFIED Requirements

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


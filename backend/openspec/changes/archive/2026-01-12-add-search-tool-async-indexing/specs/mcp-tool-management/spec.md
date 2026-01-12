## ADDED Requirements

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


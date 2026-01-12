# Change: Add async indexing for Search Tool creation

## Why
当前 `POST /api/v1/tools` 在 `type=search` 时会同步执行 chunking + embedding + upsert，可能导致创建 Tool 接口耗时过长并触发超时；且部分异常被吞掉，缺少日志，线上排障困难。

## What Changes
- 新增一个“快速创建 Search Tool 并异步触发 indexing”的对外接口，确保创建请求快速返回
- 新增一个对外轮询接口，用于查询 Search Tool 的索引构建状态（基于独立的 `search_index_task` 状态表）
- 索引构建状态不再复用 `tool.metadata`（避免 jsonb 覆盖/丢更新风险，状态与工具配置解耦）
- 补齐异常日志：对 indexing 相关 best-effort 更新失败、indexing 执行失败均记录结构化日志（含 tool_id/table_id/json_path/user_id）

## Impact
- Affected specs: `openspec/specs/mcp-tool-management/spec.md`
- Affected code:
  - `src/tool/router.py`（新增接口 + 日志 + 调整 search indexing 触发方式）
  - （可能新增）`src/tool/schemas.py`（轮询接口的输出 schema）
  - `src/search/service.py`（复用既有 `index_scope`，不改变其语义）
  - `sql/`（新增 `search_index_task` 表及 migration）


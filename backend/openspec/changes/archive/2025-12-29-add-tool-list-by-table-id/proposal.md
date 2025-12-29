# Change: Tool API 新增按 table_id 查询 Tool 列表路由

## Why
前端/调用方需要基于某个 `table_id` 快速获取其下所有 `Tool` 实体，用于工具管理与绑定（例如 MCP v2 binding）相关流程。目前仅提供按当前用户列出全部 Tool 的接口，缺少按 table 维度的查询入口。

## What Changes
- 新增一个只读路由：`GET /tools/by-table/{table_id}`，返回当前用户在该 `table_id` 下的所有 Tool。
- 保持既有 CRUD 行为不变；新增路由复用现有权限校验逻辑（table 必须属于当前用户）。

## Impact
- Affected specs: `openspec/specs/mcp-tool-management/spec.md`
- Affected code:
  - `src/tool/router.py`
  - `src/tool/service.py`
  - `src/tool/repository.py`
  - `src/supabase/repository.py`
  - `src/supabase/tools/repository.py`
  - `tests/`（新增或更新相关 API 测试）



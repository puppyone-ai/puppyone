# Change: Add MCP v2 bound tools list endpoint

## Why
当前系统已经支持通过 `mcp_binding` 将多个 `tool` 绑定到同一个 `mcp_v2` 实例，并由绑定关系决定 MCP 运行时工具列表；但缺少一个直接的 REST 查询入口，用于在不走 MCP JSON-RPC 的情况下快速查看“某个 MCP server（mcp_v2）当前绑定了哪些 tools”。

## What Changes
- 新增 2 个对外 REST 路由，用于返回指定 `mcp_v2` 的 `tool_list`：
  - `GET /api/v1/mcp/{api_key}/tools`：按 `api_key` 查询绑定工具列表（不要求登录，仅凭 api_key）。
  - `GET /api/v1/mcp/id/{mcp_id}/tools`：按 `mcp_v2.id` 查询绑定工具列表（要求登录且校验所有权）。
- 默认只返回 `mcp_binding.status=true` 的工具（与“disabled 不暴露工具”的语义保持一致）；可通过可选参数显式包含 disabled。

## Impact
- **AFFECTED specs**
  - `openspec/specs/mcp-tool-management/spec.md`（新增一个对外查询 bound tools 的要求）
- **AFFECTED code (implementation stage)**
  - `src/mcp_v2/router.py`（新增路由）
  - `src/mcp_v2/service.py`（新增查询方法：按 mcp_id 拉取绑定 + tool）
  - `src/mcp_v2/schemas.py`（新增或复用输出 schema：包含 binding + tool 信息）
  - `src/supabase/repository.py`（复用已有 `get_mcp_v2` / `get_mcp_v2_by_api_key` / `get_mcp_bindings_by_mcp_id`）

## Non-Goals
- 不改变 MCP JSON-RPC `tools/list` 的既有行为与返回结构。
- 不引入新的存储表或迁移。

## Assumptions (to confirm)
- “通过 mcp server 找到有哪些 tools”的数据来源为主服务数据库的 `mcp_binding + tool`（而非实时向 `mcp_service` 发送 MCP `tools/list` 请求）。

## Open Questions
- 返回字段范围：是否需要返回完整 Tool 配置（例如 `alias/description/input_schema/output_schema/metadata`），还是仅返回 `tool_id + name/type + (table_id/json_path) + binding_status` 即可？
- 是否需要默认包含 disabled 绑定用于管理面板？本提案默认仅返回 enabled，并提供参数 `include_disabled=true` 显式包含 disabled。



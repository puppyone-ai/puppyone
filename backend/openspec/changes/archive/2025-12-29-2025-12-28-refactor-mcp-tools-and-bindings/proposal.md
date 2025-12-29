# Change: Refactor MCP tool execution via Tool entity + MCP bindings

## Why
当前 Context 分发方式（对 `table.data` 的某个 `json_path` 子树做 CRUD / query / schema）与 MCP Server 深度绑定，导致分发入口被锁死在 MCP、单实例无法跨 Context、工具难以治理与复用。

## What Changes
- **引入 Tool 实体（ADI）**：把原先 `mcp.tools_definition/register_tools/preview_keys + table_id/json_path` 的强耦合配置，抽成独立的 `tool` 表记录（每条 Tool 对应一个 Context + 一种操作方式）。
- **引入 MCP Binding（AEI→ADI 绑定）**：新增 `mcp_binding` 表，用于将多个 Tool 绑定到同一个 MCP Server 实例，并支持启用/禁用。
- **引入 MCP v2 实例模型（去 Context 化）**：新增 `mcp_v2` 表，MCP v2 实例不再直接持有 `table_id/json_path/tools_definition/register_tools/preview_keys`，仅代表一个可被访问的“分发入口”（AEI），并通过 `mcp_binding` 绑定 Tool。
- **工具执行与展示分离**：
  - Tool 的展示（name/alias/description/input_schema/output_schema）由 Tool 实体决定。
  - Tool 的执行由“通用数据访问层（TableService/internal endpoints）+ ToolType 映射器”完成。
- **internal 通信升级为“按 MCP 拉取工具列表”**：`mcp_service` 仍通过 internal API 拉取配置，但返回结构将从“单 Context 配置”变为“多 Tool 绑定配置”。
 - **preview/select 显式化**：`preview`/`select` 将作为独立 Tool.type；`preview_keys` 下沉到 Tool.metadata。未配置 `preview_keys` 时，preview 行为等价于 get_all。

## Impact
- **AFFECTED specs**
  - `specs/mcp-instance-management/spec.md`（**MODIFIED / REMOVED**：MCP 实例字段与外键约束语义变化）
  - **NEW** `specs/mcp-tool-management/spec.md`（**ADDED**：Tool/Binding 实体与执行契约）
- **AFFECTED code (implementation stage)**
  - 主服务：`src/mcp/`, `src/internal/`, `src/supabase/*`
  - MCP 服务：`mcp_service/`（配置加载、工具列表构建、工具调用分发）
  - 数据访问：`src/table/`
- **BREAKING**
  - `POST /api/v1/mcp/` 的入参与语义将变化：创建 MCP 实例不再绑定单个 `table_id/json_path`，工具与 Context 通过 Tool + Binding 配置完成。
  - `GET /internal/mcp-instance/{api_key}` 的返回结构将变化（或被新的 internal 端点替代）。

## Success Criteria (User Experience)
- 可以为每个特定 Context（`table_id + json_path`）配置一组 Tool（不同 type、不同展示名/描述/schema/metadata）。
- 可以将不同 Context 的 Tool 绑定到同一个 MCP Server 实例上；通过同一个 MCP Server 即可跨 Context 获取/操作数据。

## Assumptions (to confirm)
- Tool 的“所有权/隔离”以 **user_id** 为主（允许同一 user 跨 project 绑定其可访问的任意 table/json_path），MCP v2 实例也以 user_id 作为隔离边界。
- `mcp_service` 与主服务继续使用 **internal HTTP（X-Internal-Secret）** 通信；不引入新的消息队列/直连 DB。

## Open Questions
- 迁移策略：是否需要一段时间 **兼容旧字段**（mcp 表保留旧列但不再使用），还是一次性删列并全量迁移？
 - tool 名称冲突的交互：当同一 `mcp_v2` 内发生 `tool.name` 冲突时，阻止“绑定”还是阻止“创建/更新 Tool.name”？



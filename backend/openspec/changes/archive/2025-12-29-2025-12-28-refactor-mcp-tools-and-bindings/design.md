## Context
当前系统中：
- 主服务（FastAPI）通过 `src/mcp/` 管理 MCP 实例，并通过 `src/internal/router.py` 提供 internal API 给 `mcp_service` 拉取配置与执行 Table context 操作。
- `mcp_service`（Starlette + MCP Python SDK）会在 `list_tools` / `call_tool` 中按 `api_key` 拉取 MCP 实例配置，进而把固定的 `table_id/json_path` 注入到工具调用中。

现状关键耦合点：
- `mcp` 实例同时承担了 **AEI（入口/暴露）** 与 **ADI（针对某 Context 的操作定义）** 两种职责。
- 结果是一个 `api_key` 只能覆盖单一 `table_id + json_path`，无法通过一个入口跨 Context 组合/治理工具。

## Goals / Non-Goals
### Goals
- 抽象出 **Tool（ADI）** 与 **MCP Instance（AEI）** 的独立实体边界。
- 允许一个 MCP 实例绑定多个 Tool，从而在一个 MCP Server 上跨 Context 暴露多个工具。
- Tool 的展示与执行解耦：展示来自 Tool 的 schema/描述；执行通过统一的数据访问层完成。

### Non-Goals
- 本阶段不引入新的分发入口（如 CLI/Agent Skills）实现；仅把域模型与 internal 契约抽出来，为后续 AEI 扩展铺路。
- 不在本阶段重写 Table 数据访问能力；复用既有 `src/table/service.py` 及 internal endpoints。

## Decisions
### Decision: Tool = ADI（Context + Operation）
Tool 代表“对某个 Context（`table_id + json_path`）执行某类操作（type）”的一条可治理实体：
- **展示**：`name/alias/description/input_schema/output_schema/metadata`
- **执行**：由 `type` 决定映射到哪条通用执行路径（例如 table context 的 query/create/update/delete/schema 等）

### Decision: MCP Binding = AEI→ADI 绑定关系
`mcp_binding` 表作为“把哪些 Tool 暴露到哪个 MCP 实例”的唯一来源：
- 支持启用/禁用（status）
- 允许一个 Tool 绑定到多个 MCP 实例（便于复用/组合）

### Decision: internal API 仍是唯一运行时配置来源
保持 `mcp_service` 不直连数据库：
- `mcp_service` 通过 internal API 拉取：
  - MCP 实例基础信息（status、owner）
  - 已绑定并启用的 Tool 列表（含展示 schema）
- `mcp_service` 在 `call_tool` 时，通过 Tool.type + Tool.context（table_id/json_path）调用现有 internal table endpoints。

## Proposed Data Model
### Table: mcp_v2
`mcp_v2` 表表示 AEI（入口实例），建议字段：
- `id`, `api_key`, `user_id`, `name`, `status`, `created_at`
- 说明：保留现有 `mcp` 表作为历史/兼容；新逻辑以 `mcp_v2` 为准。

### Table: tool
`tool` 表表示 ADI，建议字段：
- `id` (bigint)
- `user_id`（必需；用于权限/隔离；允许跨 project 绑定）
- `table_id` (bigint), `json_path` (text)
- `type`（枚举：`get_data_schema|get_all_data|query_data|create|update|delete|preview|select`；可扩展）
- `name`（工具对 LLM 的唯一调用名；建议在同一 MCP 实例内唯一）
- `alias`（前端展示名，可重复）
- `description`
- `input_schema`（JSON Schema，jsonb）
- `output_schema`（JSON Schema，jsonb，可选）
- `metadata`（jsonb，额外配置：例如 preview_keys、限流/默认 query、读取策略等）
- `created_at`

### Table: mcp_binding
绑定关系表：
- `mcp_id` (bigint FK → mcp_v2.id)
- `tool_id` (bigint FK → tool.id)
- `status`（enabled/disabled；建议 boolean 或 smallint）
- `created_at`
- 唯一约束：`(mcp_id, tool_id)` 唯一

## Runtime Flow (MCP)
### list_tools
1. `mcp_service` 从请求中提取 `api_key`
2. `mcp_service` 调用 internal：获取 `mcp_instance` + `bound_tools`
3. 过滤 `mcp_instance.status == enabled` 且 `binding.status == enabled`
4. 将 bound_tools 映射为 MCP `Tool` 列表（name/description/inputSchema），返回给客户端

### call_tool
1. 解析 MCP tool name → 定位 Tool（通过 internal 返回的绑定列表建立 name→tool 映射）
2. 按 Tool.type 走对应执行路径：
   - `get_data_schema|get_all_data|query_data` → `GET /internal/tables/{table_id}/context-*`
   - `create|update|delete` → `POST/PUT/DELETE /internal/tables/{table_id}/context-data`
   - `preview|select` → 仍复用 `context-data`，由 Tool.metadata（如 preview_keys）决定行为；若 preview 未配置 preview_keys，则行为等价于 get_all
3. 将结果序列化为 MCP TextContent 返回

## Migration Plan
### Phase 0: Schema + Dual-read（最安全）
- 新增 `mcp_v2`、`tool`、`mcp_binding` 表与内部读写 API
- internal 增加“按 api_key 返回绑定工具列表”的端点
- `mcp_service` 优先走新端点；若没有绑定数据则回退旧 mcp_instance 方案（短期兼容）

### Phase 1: API 面向用户的配置切换
- 新增 Tool CRUD、Binding CRUD
- `POST /api/v1/mcp/` 创建 MCP 实例不再要求 table_id/json_pointer
- 前端/控制面改为：先创建 Tool，再绑定到 MCP

### Phase 2: 清理旧字段
- 停止写入旧字段
- 迁移存量 mcp_instance 的 `table_id/json_path/tools_definition/...` → 生成 Tool + Binding
- 评估是否删除旧列（或保留只读一段时间）

## Risks / Trade-offs
- **命名冲突**：多个 Tool 的 `name` 冲突会导致 call_tool 路由不确定；需要明确唯一约束与冲突处理策略。
- **权限边界**：Tool 可跨 Context，必须保证 tool.table_id 对当前 user 可见；需要在 internal 层做强校验。
- **缓存失效**：原来按 api_key 缓存单 Context 配置；新设计需要按 api_key 缓存“绑定工具列表”，同时在 tool/binding 变化时触发 invalidate + 通知 session `tools/list_changed`。

## Open Questions
- tool 名称冲突时的交互规则：在“绑定/新增绑定”阶段阻止；在“更新 Tool.name”阶段若该 Tool 已绑定到任意 mcp_v2，也需对所有相关 mcp_v2 做冲突校验并阻止产生不确定路由的更新。



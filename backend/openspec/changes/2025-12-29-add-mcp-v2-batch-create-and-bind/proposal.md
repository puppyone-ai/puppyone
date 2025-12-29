# Change: Add atomic MCP v2 create + batch tool binding endpoint

## Why
当前交互需要先创建 MCP v2，再逐个绑定 Tool，步骤割裂且容易造成“创建了入口但忘记绑定工具”的半成品状态。为提升用户体验与一致性，需要提供一个原子化入口：在创建 MCP v2 的同时批量绑定多个 Tool。

## What Changes
- 新增 API：`POST /mcp_v2/with_bindings`，在创建 MCP v2 实例时一次性提交多个 Tool 绑定配置。
- 该 API SHALL 具备原子语义：任一 Tool 绑定失败，则整体失败，并回滚本次创建的 MCP v2 与已创建的绑定关系。
- 复用现有绑定校验规则：Tool 必须属于当前用户；同一 MCP v2 内 `tool.name` 必须唯一。

## Impact
- **AFFECTED specs**
  - `specs/mcp-instance-management/spec.md`（**ADDED**：创建 MCP v2 并批量绑定 Tool 的接口语义与原子性）
- **AFFECTED code (implementation stage)**
  - `src/mcp_v2/router.py`（新增路由）
  - `src/mcp_v2/schemas.py`（新增请求/响应 schema）
  - `src/mcp_v2/service.py`（新增原子创建+批量绑定方法，复用现有 bind_tool 规则）
  - （如需要）`src/supabase/*`（如果要补充更高层的批量/回滚辅助方法）

## Open Questions
- 路由命名：是否坚持 `POST /mcp_v2/` 的语义扩展，还是使用明确的子路径（当前建议：`/mcp_v2/with_bindings`）？
- 返回结构：是否需要回传每个 binding 的 `binding_id`，还是仅回传 `mcp_v2.id/api_key` 与 `bound_tool_ids` 即可？



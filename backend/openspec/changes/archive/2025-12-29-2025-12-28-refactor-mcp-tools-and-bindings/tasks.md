## 1. Implementation
- [x] 1.1 设计并创建 Supabase schema：新增 `mcp_v2`、`tool`、`mcp_binding`；旧 `mcp` 表保留用于兼容与迁移
- [x] 1.2 主服务新增 Tool CRUD API（创建/查询/更新/删除），并补齐权限校验（Tool 归属 user；tool.table_id 必须归属当前 user 可访问范围；允许跨 project 绑定）
- [x] 1.3 主服务新增 Binding API（绑定/解绑/启用禁用）与查询（按 mcp_v2.api_key 返回 bound tools；强制同一 mcp_v2 内 tool.name 唯一）
- [x] 1.4 internal API 调整：提供 “按 api_key 返回 mcp_instance + bound_tools” 的稳定契约；增加 cache/invalidate 触发点
- [x] 1.5 `mcp_service` 调整：`config_loader` 按新契约加载工具列表；`list_tools/call_tool` 以 Tool 实体驱动分发
- [x] 1.6 迁移脚本：把存量 `mcp` 上的 `table_id/json_path/tools_definition/register_tools/preview_keys` 迁移成 Tool + Binding
- [x] 1.7 增量集成测试：覆盖“一个 MCP 绑定多个 Tool/跨 Context”与“binding 禁用/缓存失效”场景

## 2. Validation
- [x] 2.1 OpenAPI/契约检查：internal 返回结构与 mcp_service 解析一致
- [x] 2.2 回归：旧版 MCP 实例（未迁移）在 Phase0 dual-read 下仍可工作（如选择兼容策略）



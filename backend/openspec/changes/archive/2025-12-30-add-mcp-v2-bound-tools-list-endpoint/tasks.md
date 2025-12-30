## 1. Implementation
- [x] 1.1 在 `src/mcp_v2/schemas.py` 增加对外输出 schema（或复用/扩展现有 `BoundToolOut`），确保包含：`tool_id`、`name`、`type`、`table_id`、`json_path`、`binding_id`、`binding_status`（以及按需的 Tool 扩展字段）。
- [x] 1.2 在 `src/mcp_v2/service.py` 增加查询方法：
  - [x] 1.2.1 通过 `api_key` 获取 `mcp_v2` 实例（不做所有权校验）并查询其绑定 tools
  - [x] 1.2.2 通过 `mcp_id` 获取 `mcp_v2` 实例并校验所有权后查询其绑定 tools
  - [x] 1.2.3 支持 `include_disabled` 参数：默认过滤 `mcp_binding.status=true`
- [x] 1.3 在 `src/mcp_v2/router.py` 新增 2 个路由：
  - [x] 1.3.1 `GET /api/v1/mcp/{api_key}/tools`（不要求登录）
  - [x] 1.3.2 `GET /api/v1/mcp/id/{mcp_id}/tools`（要求登录 + 所有权校验）
- [x] 1.4 为 404/权限错误补齐一致的错误语义（复用 `ErrorCode.MCP_INSTANCE_NOT_FOUND` / `ErrorCode.NOT_FOUND`）。

## 2. Tests & Validation
- [x] 2.1 增加集成测试（或 service 单测）覆盖：
  - [x] 2.1.1 enabled 绑定默认返回、disabled 默认不返回
  - [x] 2.1.2 `include_disabled=true` 时包含 disabled
  - [x] 2.1.3 api_key 不存在返回 NOT_FOUND
  - [x] 2.1.4 mcp_id 不属于当前用户时拒绝访问
- [x] 2.2 运行 `openspec validate add-mcp-v2-bound-tools-list-endpoint --strict`（提案阶段已做一次；实现阶段复核）



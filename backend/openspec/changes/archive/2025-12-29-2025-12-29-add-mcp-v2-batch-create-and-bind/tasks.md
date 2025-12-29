## 1. Specification
- [x] 1.1 为 `mcp-instance-management` 增加“创建 MCP v2 并批量绑定 Tool”的 ADDED requirement 与场景（含原子性/回滚语义）

## 2. Implementation
- [x] 2.1 在 `src/mcp_v2/schemas.py` 增加批量创建+绑定的请求/响应 schema
- [x] 2.2 在 `src/mcp_v2/service.py` 增加原子创建+批量绑定方法（复用 `bind_tool` 校验；失败时回滚）
- [x] 2.3 在 `src/mcp_v2/router.py` 增加 `POST /mcp_v2/with_bindings` 路由并接入 service 方法

## 3. Validation
- [x] 3.1 运行 `openspec validate 2025-12-29-add-mcp-v2-batch-create-and-bind --strict` 并修复所有校验问题



## 1. Specification
- [x] 1.1 为 `mcp-instance-management` 增加 “mcp_v2 代理访问端点” 的 ADDED requirement 与场景

## 2. Implementation
- [x] 2.1 在 `src/mcp_v2/dependencies.py` 增加 `get_mcp_v2_instance_by_api_key`（不校验用户，仅校验存在性）
- [x] 2.2 在 `src/mcp_v2/router.py` 增加 `GET/POST/... /mcp_v2/server/{api_key}[/{path:path}]` 转发端点（注入 `X-API-KEY`）

## 3. Validation
- [x] 3.1 运行 `openspec validate 2025-12-29-add-mcp-v2-proxy-endpoint --strict`



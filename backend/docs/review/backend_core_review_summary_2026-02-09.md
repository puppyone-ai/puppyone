# Backend Core Review Summary（2026-02-09）

## Top Risks

1. **P0 - 节点权限缺失**：`src/content_node/router.py` 多接口缺项目访问校验。
2. **P0 - Tool/Search 越权面**：`src/tool/service.py` 与 `src/tool/router.py` 使用 `get_by_id_unsafe` 且无成员校验。
3. **P1 - MCP key 暴露面**：`src/mcp_v3/router.py` 通过 URL path 传 key，`src/utils/middleware.py` 记录 path。
4. **P1 - 健康检查误报**：`src/main.py`、`src/ingest/router.py` 固定返回 healthy。
5. **P1 - 测试门禁漂移**：auth/tool/etl/mcp_v2 测试与实现不一致，CI 约束力下降。

## Recommended Order

- **72h**：先修 P0（权限闭环）+ MCP key 传输与日志脱敏。
- **1-2 sprints**：修 health 语义 + 重建核心测试集。
- **治理阶段**：Pydantic V2 迁移、环境配置基线、占位路径清理。

## Key Artifacts

- 主报告：`docs/review/backend_core_review_2026-02-09.md`
- 本摘要：`docs/review/backend_core_review_summary_2026-02-09.md`

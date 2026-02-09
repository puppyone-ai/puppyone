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

## Progress Update (2026-02-09, P2)

- **BC-008（模型兼容债务）**：已完成第一阶段迁移，`src/**/models.py` 与 `src/**/schemas.py` 中遗留的 `class Config` 已统一迁移为 `ConfigDict(from_attributes=True)`；项目内由 V1 配置触发的 Pydantic deprecation warning 已清理。
- **BC-009（运行时默认配置）**：`src/config.py` 增加 `APP_ENV`（支持 `APP_ENV/ENVIRONMENT`），并按环境分层推导 `DEBUG` 与 `ALLOWED_HOSTS` 默认值；`src/main.py` 在 `DEBUG=False` 时新增 `ALLOWED_HOSTS` wildcard（`*`）启动期拒绝策略。
- **BC-010（ingest 占位路径）**：移除 `src/ingest/dependencies.py` 中无效 `pass` 占位；`src/ingest/saas/jobs/jobs.py` 对 `ImportTaskType.FILE` 增加显式可观测失败与引导信息，避免落入未实现路径触发运行时异常。

### Validation
- `uv run pytest -q --tb=no --disable-warnings` → `181 passed, 26 skipped`
- `uv run pytest -q` → `181 passed, 26 skipped, 47 warnings`

### Remaining Warning Debt (Non-blocking)
- 第三方依赖 `storage3` 的 Pydantic V2 deprecation warnings（位于 `.venv/lib/.../storage3/types.py`）。
- `litellm` / `pydantic` 序列化告警与异步 cleanup runtime warning（测试退出阶段）。

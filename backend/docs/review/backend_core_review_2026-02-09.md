# Backend Core Review Report（2026-02-09）

## 1. 评审范围与方法

### 范围（核心链路优先）
- `src/main.py`
- `src/auth/`
- `src/project/`
- `src/tool/`
- `src/mcp_v3/`
- `src/ingest/`
- `src/content_node/`

### 方法
- 静态代码审查（权限、稳定性、可观测性、配置安全）
- 针对性测试信号采集（pytest collect + 核心模块测试）
- 风险分级：`P0/P1/P2`

### 总结结论
当前后端核心链路存在**高优先级权限闭环缺失**与**测试基线漂移**问题。优先建议先完成权限热修，再修复质量门禁。

---

## 2. 自动化信号（证据）

### 已执行命令
1. `uv run pytest --collect-only -q`
2. `uv run pytest tests/auth/test_auth_api.py -q`
3. `uv run pytest tests/tool/test_tool_api.py -q`
4. `uv run pytest tests/mcp_v2/test_mcp_v2_bound_tools_list_api.py -q`
5. `uv run pytest tests/etl/test_etl_api.py -q`
6. `uv run pytest tests/search/test_rrf.py -q`
7. `uv run pytest --collect-only -q tests/auth/test_auth_api.py tests/tool/test_tool_api.py tests/etl/test_etl_api.py`

### 结果摘要
- 全量 collect：`239` tests collected，`7` collection errors。
- auth/tool/etl 定向 collect：`26` tests collected，`1` collection error（`tests/auth/test_auth_api.py` 导入 `get_user_service` 失败）。
- `tests/tool/test_tool_api.py`：`1 passed, 1 error`（测试仍使用旧字段/旧类型假设）。
- `tests/mcp_v2/test_mcp_v2_bound_tools_list_api.py`：`3 passed, 1 failed`（`BoundToolOut.tool_id` 类型收紧后测试未更新）。
- `tests/etl/test_etl_api.py`：`15 failed, 5 errors, 4 passed`（接口路径与模型类型假设双重漂移）。
- `tests/search/test_rrf.py`：通过。

---

## 3. 问题清单（风险分级 + 修复建议）

| id | severity | module | file_path | symptom | root_cause | impact | repro_steps | fix_recommendation | effort | owner_suggestion |
|---|---|---|---|---|---|---|---|---|---|---|
| BC-001 | P0 | content-node 权限 | `src/content_node/router.py` | 多个节点接口仅依赖 `project_id` 参数，未校验当前用户是否可访问该项目 | 路由层保留权限 TODO，未接入统一项目鉴权依赖 | 存在跨项目读写与下载风险 | 以用户A token 访问用户B的 `project_id`，调用 `/api/v1/nodes` 相关接口，观察是否可读写 | 在 `/nodes` 全接口统一注入项目访问校验（`verify_project_access` 或 `get_verified_project` 风格依赖） | M | Backend API owner |
| BC-002 | P0 | tool/search 权限 | `src/tool/service.py`, `src/tool/router.py` | Tool 创建/更新/Search Tool 创建使用 `get_by_id_unsafe`，且 TODO 标注成员校验缺失 | “节点存在”被当作“可访问” | 可构造绑定他人节点的 Tool，并触发索引流程读取他人项目数据 | 使用他人 `node_id` 调 `POST /api/v1/tools/search` 或 tool create/update | 引入“节点归属 + 项目归属 + 当前用户”三重校验，移除 `unsafe` 入口在外部请求路径的使用 | M | Tool/Search owner |
| BC-003 | P1 | search service 防线 | `src/search/service.py` | `index_scope/index_folder` 签名包含 `user_id` 但未实际使用 | 缺少 service 层 defense-in-depth | 上游漏鉴权时，搜索层无法兜底阻断 | 代码检索 `user_id` 仅出现在签名和注释 | 在 SearchService 内增加项目访问显式校验（不只依赖上游） | S | Search owner |
| BC-004 | P1 | MCP 凭证暴露面 | `src/mcp_v3/router.py`, `src/utils/middleware.py` | `mcp_api_key` 放在 URL path（`/mcp/proxy/{api_key}`），access log 记录 path | 凭证承载在 URL 结构中 | key 可能进入应用日志/网关日志/APM 链路 | 访问代理路由后检查 access 日志 path | 改为 header 传 key（如 `X-MCP-API-Key`），并对 path 参数脱敏；设置兼容迁移期 | M | MCP owner |
| BC-005 | P1 | internal secret 配置 | `src/config.py`, `src/internal/router.py` | `INTERNAL_API_SECRET` 默认空字符串；校验为简单等值比较 | 缺少启动期“强制非空”约束 | 生产误配风险（内部接口可能被空密钥调用） | 不设置密钥时启动并请求 internal 接口 | 非开发环境 fail-fast：密钥为空直接拒绝启动；health 中暴露配置错误状态 | S | Platform |
| BC-006 | P1 | 健康检查语义 | `src/main.py`, `src/ingest/router.py` | health 返回固定 `healthy`（即使下游异常或未检查） | 健康接口未做状态聚合 | 监控误报，自动化运维决策失真 | 检查 health 返回体状态字段 | 拆分 liveness/readiness；关键依赖异常时返回 degraded/unhealthy | S | Platform |
| BC-007 | P1 | 测试质量门禁 | `tests/auth/test_auth_api.py`, `tests/tool/test_tool_api.py`, `tests/etl/test_etl_api.py`, `tests/mcp_v2/test_mcp_v2_bound_tools_list_api.py` | 大量测试与实现漂移（旧接口路径、旧字段、旧类型） | 历史重构后测试迁移不完整 | CI 对核心链路失去约束能力 | 执行上述测试即可复现收集错误/失败 | 先修复 collect error，再建立“最小可用核心测试集”，最后迁移 legacy tests | M | QA + module owners |
| BC-008 | P2 | 模型兼容债务 | `src/**/models.py`, `src/**/schemas.py` | pytest 持续出现 Pydantic V2 deprecation warnings |............................................................................................. 仍大量沿用 V1 风格配置 | 短期不阻断，升级窗口风险放大 | 运行 pytest 观察 warning | 分阶段迁移 `ConfigDict` 与字段类型规范，设置 warning budget | M | Shared backend |
| BC-009 | P2 | 运行时默认配置 | `src/config.py` | 默认 `DEBUG=True`、`ALLOWED_HOSTS=['*']` | 默认值偏开发态 | 生产误配时安全基线下降 | 检查默认配置与部署环境变量 | 按环境分层配置（dev/staging/prod），关键配置启动校验 | S | Platform |
| BC-010 | P2 | ingest 占位路径 | `src/ingest/dependencies.py`, `src/ingest/saas/handlers/file_handler.py`, `src/ingest/saas/jobs/jobs.py` | 存在 `pass`/`NotImplementedError` 占位，且 `ImportTaskType.FILE` 已在 jobs 里分发到 FileHandler | 迁移中的未闭环路径 | 后续流量接入该分支将触发运行时异常 | 代码路径审查可复现 | 删除不可用分支或补齐实现；不可用时显式返回可观测错误 | S | Ingest owner |

---

## 4. 优先级修复建议

### 72 小时热修（必须）
1. BC-001：`content_node` 全接口权限闭环。
2. BC-002：`tool/search` 节点访问权限闭环。
3. BC-004：MCP key 从 path 迁移到 header + 日志脱敏。

### 1-2 个迭代
4. BC-005：`INTERNAL_API_SECRET` 启动期 fail-fast。
5. BC-006：health 语义改造（readiness/liveness）。
6. BC-007：测试集重建（先 collect，再核心链路 pass）。

### 例行治理
7. BC-008 ~ BC-010：模型迁移、默认配置收敛、占位代码清理。

---

## 5. 验收标准（用于回归）

1. `/api/v1/nodes` 相关接口对无项目权限用户统一返回 `404/403`，且有自动化回归测试。
2. Tool create/update/search 在跨项目 `node_id` 输入下被拒绝，且索引任务不会被创建。
3. MCP 代理日志不出现明文 API key。
4. 非开发环境下 `INTERNAL_API_SECRET` 为空时服务无法启动。
5. health 在依赖异常时不返回 `healthy`，并可区分存活与就绪。
6. CI 至少包含一组稳定通过的核心链路测试（auth/project/content-node/tool/mcp/ingest）。

---

## 6. 评审假设

1. 本次为“代码评审与问题识别”，不直接改动业务实现。
2. 安全模型按“标识符可能泄露/被枚举”评估，不依赖 UUID 不可猜测性。
3. `agent` 模块中的 `get_by_id_unsafe` 目前有前置 access 逻辑，暂未纳入 P0，但建议后续做统一封装治理。

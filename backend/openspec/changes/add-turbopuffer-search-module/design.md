## Context

本项目后端采用 FastAPI + 模块化服务目录结构（`src/<module>/`），各模块通过 `dependencies.py` 提供依赖注入入口。现阶段需要引入第三方检索引擎 turbopuffer，但本版本不要求任何业务模块立刻接入，因此需要一个“内部封装良好、未来易集成”的模块。

## Goals / Non-Goals

- Goals:
  - 提供一个稳定、抽象清晰的 turbopuffer 客户端与服务层封装
  - 支持异步调用（优先）并允许后续扩展到同步调用场景
  - 支持写入（upsert）+ 查询（向量/全文/多查询），并保留扩展空间（过滤、解释、warm cache、分页等）
  - 错误与日志对齐项目规范（不泄露密钥；上层易处理）
  - 在无网络/CI 沙盒中可运行的单元测试
- Non-Goals:
  - 不新增 FastAPI 路由、不对外提供搜索 API
  - 不改动现有 ETL/表管理/工具/MCP 等模块
  - 不实现 rerank、融合算法等更高层检索策略（仅提供 multi_query 能力与结果结构，融合策略留给上层）

## Decisions

- Decision: 以“服务模块”形式新增 `src/turbopuffer/`
  - Why: 与现有项目结构一致，便于未来通过 DI 在其它模块接入
- Decision: 默认提供 Async API（基于 turbopuffer Async client / async 语义）
  - Why: FastAPI 与现有项目整体偏 async；避免阻塞事件循环
- Decision: 配置项采用“缺失告警但不阻断启动”
  - Why: 项目已有类似做法（例如 `src/llm/config.py` 对关键环境变量只 warning）；同时本版本不强制启用 turbopuffer
- Decision: 定义模块级异常（例如 `TurbopufferConfigError` / `TurbopufferRequestError` / `TurbopufferNotFound`）
  - Why: 隔离第三方 SDK 异常类型，避免上层强耦合 turbopuffer；也便于统一异常处理与重试策略

## Risks / Trade-offs

- 风险: 未配置 `TURBOPUFFER_API_KEY` 时运行期调用会失败
  - Mitigation: 启动时 warning；在服务方法中对缺失配置给出明确异常
- 风险: 第三方 SDK 行为变化（字段名、异常类型、API 版本）
  - Mitigation: 封装层保持薄；在单元测试里固定关键调用契约；将升级影响限制在 `src/turbopuffer/`
- 取舍: 不在模块内实现“混合检索融合/重排”
  - Rationale: 这属于更上层检索策略；本阶段先保证 turbopuffer 的 write/query 能力可用且接口稳定

## Migration Plan

1. 在本变更 apply 阶段新增 `src/turbopuffer/` 与测试
2. 后续版本在需要的业务模块通过 DI 引入 `TurbopufferSearchService`（命名待实现阶段确认）
3. 若未来替换/新增搜索引擎，仅新增新的模块实现并在上层切换依赖注入即可

## Open Questions

- namespace 命名规则：是否需要统一前缀（如 `ctxb-<env>-<tenant>`）？
- 文档 schema 的最小约定：是否要强制包含 `content`（FTS）与 `vector` 字段，还是由上层传入？
- 是否需要在 `GET /health` 中增加 turbopuffer 配置可用性字段（本版本倾向不改动对外行为）？



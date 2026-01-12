# Change: 新增 turbopuffer 搜索引擎模块（仅内部封装）

## Why

当前项目缺少一个统一、可扩展的检索引擎抽象层，导致后续要引入向量检索/全文检索/混合检索时会散落在各业务模块中，难以复用和演进。
本变更引入 `turbopuffer` 作为搜索引擎的首个实现，并以“抽象好用”的方式封装其能力，为后续版本接入其它模块打基础。

## What Changes

- 新增 `src/turbopuffer/` 服务模块（仅提供 Python 侧的封装与依赖注入，不新增任何对外 API 路由）
- 提供统一的配置入口（API Key、Region 等），并在缺少关键配置时以“告警但不阻断启动”的方式处理
- 提供面向业务的最小接口：
  - Namespace 管理（如 schema/update、delete_all）
  - 文档写入（upsert rows，支持向量字段 + FTS 字段）
  - 查询（向量 ANN、BM25 FTS、multi_query 组合查询）
- 约定统一的错误模型与日志规范，避免把第三方 SDK 异常/敏感信息泄露到上层
- 增加单元测试（通过 mock httpx/SDK，不依赖真实网络与 turbopuffer 服务）

## Impact

- Affected specs:
  - 新增 capability: `turbopuffer-search`
- Affected code (planned in apply stage):
  - `src/turbopuffer/*`（新模块）
  - `tests/turbopuffer/*`（新测试）
- Breaking changes:
  - 无（不改动现有对外 API；其它模块本版本不调用 turbopuffer）



# turbopuffer-search Specification

## Purpose
TBD - created by archiving change add-turbopuffer-search-module. Update Purpose after archive.
## Requirements
### Requirement: Turbopuffer 搜索模块

系统 MUST 提供一个独立的 `turbopuffer` 服务模块，用于封装 turbopuffer 搜索引擎能力（写入与检索），并且该模块本版本不对外暴露 FastAPI 路由。

#### Scenario: 模块以标准结构落地

- **WHEN** 开发者查看源代码目录结构
- **THEN** 应存在 `src/turbopuffer/` 服务模块目录
- **AND** 该目录至少包含 `__init__.py`、`config.py`、`service.py`、`schemas.py`、`dependencies.py`、`exceptions.py`

#### Scenario: 本版本不新增对外 API

- **WHEN** 系统启动并注册路由
- **THEN** 不应新增任何 turbopuffer 相关对外 HTTP 路由
- **AND** 其它业务模块本版本不依赖 turbopuffer 模块

### Requirement: Turbopuffer 配置管理

系统 MUST 支持通过环境变量配置 turbopuffer 连接信息，并在缺失关键配置时以“告警但不阻断启动”的方式处理。

#### Scenario: 读取 API Key 与 Region

- **WHEN** 系统启动并加载 turbopuffer 配置
- **THEN** 系统应从环境变量读取 `TURBOPUFFER_API_KEY`
- **AND** 系统应从环境变量读取 `TURBOPUFFER_REGION` 或使用默认 region

#### Scenario: 缺失 API Key 的处理

- **WHEN** `TURBOPUFFER_API_KEY` 未设置
- **THEN** 系统启动不应失败
- **AND** 系统应记录 warning，提示 turbopuffer 调用在运行期可能失败

### Requirement: Namespace 写入能力（Upsert）

系统 MUST 提供对 turbopuffer 的写入封装，以支持在 namespace 中 upsert 文档行，并可选更新 schema（包括启用全文检索字段）。

#### Scenario: Upsert 向量与全文字段

- **WHEN** 调用方提供包含 `id`、`vector` 以及全文字段（如 `content`）的行数据
- **THEN** 系统应对目标 namespace 执行 upsert 写入
- **AND** 系统应支持为全文字段启用 full text search 配置

#### Scenario: 写入参数可控

- **WHEN** 调用方指定距离度量（如 cosine_distance）与 schema
- **THEN** 系统应将这些参数传递给 turbopuffer 写入接口

### Requirement: 查询能力（向量/全文/多查询）

系统 MUST 提供对 turbopuffer 查询能力的封装，至少包括向量 ANN、BM25 全文检索与 multi_query（用于组合查询）。

#### Scenario: 向量 ANN 查询

- **WHEN** 调用方提供向量查询（rank_by = vector ANN）与 top_k
- **THEN** 系统应向 turbopuffer 发起向量 ANN 查询
- **AND** 返回结果应包含命中行的 id 与距离/分数信息

#### Scenario: BM25 全文检索查询

- **WHEN** 调用方提供全文查询（rank_by = attribute BM25）与 top_k
- **THEN** 系统应向 turbopuffer 发起 BM25 全文检索查询
- **AND** 返回结果应包含命中行的 id 与距离/分数信息

#### Scenario: multi_query 组合查询

- **WHEN** 调用方希望同时进行向量检索与全文检索
- **THEN** 系统应支持以 single call 的方式调用 turbopuffer multi_query
- **AND** 系统应按查询顺序返回每个子查询的结果集

### Requirement: 错误隔离与日志安全

系统 MUST 隔离第三方 turbopuffer SDK 的异常与数据结构，向上层提供稳定的模块级异常与结果结构，并且日志不得泄露敏感信息（如 API Key）。

#### Scenario: 第三方异常映射

- **WHEN** turbopuffer SDK 抛出 NotFound 或其它请求错误
- **THEN** 系统应映射为本模块定义的异常类型
- **AND** 上层不应依赖 turbopuffer SDK 的异常类

#### Scenario: 日志不泄露密钥

- **WHEN** turbopuffer 调用失败并记录日志
- **THEN** 日志内容不得包含 `TURBOPUFFER_API_KEY` 的明文


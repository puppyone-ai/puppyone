# turbopuffer-search Specification (Delta)

## MODIFIED Requirements

### Requirement: Turbopuffer 搜索模块

系统 MUST 提供一个独立的 `turbopuffer` 服务模块，用于封装 turbopuffer 搜索引擎能力（写入与检索），并且该模块本版本不对外暴露 FastAPI 路由。

#### Scenario: 模块以标准结构落地

- **WHEN** 开发者查看源代码目录结构
- **THEN** 应存在 `src/turbopuffer/` 服务模块目录
- **AND** 该目录至少包含 `__init__.py`、`config.py`、`service.py`、`schemas.py`、`dependencies.py`、`exceptions.py`

#### Scenario: 本版本不新增对外 API

- **WHEN** 系统启动并注册路由
- **THEN** 不应新增任何 turbopuffer 相关对外 HTTP 路由

#### Scenario: 允许业务模块依赖 turbopuffer（用于检索能力集成）

- **GIVEN** 系统需要在业务能力（如 Search Tool）中使用 turbopuffer 进行写入与查询
- **WHEN** 业务模块通过依赖注入/显式导入使用 `src/turbopuffer/*`
- **THEN** 该依赖关系 MUST 被允许
- **AND** 业务模块不应直接依赖 turbopuffer SDK 的异常与数据结构（仍应通过本模块的异常/结果结构隔离）


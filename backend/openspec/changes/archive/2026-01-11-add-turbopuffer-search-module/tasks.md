## 1. Implementation

- [x] 1.1 新增模块目录 `src/turbopuffer/`，包含 `__init__.py`、`config.py`、`service.py`、`schemas.py`、`dependencies.py`、`exceptions.py`
- [x] 1.2 在 `config.py` 中定义 `TurbopufferConfig`（读取 `TURBOPUFFER_API_KEY`、`TURBOPUFFER_REGION` 等），缺失时仅 warning（不阻断启动）
- [x] 1.3 在 `service.py` 中实现面向业务的封装（异步优先）：
  - [x] 1.3.1 获取 namespace（基于 SDK 的 `client.namespace()` 或 `client.namespaces.*`）
  - [x] 1.3.2 写入（upsert rows、distance_metric、schema）
  - [x] 1.3.3 查询（vector ANN / BM25 FTS / multi_query）
  - [x] 1.3.4 结果归一化为本模块的 schemas（避免上层依赖 SDK Pydantic 模型）
- [x] 1.4 在 `exceptions.py` 中定义并映射第三方异常到模块异常
- [x] 1.5 在 `dependencies.py` 中提供单例依赖注入（对齐项目现有模式）

## 2. Tests

- [x] 2.1 新增 `tests/turbopuffer/` 单元测试，使用 mock/stub（不依赖网络）
- [x] 2.2 覆盖场景：缺失配置、write 参数透传、query 参数透传、异常映射、日志不泄露密钥

## 3. Validation

- [x] 3.1 运行 `ruff check --fix src` 与 `ruff format src`
- [x] 3.2 运行测试套件（或最小子集：`tests/turbopuffer/`）



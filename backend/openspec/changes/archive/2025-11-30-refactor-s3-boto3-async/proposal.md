# Change: 将 S3 模块从 aioboto3 迁移到 boto3 并适配异步路由

## Why

aioboto3 是一个相对小众的库，维护活跃度较低，而 boto3 是 AWS 官方 Python SDK，文档更完善、社区支持更好、更新更及时。通过将同步的 boto3 适配到 FastAPI 的异步路由中（使用线程池执行同步操作），可以获得更好的稳定性和可维护性，同时保持异步性能。

## What Changes

- 将 `src/s3/service.py` 中的 aioboto3 替换为 boto3
- 使用 `asyncio.to_thread()` 或 `run_in_executor()` 将同步的 boto3 操作适配到异步环境
- 更新依赖配置，将 aioboto3 替换为 boto3
- 保持所有现有 API 接口不变（向后兼容）
- 添加全面的单元测试，确保迁移后功能正常
- 运行测试验证所有 S3 操作正常工作

## Impact

- Affected specs: `s3-storage`
- Affected code:
  - `src/s3/service.py` - 核心 S3 服务逻辑
  - `src/s3/router.py` - 可能需要微调依赖注入
  - `pyproject.toml` - 依赖声明
  - `tests/` - 新增单元测试
- **非破坏性变更**: API 接口保持不变，客户端无需修改


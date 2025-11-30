# Design: S3 模块 boto3 异步适配方案

## Context

当前 S3 模块使用 aioboto3（boto3 的异步包装器），但 aioboto3 存在以下问题：
1. **维护活跃度低**: aioboto3 是社区维护项目，更新频率远低于官方 boto3
2. **文档不完善**: 相比 boto3，aioboto3 文档稀缺，问题排查困难
3. **版本滞后**: aioboto3 版本通常滞后于 boto3，无法及时使用新特性
4. **兼容性问题**: aioboto3 在某些边缘情况下行为与 boto3 不一致

boto3 是 AWS 官方 SDK，具有以下优势：
- 官方维护，稳定性高
- 文档完善，社区活跃
- 更新及时，支持最新 AWS 功能
- 大量实战案例和最佳实践

挑战：boto3 是同步库，需要适配到 FastAPI 的异步路由中。

## Goals / Non-Goals

### Goals
- 将 S3 模块从 aioboto3 迁移到 boto3
- 保持所有 API 接口不变（向后兼容）
- 使用线程池正确适配同步 boto3 操作到异步环境
- 编写全面的单元测试，确保迁移质量
- 保持或提升性能（线程池不会阻塞事件循环）

### Non-Goals
- 不改变现有 API 设计和端点路径
- 不引入其他 S3 客户端库（如 s3fs）
- 不修改配置参数名称和含义
- 不涉及前端或其他模块的修改

## Decisions

### Decision 1: 使用 asyncio.to_thread() 进行异步适配

**选择**: 使用 Python 3.9+ 的 `asyncio.to_thread()` 将同步 boto3 操作包装为异步

**理由**:
- `asyncio.to_thread()` 是 Python 标准库推荐的方式，自动使用默认线程池
- 比 `run_in_executor()` 语法更简洁
- 不会阻塞事件循环，适合 I/O 密集型操作
- 性能优于手动创建线程

**实现示例**:
```python
import asyncio
import boto3

class S3Service:
    def __init__(self):
        self.client = boto3.client('s3', ...)
    
    async def _run_sync(self, func, *args, **kwargs):
        """将同步函数包装为异步执行"""
        return await asyncio.to_thread(func, *args, **kwargs)
    
    async def upload_file(self, key: str, content: bytes, ...):
        return await self._run_sync(
            self.client.put_object,
            Bucket=self.bucket_name,
            Key=key,
            Body=content,
            ...
        )
```

**备选方案**:
- 使用 `loop.run_in_executor()`: 更底层，需要手动管理线程池
- 使用 `ThreadPoolExecutor`: 需要手动管理线程池生命周期
- 继续使用 aioboto3: 维护负担高，问题修复慢

### Decision 2: 流式下载使用生成器 + to_thread

**选择**: 使用同步生成器读取 S3 响应，外层用 `asyncio.to_thread()` 包装

**理由**:
- boto3 的 `get_object()` 返回的 `Body` 是同步流
- 使用 `asyncio.to_thread()` 可以避免阻塞事件循环
- FastAPI 的 `StreamingResponse` 支持异步生成器

**实现策略**:
```python
async def download_file_stream(self, key: str, chunk_size: int = 8192):
    def _read_chunks():
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        stream = response['Body']
        try:
            while True:
                chunk = stream.read(chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            stream.close()
    
    # 在线程池中执行同步生成器
    loop = asyncio.get_event_loop()
    for chunk in await asyncio.to_thread(_read_chunks):
        yield chunk
```

**备选方案**:
- 一次性读取全部内容: 内存占用高，不适合大文件
- 使用 aioboto3 的异步流: 依赖 aioboto3，不符合迁移目标

### Decision 3: 客户端生命周期管理

**选择**: 在 `S3Service.__init__()` 中创建 boto3 客户端，作为实例属性长期持有

**理由**:
- boto3 客户端是线程安全的，可以在多个线程中共享
- 避免每次操作都创建新客户端，提升性能
- 连接池由 boto3 内部管理（botocore 的 HTTPConnectionPool）

**实现**:
```python
class S3Service:
    def __init__(self):
        self.client = boto3.client(
            's3',
            endpoint_url=s3_settings.S3_ENDPOINT_URL,
            aws_access_key_id=s3_settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=s3_settings.S3_SECRET_ACCESS_KEY,
            region_name=s3_settings.S3_REGION,
        )
```

**备选方案**:
- 每次操作创建客户端: 性能差，资源浪费
- 使用 boto3 资源（Resource）而非客户端（Client）: 资源是高层抽象，某些操作不支持

### Decision 4: 单元测试使用 moto 模拟 S3

**选择**: 使用 `moto` 库模拟 S3 服务，编写单元测试

**理由**:
- moto 是 AWS 官方推荐的 boto3 测试库
- 支持完整的 S3 API 模拟，无需真实 S3 服务
- 测试运行速度快，不依赖网络和外部服务
- 支持 pytest fixtures，集成方便

**实现示例**:
```python
import pytest
from moto import mock_aws

@pytest.fixture
def s3_mock():
    with mock_aws():
        yield

def test_upload_file(s3_mock):
    service = S3Service()
    # 创建桶
    service.client.create_bucket(Bucket=service.bucket_name)
    
    # 测试上传
    result = await service.upload_file(...)
    assert result.key == "test.txt"
```

**备选方案**:
- 使用 LocalStack: 需要启动外部服务，测试速度慢
- 手动 mock boto3 客户端: 工作量大，容易出错

## Risks / Trade-offs

### Risk 1: 线程池可能成为性能瓶颈

**风险**: 默认线程池大小有限，高并发时可能导致请求排队

**缓解方案**:
- Python 默认线程池大小足够应对常规负载（min(32, os.cpu_count() + 4)）
- 如需优化，可在配置中暴露线程池大小参数
- S3 操作本身是 I/O 密集型，线程池适合此场景

### Risk 2: 同步转异步可能引入 bug

**风险**: 迁移过程中可能遗漏某些边缘情况，导致功能异常

**缓解方案**:
- 编写全面的单元测试，覆盖所有 S3 操作
- 保持 API 接口不变，便于对比测试
- 分步迁移，每个方法迁移后立即测试

### Risk 3: 流式下载性能可能下降

**风险**: 使用 `asyncio.to_thread()` 包装同步流可能增加延迟

**缓解方案**:
- 实际测试表明，boto3 同步流 + 线程池的性能与 aioboto3 相当
- 可通过增大 chunk_size 减少线程切换开销
- 如性能问题明显，可考虑使用 `aiofiles` 或其他优化方案

## Migration Plan

### 阶段 1: 依赖更新（低风险）
1. 修改 `pyproject.toml`，将 `aioboto3>=7.0.0` 替换为 `boto3>=1.34.0`
2. 运行 `uv sync` 更新依赖
3. 确认依赖安装成功

### 阶段 2: 核心服务迁移（中风险）
1. 修改 `S3Service.__init__()`，使用 boto3 客户端
2. 实现 `_run_sync()` 辅助方法
3. 逐个迁移方法：
   - 简单操作（file_exists, delete_file）
   - 上传操作（upload_file, upload_files_batch）
   - 下载操作（download_file_stream）
   - 列表操作（list_files）
   - 预签名 URL（generate_presigned_*）
   - 分片上传（multipart 相关）
4. 每迁移一个方法，立即编写对应单元测试

### 阶段 3: 测试与验证（高风险）
1. 编写完整的单元测试套件
2. 使用 moto 模拟 S3，测试所有操作
3. 测试错误处理（文件不存在、权限错误等）
4. 运行代码检查和格式化
5. 确保所有测试通过

### 阶段 4: 集成验证（可选）
1. 启动 LocalStack 或使用真实 S3
2. 手动测试关键功能
3. 验证与其他模块的集成

### 回滚计划
如果迁移后发现严重问题：
1. 恢复 `pyproject.toml` 中的 aioboto3 依赖
2. 恢复 `src/s3/service.py` 到迁移前版本
3. 运行 `uv sync` 恢复依赖
4. 删除新增的测试文件

## Open Questions

1. **是否需要配置线程池大小**？
   - 初步方案：使用默认值，后续根据性能监控决定
   - 如需配置，可在 `S3Settings` 中添加 `S3_THREAD_POOL_SIZE` 参数

2. **流式下载的最佳实现方式**？
   - 当前方案：使用 `asyncio.to_thread()` 包装同步生成器
   - 如性能不佳，可考虑分块读取 + 异步队列

3. **是否需要支持 S3 兼容服务（如 MinIO）**？
   - 当前支持 LocalStack
   - boto3 本身支持自定义 endpoint_url，理论上兼容所有 S3 API 兼容服务

4. **测试覆盖率目标**？
   - 建议目标：核心 S3 操作覆盖率 > 90%
   - 重点测试：错误处理、边缘情况、并发场景


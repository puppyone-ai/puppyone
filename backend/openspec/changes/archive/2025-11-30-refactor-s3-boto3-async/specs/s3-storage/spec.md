## MODIFIED Requirements

### Requirement: S3 客户端配置管理

系统 SHALL 提供灵活的 S3 客户端配置管理,支持本地开发(LocalStack)和生产环境(AWS S3)的无缝切换。

#### Scenario: 配置项完整性

- **WHEN** 应用启动并初始化 S3 服务
- **THEN** 应从配置中读取以下必需参数:
  - `S3_ENDPOINT_URL`: S3 服务端点(本地为 http://localhost:4566,生产可为空使用默认)
  - `S3_BUCKET_NAME`: 默认存储桶名称
  - `S3_REGION`: AWS 区域(如 us-east-1)
  - `S3_ACCESS_KEY_ID`: 访问密钥 ID
  - `S3_SECRET_ACCESS_KEY`: 访问密钥
- **AND** 所有配置应可通过环境变量覆盖

#### Scenario: LocalStack 本地开发环境

- **WHEN** 使用 LocalStack 进行本地开发
- **THEN** S3_ENDPOINT_URL 应设置为 http://localhost:4566
- **AND** 凭证可使用任意测试值(如 "test")
- **AND** 客户端应能成功连接并执行操作

#### Scenario: AWS 生产环境

- **WHEN** 部署到生产环境连接 AWS S3
- **THEN** S3_ENDPOINT_URL 可为空(使用 boto3 默认)
- **AND** 凭证应使用真实的 IAM 访问密钥
- **AND** 区域应匹配存储桶所在区域

#### Scenario: 文件大小限制配置

- **WHEN** 应用启动并初始化 S3 服务
- **THEN** 应从配置中读取文件大小相关参数:
  - `S3_MAX_FILE_SIZE`: 单文件上传最大大小(字节),默认 100MB
  - `S3_MULTIPART_THRESHOLD`: 启用分片上传的阈值,默认 100MB
  - `S3_MULTIPART_CHUNKSIZE`: 分片大小,默认 5MB
- **AND** 这些配置应可通过环境变量覆盖

#### Scenario: boto3 客户端初始化

- **WHEN** S3Service 实例化时
- **THEN** 应使用 boto3.client() 创建 S3 客户端
- **AND** 客户端应作为实例属性长期持有（线程安全）
- **AND** 客户端应使用配置的 endpoint_url、region、凭证参数

## ADDED Requirements

### Requirement: 异步操作适配

系统 SHALL 使用 asyncio.to_thread() 将同步的 boto3 操作适配到 FastAPI 异步路由中,确保不阻塞事件循环。

#### Scenario: 同步函数异步包装

- **WHEN** 调用任何 S3 操作（如 upload_file、download_file）
- **THEN** 应使用 asyncio.to_thread() 在线程池中执行同步 boto3 调用
- **AND** 不应阻塞 FastAPI 事件循环
- **AND** 应正确处理线程池中的异常

#### Scenario: 流式下载异步适配

- **WHEN** 执行流式下载操作
- **THEN** 应使用异步生成器返回数据块
- **AND** 底层同步读取操作应在线程池中执行
- **AND** 应支持 FastAPI StreamingResponse

#### Scenario: 线程池资源管理

- **WHEN** 多个并发请求访问 S3 服务
- **THEN** 应使用 Python 默认线程池（asyncio 内置）
- **AND** boto3 客户端应线程安全，可被多个线程共享
- **AND** 不应创建过多线程导致资源耗尽

### Requirement: 单元测试覆盖

系统 SHALL 提供全面的单元测试,确保 S3 模块功能正确性和稳定性。

#### Scenario: 测试环境隔离

- **WHEN** 运行单元测试
- **THEN** 应使用 moto 库模拟 S3 服务
- **AND** 不应依赖真实的 S3 或 LocalStack
- **AND** 测试应快速执行（< 5 秒）

#### Scenario: 核心功能测试覆盖

- **WHEN** 运行测试套件
- **THEN** 应测试以下核心功能:
  - 文件上传（单文件、批量）
  - 文件下载（流式）
  - 文件删除（单文件、批量）
  - 文件列表（前缀、分页）
  - 文件元信息获取
  - 预签名 URL 生成（上传、下载）
  - 分片上传（创建、上传、完成、取消）
- **AND** 核心功能测试覆盖率应 > 90%

#### Scenario: 错误处理测试

- **WHEN** 测试异常场景
- **THEN** 应测试以下错误情况:
  - 文件不存在（404）
  - 文件大小超限（413）
  - S3 服务不可用（500）
  - 无效参数（400）
- **AND** 应验证错误响应格式正确

#### Scenario: 异步行为测试

- **WHEN** 测试异步方法
- **THEN** 应使用 pytest-asyncio 或 async_asgi_testclient
- **AND** 应验证异步操作正确执行
- **AND** 应测试并发场景（多个请求同时访问）

## REMOVED Requirements

无需移除的需求，所有现有功能保持不变。


# s3-storage Specification

## Purpose
TBD - created by archiving change add-s3-storage-module. Update Purpose after archive.
## Requirements
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

### Requirement: 单文件上传

系统 SHALL 支持通过 API 上传单个文件到 S3 存储。

#### Scenario: 成功上传文件

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/upload`
- **AND** 请求包含文件数据(multipart/form-data)和目标 key
- **THEN** 文件应成功上传到指定的 S3 key
- **AND** 响应返回 201 状态码
- **AND** 响应包含 key、bucket、size、etag 等元信息

#### Scenario: 自定义元数据

- **WHEN** 上传文件时指定 content_type 和自定义 metadata
- **THEN** 这些元数据应与文件一起存储在 S3
- **AND** 后续获取文件元信息时应能检索到

#### Scenario: 覆盖已存在文件

- **WHEN** 上传的 key 已存在于 S3
- **THEN** 默认行为应覆盖原有文件
- **AND** 响应应成功,不产生错误

#### Scenario: 上传失败处理

- **WHEN** S3 服务不可用或凭证无效
- **THEN** 应返回 500 错误和详细的错误信息
- **AND** 不应导致服务崩溃

#### Scenario: 文件大小超限

- **WHEN** 上传的文件大小超过 S3_MAX_FILE_SIZE 配置
- **THEN** 应返回 413 错误(Payload Too Large)
- **AND** 错误信息应说明最大允许大小
- **AND** 建议使用预签名 URL 或分片上传

#### Scenario: 自动使用分片上传

- **WHEN** 上传的文件大小超过 S3_MULTIPART_THRESHOLD
- **THEN** 应自动切换到分片上传模式
- **AND** 上传应成功完成
- **AND** 响应格式与普通上传一致

### Requirement: 批量文件上传

系统 SHALL 支持一次性上传多个文件,提高批量操作效率。

#### Scenario: 批量上传成功

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/upload/batch`
- **AND** 请求包含多个文件和对应的 key 列表
- **THEN** 所有文件应依次上传到对应的 key
- **AND** 响应返回 200 状态码
- **AND** 响应包含每个文件的上传结果列表

#### Scenario: 部分上传失败

- **WHEN** 批量上传中某些文件失败(如网络错误)
- **THEN** 成功的文件应保留在 S3
- **AND** 响应中应标明每个文件的成功/失败状态
- **AND** 失败的文件应包含错误信息

#### Scenario: 空文件列表处理

- **WHEN** 批量上传请求中文件列表为空
- **THEN** 应返回 400 错误
- **AND** 错误信息应说明"至少需要一个文件"

### Requirement: 文件下载

系统 SHALL 支持从 S3 下载文件,并使用流式响应以支持大文件。

#### Scenario: 成功下载文件

- **WHEN** 客户端发送 GET 请求到 `/api/v1/s3/download/{key}`
- **AND** 指定的 key 存在于 S3
- **THEN** 应返回 200 状态码和文件内容流
- **AND** Content-Type 应匹配文件的实际类型
- **AND** Content-Disposition 应设置为合适的文件名

#### Scenario: 下载不存在的文件

- **WHEN** 请求的 key 不存在于 S3
- **THEN** 应返回 404 错误
- **AND** 错误信息应说明"文件未找到"

#### Scenario: 大文件流式下载

- **WHEN** 下载大文件(如 >100MB)
- **THEN** 应使用 StreamingResponse 逐块返回数据
- **AND** 服务器内存占用应保持稳定
- **AND** 下载应能正常完成

#### Scenario: 支持 Range 请求(可选)

- **WHEN** 客户端发送带有 Range 头的请求
- **THEN** 应返回 206 状态码和指定范围的内容
- **AND** 支持断点续传

### Requirement: 大文件分片上传

系统 SHALL 支持大文件的分片上传(multipart upload),提高大文件上传的可靠性和效率。

#### Scenario: 创建分片上传

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/multipart/create`
- **AND** 请求包含目标 key 和可选的 content_type
- **THEN** 应在 S3 创建分片上传会话
- **AND** 响应返回 201 状态码
- **AND** 响应包含 upload_id(用于后续分片上传)

#### Scenario: 上传单个分片

- **WHEN** 客户端发送 PUT 请求到 `/api/v1/s3/multipart/upload-part`
- **AND** 请求包含 upload_id、part_number 和分片数据
- **THEN** 分片应成功上传
- **AND** 响应返回 200 状态码
- **AND** 响应包含 part_number 和 etag(用于完成上传)

#### Scenario: 完成分片上传

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/multipart/complete`
- **AND** 请求包含 upload_id 和所有分片的 etag 列表
- **THEN** S3 应合并所有分片为完整文件
- **AND** 响应返回 200 状态码
- **AND** 响应包含完整文件的 key、size、etag 等信息

#### Scenario: 取消分片上传

- **WHEN** 客户端发送 DELETE 请求到 `/api/v1/s3/multipart/abort`
- **AND** 请求包含 upload_id
- **THEN** 应取消上传并清理已上传的分片
- **AND** 响应返回 204 状态码

#### Scenario: 列出进行中的分片上传

- **WHEN** 客户端发送 GET 请求到 `/api/v1/s3/multipart/list`
- **THEN** 应返回所有进行中的分片上传会话
- **AND** 包含 key、upload_id、创建时间等信息

#### Scenario: 列出已上传的分片

- **WHEN** 客户端发送 GET 请求到 `/api/v1/s3/multipart/list-parts`
- **AND** 请求包含 upload_id
- **THEN** 应返回该上传会话已完成的分片列表
- **AND** 包含 part_number、size、etag 等信息
- **AND** 支持断点续传

#### Scenario: 分片大小验证

- **WHEN** 上传分片时
- **THEN** 除最后一个分片外,所有分片大小应至少为 5MB
- **AND** 如果分片过小(非最后一个)应返回 400 错误

#### Scenario: 分片数量限制

- **WHEN** 分片上传包含超过 10000 个分片
- **THEN** 应返回 400 错误
- **AND** 错误信息应说明"最多支持 10000 个分片"

### Requirement: 文件存在性检查

系统 SHALL 提供高效的文件存在性检查接口,无需下载文件内容。

#### Scenario: 文件存在

- **WHEN** 客户端发送 HEAD 请求到 `/api/v1/s3/exists/{key}`
- **AND** 指定的 key 存在于 S3
- **THEN** 应返回 200 状态码
- **AND** 响应体为空(仅返回状态码)

#### Scenario: 文件不存在

- **WHEN** 请求的 key 不存在于 S3
- **THEN** 应返回 404 状态码
- **AND** 响应体为空

#### Scenario: 高效性能

- **WHEN** 执行存在性检查
- **THEN** 应使用 S3 的 head_object 操作
- **AND** 不应下载文件内容
- **AND** 响应时间应小于 100ms(本地 LocalStack)

### Requirement: 单文件删除

系统 SHALL 支持删除指定 key 的文件。

#### Scenario: 成功删除文件

- **WHEN** 客户端发送 DELETE 请求到 `/api/v1/s3/{key}`
- **AND** 指定的 key 存在于 S3
- **THEN** 文件应从 S3 删除
- **AND** 响应返回 204 状态码(无内容)

#### Scenario: 删除不存在的文件

- **WHEN** 删除的 key 不存在于 S3
- **THEN** 应返回 404 错误
- **AND** 错误信息应说明"文件未找到"

#### Scenario: 幂等性

- **WHEN** 对同一个 key 重复发送删除请求
- **THEN** 第一次删除应成功(204)
- **AND** 后续删除应返回 404(文件已不存在)

### Requirement: 批量文件删除

系统 SHALL 支持一次性删除多个文件。

#### Scenario: 批量删除成功

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/delete/batch`
- **AND** 请求包含要删除的 key 列表
- **THEN** 所有指定的 key 应从 S3 删除
- **AND** 响应返回 200 状态码
- **AND** 响应包含每个 key 的删除结果

#### Scenario: 部分删除失败

- **WHEN** 批量删除中某些 key 不存在或删除失败
- **THEN** 响应中应标明每个 key 的成功/失败状态
- **AND** 成功删除的文件不应受影响

#### Scenario: 删除数量限制

- **WHEN** 批量删除请求包含超过 1000 个 key
- **THEN** 应返回 400 错误
- **AND** 错误信息应说明"最多支持 1000 个文件"

### Requirement: 文件列表

系统 SHALL 支持列出 S3 中的文件,支持前缀过滤和分页。

#### Scenario: 列出所有文件

- **WHEN** 客户端发送 GET 请求到 `/api/v1/s3/list`
- **AND** 不指定前缀和分页参数
- **THEN** 应返回存储桶中所有文件的列表(最多 1000 个)
- **AND** 每个文件包含 key、size、last_modified 等信息

#### Scenario: 前缀过滤

- **WHEN** 请求中指定 prefix 参数(如 "raw/")
- **THEN** 应只返回以该前缀开头的文件
- **AND** 模拟文件夹功能

#### Scenario: 分页查询

- **WHEN** 文件数量超过单页限制
- **THEN** 响应应包含 next_continuation_token
- **AND** 客户端可使用该 token 请求下一页
- **AND** 支持 max_keys 参数控制每页数量(默认 1000,最大 1000)

#### Scenario: 空结果

- **WHEN** 指定的前缀下没有文件
- **THEN** 应返回 200 状态码和空列表
- **AND** 不应返回错误

#### Scenario: 文件夹分隔符支持

- **WHEN** 请求中指定 delimiter 参数(通常为 "/")
- **THEN** 应返回"公共前缀"列表(模拟文件夹)
- **AND** 不返回嵌套的文件,只返回当前层级

### Requirement: 文件元信息获取

系统 SHALL 支持获取文件的详细元信息,无需下载文件内容。

#### Scenario: 获取文件元信息

- **WHEN** 客户端发送 GET 请求到 `/api/v1/s3/metadata/{key}`
- **AND** 指定的 key 存在于 S3
- **THEN** 应返回 200 状态码和完整的元信息
- **AND** 包含: key、bucket、size、etag、last_modified、content_type
- **AND** 包含自定义 metadata(如果有)

#### Scenario: 元信息不存在

- **WHEN** 请求的 key 不存在于 S3
- **THEN** 应返回 404 错误
- **AND** 错误信息应说明"文件未找到"

#### Scenario: 元信息时间格式

- **WHEN** 返回 last_modified 时间戳
- **THEN** 应使用 ISO 8601 格式(如 "2025-11-30T12:00:00Z")
- **AND** 时区应为 UTC

### Requirement: 上传预签名 URL 生成

系统 SHALL 支持生成上传预签名 URL,允许客户端直接上传文件到 S3,减轻服务器负载。

#### Scenario: 生成上传预签名 URL

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/presigned-url/upload`
- **AND** 请求包含目标 key 和可选的过期时间(秒)
- **THEN** 应返回 200 状态码和预签名 URL
- **AND** URL 应在指定时间内有效(默认 3600 秒)
- **AND** 客户端可使用该 URL 直接 PUT 上传文件

#### Scenario: 自定义过期时间

- **WHEN** 请求中指定 expires_in 参数(如 7200 秒)
- **THEN** 生成的 URL 应在该时间后失效
- **AND** 过期时间不应超过最大值(86400 秒)

#### Scenario: 过期时间超限

- **WHEN** 请求的 expires_in 超过 86400 秒
- **THEN** 应返回 400 错误
- **AND** 错误信息应说明"过期时间不能超过 86400 秒"

#### Scenario: 指定 Content-Type

- **WHEN** 请求中指定 content_type
- **THEN** 生成的预签名 URL 应限制上传该类型的文件
- **AND** 使用其他类型上传应失败

### Requirement: 下载预签名 URL 生成

系统 SHALL 支持生成下载预签名 URL,允许客户端直接从 S3 下载文件。

#### Scenario: 生成下载预签名 URL

- **WHEN** 客户端发送 POST 请求到 `/api/v1/s3/presigned-url/download`
- **AND** 请求包含目标 key 和可选的过期时间(秒)
- **THEN** 应返回 200 状态码和预签名 URL
- **AND** URL 应在指定时间内有效(默认 3600 秒)
- **AND** 客户端可使用该 URL 直接 GET 下载文件

#### Scenario: 文件不存在时生成 URL

- **WHEN** 为不存在的 key 生成下载预签名 URL
- **THEN** 应能成功生成 URL(不预先检查文件存在性)
- **AND** 客户端使用该 URL 时会收到 S3 的 404 错误
- **AND** 这是符合预期的行为

#### Scenario: 自定义响应头

- **WHEN** 请求中指定 response_content_disposition(如 "attachment; filename=myfile.pdf")
- **THEN** 生成的 URL 应包含该响应头参数
- **AND** 客户端下载时浏览器应使用指定的文件名

#### Scenario: 过期时间验证

- **WHEN** 请求的 expires_in 超过 86400 秒
- **THEN** 应返回 400 错误
- **AND** 错误信息应说明"过期时间不能超过 86400 秒"

### Requirement: 统一错误处理

系统 SHALL 提供统一的错误响应格式,便于客户端解析和调试。

#### Scenario: 标准错误响应格式

- **WHEN** API 操作失败(如 404、500)
- **THEN** 响应应包含以下字段:
  - `error`: 错误类型(如 "FileNotFound")
  - `message`: 人类可读的错误描述
  - `detail`: 可选的详细错误信息(调试用)
- **AND** HTTP 状态码应匹配错误类型

#### Scenario: S3 客户端错误捕获

- **WHEN** boto3 抛出 ClientError(如 NoSuchKey、AccessDenied)
- **THEN** 应被捕获并转换为相应的 HTTP 错误
- **AND** 不应暴露 S3 内部错误详情给客户端

#### Scenario: 日志记录

- **WHEN** 发生错误
- **THEN** 应记录详细的错误日志(包括 key、操作类型、错误栈)
- **AND** 日志级别应为 ERROR
- **AND** 便于排查问题

### Requirement: API 响应格式规范

系统 SHALL 使用一致的 JSON 响应格式,符合 RESTful 最佳实践。

#### Scenario: 成功响应格式

- **WHEN** API 操作成功
- **THEN** 响应应为 JSON 格式
- **AND** 数据结构应清晰且易于解析
- **AND** 使用标准的 HTTP 状态码(200、201、204)

#### Scenario: 时间戳格式统一

- **WHEN** 响应中包含时间戳字段
- **THEN** 应使用 ISO 8601 格式
- **AND** 时区应为 UTC
- **AND** 示例: "2025-11-30T12:00:00Z"

#### Scenario: 文件大小单位

- **WHEN** 响应中包含文件大小
- **THEN** 应以字节(bytes)为单位
- **AND** 使用整数类型

#### Scenario: OpenAPI 文档自动生成

- **WHEN** 访问 `/docs` 或 `/redoc` 端点
- **THEN** 应显示完整的 S3 API 文档
- **AND** 包含所有端点的请求/响应示例
- **AND** 基于 Pydantic schemas 自动生成

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


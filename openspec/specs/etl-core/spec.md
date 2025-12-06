# etl-core Specification

## Purpose
TBD - created by archiving change add-etl-pipeline-module. Update Purpose after archive.
## Requirements
### Requirement: MineRU 客户端配置管理

系统 SHALL 提供 MineRU API 客户端配置管理。

#### Scenario: 配置项完整性

- **WHEN** 应用启动并初始化 MineRU 客户端
- **THEN** 应从配置中读取以下参数:
  - `MINERU_API_KEY`: MineRU API 密钥（从环境变量读取）
  - `MINERU_API_ENDPOINT`: API 端点（默认 https://mineru.net/api/v4）
  - `MINERU_POLL_INTERVAL`: 轮询间隔（默认 5 秒）
  - `MINERU_TIMEOUT`: 超时时间（默认 600 秒）
- **AND** 所有配置应可通过环境变量覆盖

#### Scenario: API 密钥验证

- **WHEN** 初始化 MineRU 客户端
- **THEN** 应检查 MINERU_API_KEY 是否配置
- **AND** 如果未配置，应打印警告日志
- **AND** 不应阻止应用启动

### Requirement: MineRU 任务创建

系统 SHALL 支持调用 MineRU API 创建文档解析任务。

#### Scenario: 成功创建任务

- **WHEN** 调用 create_task() 方法
- **AND** 提供文件的 S3 预签名 URL
- **THEN** 应发送 POST 请求到 MineRU API
- **AND** 请求包含 url、model_version (默认 "vlm")
- **AND** 返回 task_id

#### Scenario: API 调用失败

- **WHEN** MineRU API 返回错误（401、429、500 等）
- **THEN** 应抛出 MineRUAPIError
- **AND** 错误信息应包含状态码和响应内容
- **AND** 记录详细错误日志

#### Scenario: 文件大小限制

- **WHEN** 文件大小超过 200MB
- **THEN** 应返回错误提示
- **AND** 建议用户使用分块上传或压缩文件

### Requirement: MineRU 任务状态查询

系统 SHALL 支持查询 MineRU 解析任务的状态。

#### Scenario: 查询任务状态

- **WHEN** 调用 get_task_status() 方法
- **AND** 提供 task_id
- **THEN** 应发送 GET 请求到 MineRU API
- **AND** 返回任务状态（pending、running、done、failed）
- **AND** 如果完成，返回 full_zip_url

#### Scenario: 任务进度信息

- **WHEN** 任务状态为 "running"
- **THEN** 应返回进度信息:
  - extracted_pages: 已解析页数
  - total_pages: 总页数
  - start_time: 开始时间

#### Scenario: 任务失败处理

- **WHEN** 任务状态为 "failed"
- **THEN** 应返回 err_msg 错误信息
- **AND** 抛出 MineRUTaskFailedError

### Requirement: MineRU 任务异步等待

系统 SHALL 支持异步轮询等待 MineRU 任务完成。

#### Scenario: 轮询直到完成

- **WHEN** 调用 wait_for_completion() 方法
- **AND** 提供 task_id
- **THEN** 应定期轮询任务状态（间隔 5 秒）
- **AND** 直到状态变为 "done" 或 "failed"
- **AND** 返回最终状态和结果 URL

#### Scenario: 轮询超时

- **WHEN** 轮询超过配置的超时时间（默认 600 秒）
- **THEN** 应停止轮询
- **AND** 抛出 MineRUTimeoutError
- **AND** 记录超时日志

#### Scenario: 异步非阻塞

- **WHEN** 执行轮询等待
- **THEN** 应使用 asyncio.sleep() 而不是 time.sleep()
- **AND** 不应阻塞事件循环

### Requirement: MineRU 结果下载和缓存

系统 SHALL 支持下载 MineRU 解析结果并缓存到本地。

#### Scenario: 下载 ZIP 压缩包

- **WHEN** 调用 download_result() 方法
- **AND** 提供 task_id 和 full_zip_url
- **THEN** 应下载 ZIP 文件到 `.mineru_cache/{task_id}/` 目录
- **AND** 解压 ZIP 文件
- **AND** 返回缓存目录路径

#### Scenario: 提取 Markdown 文件

- **WHEN** 调用 extract_markdown() 方法
- **AND** 提供缓存目录路径
- **THEN** 应读取 `auto/auto.md` 文件
- **AND** 返回 Markdown 文本内容
- **AND** 如果文件不存在，抛出异常

#### Scenario: 缓存目录管理

- **WHEN** 下载结果时
- **THEN** 应创建 `.mineru_cache/` 目录（如果不存在）
- **AND** 缓存结构为 `.mineru_cache/{task_id}/`
- **AND** 包含 full.zip、auto/、metadata.json

### Requirement: ETL 规则定义和存储

系统 SHALL 支持用户自定义 ETL 规则(JSON Schema + system_prompt),使用整数类型的规则ID。

#### Scenario: 规则数据模型

- **WHEN** 定义 ETL 规则
- **THEN** 应包含以下字段:
  - rule_id: 规则唯一标识(bigint,数据库自动生成)
  - name: 规则名称
  - description: 规则描述
  - json_schema: JSON Schema 对象
  - system_prompt: 系统提示词(可选)
  - created_at: 创建时间

#### Scenario: 创建规则

- **WHEN** 用户提交创建规则请求
- **AND** 提供 name、description、json_schema、system_prompt
- **THEN** 应验证 JSON Schema 格式正确
- **AND** 数据库自动生成唯一 rule_id (bigint)
- **AND** 保存规则到 `etl_rule` 表
- **AND** 返回 rule_id

#### Scenario: 规则验证

- **WHEN** 验证规则定义
- **THEN** 应检查:
  - name 不为空
  - json_schema 是有效的 JSON Schema
  - json_schema 包含 "type": "object"
- **AND** 如果验证失败,返回 400 错误和详细错误信息

#### Scenario: 查询规则

- **WHEN** 用户查询规则
- **AND** 提供 rule_id (int)
- **THEN** 应从 `etl_rule` 表读取规则
- **AND** 返回完整规则对象
- **AND** 如果规则不存在,返回 404 错误

#### Scenario: 列出所有规则

- **WHEN** 用户请求列出所有规则
- **THEN** 应查询 `etl_rule` 表
- **AND** 返回所有规则列表(rule_id、name、description)

#### Scenario: 删除规则

- **WHEN** 用户请求删除规则
- **AND** 提供 rule_id (int)
- **THEN** 应从 `etl_rule` 表删除记录
- **AND** 返回 204 状态码
- **AND** 如果规则不存在,返回 404 错误

### Requirement: ETL 规则引擎执行

系统 SHALL 提供规则引擎负责将 Markdown 转换为结构化 JSON。

#### Scenario: 构造 LLM Prompt

- **WHEN** 规则引擎应用规则
- **THEN** 应构造完整 prompt:
  - 包含 JSON Schema
  - 包含 Markdown 内容
  - 添加明确的输出格式要求

#### Scenario: 调用 LLM 转换

- **WHEN** 构造好 prompt 后
- **THEN** 应调用 LLM 服务的文本模型
- **AND** 使用规则的 system_prompt（如果有）
- **AND** 指定 response_format="json_object"
- **AND** 设置 temperature=0.3（更确定性）

#### Scenario: 输出验证

- **WHEN** LLM 返回转换结果
- **THEN** 应验证输出为有效 JSON
- **AND** 使用 jsonschema 库验证符合规则的 JSON Schema
- **AND** 如果验证失败，记录错误

#### Scenario: 验证失败重试

- **WHEN** LLM 输出不符合 Schema
- **THEN** 应在 prompt 中添加错误提示
- **AND** 重新调用 LLM
- **AND** 最多重试 2 次
- **AND** 如果仍失败，抛出 ETLTransformationError

### Requirement: 异步任务队列

系统 SHALL 提供异步任务队列管理 ETL 任务的执行,集成持久化存储。

#### Scenario: 任务队列初始化

- **WHEN** 应用启动时
- **THEN** 应初始化 asyncio.Queue 作为任务队列
- **AND** 启动后台 worker 协程消费任务
- **AND** worker 数量应可配置(默认 3 个)
- **AND** 注入 `ETLTaskRepository` 依赖

#### Scenario: 提交 ETL 任务

- **WHEN** 用户发送 POST 请求到 `/api/v1/etl/submit`
- **THEN** 应先调用 `task_repository.create_task()` 在数据库中创建记录
- **AND** 获取数据库生成的 task_id
- **AND** 创建内存中的 ETLTask 对象
- **AND** 将任务 ID 添加到队列
- **AND** 立即返回 202 状态码和 task_id (int)

#### Scenario: Worker 消费任务

- **WHEN** Worker 从队列获取任务 ID
- **THEN** 应更新任务状态为 "mineru_parsing"(仅内存)
- **AND** 执行完整 ETL 流程
- **AND** 更新任务进度(仅内存)
- **AND** 完成后调用 `task_repository.update_task()` 更新数据库
- **AND** 状态设置为 "completed" 或 "failed"

#### Scenario: 任务状态持久化

- **WHEN** 任务状态更新为 "completed" 或 "failed"
- **THEN** 应调用 `task_repository.update_task()` 持久化到数据库
- **AND** 包含: task_id、status、progress、result、error、metadata
- **AND** 更新 updated_at 时间戳

#### Scenario: 任务超时处理

- **WHEN** 任务执行超过配置的超时时间(默认 600 秒)
- **THEN** 应取消任务执行
- **AND** 更新任务状态为 "failed"(内存和数据库)
- **AND** 错误信息为 "Task timeout"

### Requirement: ETL 服务核心流程

系统 SHALL 实现完整的 ETL 服务流程,从原始文件到结构化 JSON,使用整数类型ID。

#### Scenario: 完整 ETL 流程(MVP)

- **WHEN** Worker 执行 ETL 任务
- **THEN** 应按顺序执行以下步骤:
  1. 从 S3 生成文件的预签名下载 URL(使用int类型的user_id和project_id)
  2. 调用 MineRU 创建解析任务(传入预签名 URL)
  3. 异步等待 MineRU 任务完成
  4. 下载并缓存解析结果
  5. 提取 Markdown 文件
  6. 加载 ETL 规则(使用int类型的rule_id)
  7. 应用规则进行数据转换
  8. 上传结果 JSON 到 S3
  9. 更新任务状态为 "completed"(数据库和内存)

#### Scenario: 步骤1 - 生成预签名 URL

- **WHEN** 生成 S3 预签名 URL
- **THEN** 应调用 S3Service.generate_presigned_url() 方法
- **AND** 路径为 `/users/{user_id}/raw/{project_id}/{filename}` (user_id和project_id为int)
- **AND** 设置过期时间(默认 3600 秒)

#### Scenario: 步骤2 - 创建 MineRU 任务

- **WHEN** 创建 MineRU 解析任务
- **THEN** 应调用 MineRUClient.create_task()
- **AND** 传入预签名 URL
- **AND** 更新任务进度为 "mineru_parsing"(仅内存)

#### Scenario: 步骤3 - 等待 MineRU 完成

- **WHEN** 等待 MineRU 任务完成
- **THEN** 应调用 MineRUClient.wait_for_completion()
- **AND** 定期更新任务进度(显示已解析页数,仅内存)
- **AND** 处理超时和失败情况

#### Scenario: 步骤4-5 - 下载和提取

- **WHEN** 下载并提取 Markdown
- **THEN** 应调用 MineRUClient.download_result() 和 extract_markdown()
- **AND** 缓存到 `.mineru_cache/{task_id}/`
- **AND** 更新任务进度为 "llm_processing"(仅内存)

#### Scenario: 步骤6-7 - 应用规则

- **WHEN** 应用 ETL 规则
- **THEN** 应从 repository 加载规则(使用int类型rule_id)
- **AND** 调用规则引擎进行转换
- **AND** 验证输出符合 Schema

#### Scenario: 步骤8 - 上传结果

- **WHEN** 上传结果到 S3
- **THEN** 应调用 S3Service.upload_file() 方法
- **AND** 路径为 `/users/{user_id}/processed/{project_id}/{filename}.json` (ID为int)
- **AND** content_type 设置为 "application/json"

#### Scenario: 错误处理

- **WHEN** ETL 流程中任何步骤失败
- **THEN** 应捕获异常并记录错误日志
- **AND** 更新任务状态为 "failed"(数据库和内存)
- **AND** 在任务对象中保存错误信息
- **AND** 不影响其他任务执行

### Requirement: 任务状态查询

系统 SHALL 提供 API 接口查询 ETL 任务的状态和结果,使用整数类型任务ID。

#### Scenario: 查询单个任务状态

- **WHEN** 用户发送 GET 请求到 `/api/v1/etl/tasks/{task_id}` (task_id为int)
- **THEN** 优先从内存查询任务详细信息
- **AND** 如果内存中不存在,从数据库查询
- **AND** 返回任务详细信息:
  - task_id: 任务 ID (int)
  - user_id: 用户 ID (int)
  - project_id: 项目 ID (int)
  - rule_id: 规则 ID (int)
  - status: 任务状态(pending、mineru_parsing、llm_processing、completed、failed)
  - progress: 当前进度描述
  - created_at: 创建时间
  - updated_at: 更新时间
  - result: 处理结果(status=completed 时)
  - error: 错误信息(status=failed 时)

#### Scenario: 任务不存在

- **WHEN** 查询不存在的任务 ID
- **THEN** 应返回 404 错误
- **AND** 错误信息为 "Task not found"

#### Scenario: 任务结果包含

- **WHEN** 任务状态为 "completed"
- **THEN** result 应包含:
  - output_path: S3 输出路径
  - output_size: 输出文件大小(字节)
  - processing_time: 处理耗时(秒)
  - mineru_task_id: MineRU 任务 ID

### Requirement: 任务列表查询

系统 SHALL 支持查询用户的所有 ETL 任务,使用整数类型过滤参数。

#### Scenario: 列出用户任务

- **WHEN** 用户发送 GET 请求到 `/api/v1/etl/tasks`
- **AND** 提供 user_id 查询参数(int)
- **THEN** 优先从内存中过滤任务列表
- **AND** 如果需要历史数据,从数据库查询
- **AND** 返回该用户的所有任务列表
- **AND** 按创建时间倒序排列
- **AND** 支持分页(limit、offset 参数)

#### Scenario: 按状态过滤

- **WHEN** 查询参数包含 status
- **THEN** 应只返回指定状态的任务

#### Scenario: 按项目过滤

- **WHEN** 查询参数包含 project_id (int)
- **THEN** 应只返回该项目的任务

### Requirement: 统一错误处理

系统 SHALL 提供统一的错误响应格式。

#### Scenario: 标准错误响应

- **WHEN** ETL API 操作失败
- **THEN** 响应应包含:
  - error: 错误类型(如 "RuleNotFound")
  - message: 人类可读的错误描述
  - detail: 详细错误信息(可选)
- **AND** HTTP 状态码应匹配错误类型

#### Scenario: 常见错误类型

- **WHEN** 发生不同类型的错误
- **THEN** 应使用相应的 HTTP 状态码:
  - 400: 无效参数(InvalidRule、InvalidSchema、TaskNotCompleted)
  - 404: 资源不存在(TaskNotFound、RuleNotFound、FileNotFound、TableNotFound)
  - 500: 服务器错误(MineRUError、ETLTransformationError、LLMError)
  - 503: 服务不可用(MineRUTimeout)

### Requirement: 配置管理

系统 SHALL 提供灵活的 ETL 配置管理。

#### Scenario: 配置项

- **WHEN** 应用启动
- **THEN** 应从配置中读取:
  - ETL_QUEUE_SIZE: 队列最大容量(默认 1000)
  - ETL_WORKER_COUNT: Worker 数量(默认 3)
  - ETL_TASK_TIMEOUT: 任务超时时间(默认 600 秒)
  - ETL_CACHE_DIR: 缓存目录(默认 .mineru_cache)
  - ETL_RULES_DIR: 规则目录(默认 .etl_rules)
- **AND** 所有配置应可通过环境变量覆盖

### Requirement: ETL任务持久化存储

系统 SHALL 将ETL任务状态持久化到Supabase数据库,提供可靠的任务历史记录。

#### Scenario: 任务创建时持久化

- **WHEN** 用户提交ETL任务
- **THEN** 应同时在内存队列和Supabase `etl_task` 表中创建任务记录
- **AND** 数据库返回自动生成的 task_id (bigint)
- **AND** 任务初始状态为 "pending"

#### Scenario: 任务完成时更新数据库

- **WHEN** ETL任务处理成功完成
- **THEN** 应更新Supabase中的任务记录
- **AND** 状态设置为 "completed"
- **AND** result字段存储输出路径、文件大小、处理时间等信息

#### Scenario: 任务失败时更新数据库

- **WHEN** ETL任务处理失败
- **THEN** 应立即更新Supabase中的任务记录
- **AND** 状态设置为 "failed"
- **AND** error字段存储详细错误信息

#### Scenario: 中间状态仅更新内存

- **WHEN** 任务状态变为 "mineru_parsing" 或 "llm_processing"
- **THEN** 仅更新内存中的任务对象
- **AND** 不触发数据库写入操作(优化性能)

#### Scenario: 持久化数据结构

- **WHEN** 任务持久化到数据库
- **THEN** 字段映射如下:
  - `id` (bigint) ← task_id
  - `user_id` (bigint) ← user_id
  - `project_id` (bigint) ← project_id
  - `rule_id` (bigint) ← rule_id
  - `filename` (text) ← filename
  - `status` (text) ← status
  - `progress` (bigint) ← progress
  - `result` (jsonb) ← result对象序列化
  - `error` (text) ← error
  - `metadata` (jsonb) ← metadata
  - `created_at` / `updated_at` ← 时间戳

### Requirement: ETL任务Repository接口

系统 SHALL 提供 `ETLTaskRepository` 抽象接口和Supabase实现,封装任务数据访问逻辑。

#### Scenario: 创建任务

- **WHEN** 调用 `create_task()` 方法
- **AND** 提供 user_id, project_id, filename, rule_id
- **THEN** 在Supabase `etl_task` 表中插入新记录
- **AND** 返回包含数据库生成的 task_id 的 `ETLTask` 对象

#### Scenario: 查询任务

- **WHEN** 调用 `get_task(task_id: int)` 方法
- **THEN** 从Supabase查询任务记录
- **AND** 返回 `ETLTask` 对象,如果不存在则返回 None

#### Scenario: 更新任务

- **WHEN** 调用 `update_task()` 方法
- **AND** 提供 task_id 和更新字段(status, progress, result, error, metadata)
- **THEN** 更新Supabase中的对应记录
- **AND** 返回更新后的 `ETLTask` 对象

#### Scenario: 列出任务

- **WHEN** 调用 `list_tasks()` 方法
- **AND** 可选提供 user_id, project_id, status 过滤条件
- **THEN** 从Supabase查询符合条件的任务列表
- **AND** 按创建时间倒序返回

### Requirement: ETL结果挂载到Table

系统 SHALL 提供接口将成功完成的ETL任务结果挂载到Table的data字段。

#### Scenario: 挂载接口调用

- **WHEN** 用户发送 POST 请求到 `/api/v1/etl/tasks/{task_id}/mount`
- **AND** 请求体包含 `table_id` (int) 和 `json_path` (str)
- **THEN** 验证任务存在且状态为 "completed"
- **AND** 从S3下载任务的输出JSON文件
- **AND** 调用 `TableService.create_context_data()` 将JSON挂载到指定路径

#### Scenario: 挂载数据结构

- **WHEN** 执行挂载操作
- **THEN** 挂载的key为原始文件名(去除.json扩展名)
- **AND** 挂载的value为完整的JSON内容(解析后的Python dict)
- **AND** `json_path` 参数为JSON Pointer格式(如 "/documents/invoices")

#### Scenario: 任务状态验证

- **WHEN** 挂载请求的任务状态不是 "completed"
- **THEN** 返回 400 错误
- **AND** 错误信息为 "Task not completed yet"

#### Scenario: Table存在性验证

- **WHEN** 挂载请求的 table_id 不存在
- **THEN** 返回 404 错误
- **AND** 错误信息为 "Table not found"

#### Scenario: 重复key处理

- **WHEN** 挂载路径下已存在相同的key
- **THEN** 依赖 `TableService.create_context_data()` 的现有逻辑
- **AND** 抛出 `BusinessException` 并返回 400 错误

#### Scenario: 挂载成功响应

- **WHEN** 挂载操作成功完成
- **THEN** 返回 200 状态码
- **AND** 响应包含:
  - `success`: true
  - `message`: "ETL result mounted successfully"
  - `mounted_path`: 实际挂载的完整路径(json_path + key)


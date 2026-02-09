## ADDED Requirements

### Requirement: Redis 任务运行态存储
系统 SHALL 使用 Redis 存储 ETL 任务的运行态（中间状态、阶段信息、进度与尝试次数），以支持快速查询与跨进程恢复。

#### Scenario: 运行态写入与 TTL
- **WHEN** 任务处于 `pending/mineru_parsing/llm_processing` 等运行态
- **THEN** 系统应将运行态写入 Redis（例如 `etl:task:{task_id}`）
- **AND** 应为 Redis 中的运行态设置可配置的 TTL
- **AND** 运行态更新应是幂等的（重复写入不会导致状态倒退）

#### Scenario: 运行态与终态并存
- **WHEN** 任务进入终态（`completed/failed/cancelled`）
- **THEN** 系统应将终态持久化到 Supabase
- **AND** Redis 可保留短期缓存以加速查询（TTL 可更短）

### Requirement: 链式 ARQ Job 与阶段重试
系统 SHALL 使用 ARQ 将 ETL 执行拆分为链式 Job（至少包含 OCR 与后处理两个阶段），并支持从指定阶段重试。

#### Scenario: OCR 与后处理拆分
- **WHEN** 用户提交 ETL 任务
- **THEN** 系统应 enqueue OCR Job（MineRU/其他 OCRProvider）
- **AND** OCR Job 成功后应 enqueue 后处理 Job（LLM/其他 PostProcessor）
- **AND** 阶段切换时应更新 Redis 中的阶段与进度

#### Scenario: 从后处理阶段重试（不重复跑 OCR）
- **GIVEN** OCR 阶段已成功完成
- **AND** 系统已保存可重试的阶段产物指针（例如 MineRU markdown 的 S3 key）
- **WHEN** 用户调用 `POST /api/v1/etl/tasks/{task_id}/retry`
- **AND** 请求体指定 `from_stage="postprocess"`
- **THEN** 系统应仅 enqueue 后处理 Job
- **AND** 不应重新调用 OCRProvider/MineRU

#### Scenario: 阶段重试策略可配置
- **WHEN** 系统执行 OCR 或后处理阶段
- **THEN** 应支持按阶段配置重试策略（最大次数、退避策略等）
- **AND** 当达到最大次数仍失败时，应将任务标记为 `failed` 并保留失败阶段信息

### Requirement: ETL 任务取消控制面
系统 SHALL 提供取消 ETL 任务的控制面端点，并仅允许取消“已提交但尚未开始执行”的任务。

#### Scenario: 成功取消排队中的任务
- **WHEN** 用户调用 `POST /api/v1/etl/tasks/{task_id}/cancel`
- **AND** 任务为 `status=pending` 且尚未开始执行
- **THEN** 系统应将任务标记为 `cancelled`
- **AND** 应阻止后续 ARQ worker 执行该任务（例如通过 job 取消或执行前状态检查）
- **AND** 应将取消结果持久化到 Supabase

#### Scenario: 取消运行中的任务被拒绝
- **WHEN** 用户请求取消 `mineru_parsing/llm_processing` 等已进入执行阶段的任务
- **THEN** 系统应拒绝取消请求
- **AND** 返回明确错误（例如 409 Conflict 或 400 Bad Request）

### Requirement: ETL 规则支持跳过后处理（Skip LLM）
系统 SHALL 支持在用户自定义 ETL 规则中配置“跳过大模型后处理阶段”，使得任务仅产出 OCR 结果的稳定 JSON 包装，而不调用 LLM。

#### Scenario: 规则声明跳过后处理
- **WHEN** 用户创建/更新 ETL 规则
- **THEN** 规则应支持配置 `postprocess_mode`
- **AND** `postprocess_mode` 至少支持：
  - `llm`（默认：执行后处理）
  - `skip`（跳过后处理）

#### Scenario: 跳过后处理时不调用 LLM
- **GIVEN** 规则的 `postprocess_mode="skip"`
- **WHEN** 后处理阶段执行
- **THEN** 系统不应调用任何 LLM 模型
- **AND** 应产出一个 JSON 结果，至少包含：
  - `markdown_s3_key`（或等价指针）
  - `provider_task_id`（如 mineru_task_id）
  - `metadata`（如页数/耗时/版本等，若可用）

### Requirement: 全局默认 ETL 规则
系统 SHALL 提供一个全局默认 ETL 规则，以降低用户门槛，避免用户必须先创建自定义规则才能提交任务。

#### Scenario: 全局默认规则可被使用
- **WHEN** 用户提交 ETL 任务但未提供 `rule_id`
- **THEN** 系统应自动选择全局默认规则用于该任务
- **AND** 全局默认规则应默认 `postprocess_mode="skip"`
- **AND** 该任务的结果应为稳定的 JSON 包装（markdown 指针 + 必要元信息），且不调用 LLM

#### Scenario: 全局默认规则的可发现性
- **WHEN** 用户调用 `GET /api/v1/etl/rules`
- **THEN** 响应应包含全局默认规则（明确标识为 system/global）
- **AND** 用户无需创建任何规则即可发现并理解默认行为

### Requirement: 后处理策略可插拔与大文本策略
系统 SHALL 支持为后处理阶段选择不同算法（例如直接结构化、分块总结、分块提取），以适配大 markdown 的处理场景。

#### Scenario: 基于规则显式选择策略
- **WHEN** 规则配置了 `postprocess_strategy`
- **THEN** 系统应按该策略执行后处理
- **AND** 至少支持：
  - `direct-json`（直接结构化输出）
  - `chunked-summarize`（分块总结后再结构化）

#### Scenario: 基于 markdown 大小自动切换策略
- **WHEN** markdown 超过可配置阈值（例如按字符数/字节数）
- **THEN** 系统应自动选择一个“大文本友好”的策略（例如 `chunked-summarize`）
- **AND** 自动选择的策略与阈值应可配置

### Requirement: 可插拔 OCRProvider 与 PostProcessor 接口
系统 SHALL 以面向接口编程方式定义 OCR 与后处理模块，使 MineRU/LLM 仅作为具体实现之一。

#### Scenario: OCRProvider 接口最小契约
- **WHEN** ETL 执行需要 OCR 阶段能力
- **THEN** 系统应通过 OCRProvider 接口完成解析
- **AND** OCRProvider 的输出应至少包含：
  - 解析文本/markdown（或其可访问指针）
  - 上游 provider 的任务标识（例如 mineru_task_id）
  - 可追踪的元数据（如页数/耗时/版本）

#### Scenario: PostProcessor 接口最小契约
- **WHEN** ETL 执行需要后处理阶段能力
- **THEN** 系统应通过 PostProcessor 接口将 OCR 结果转换为结构化 JSON
- **AND** PostProcessor 应支持传入规则（JSON Schema + system_prompt）并输出符合 Schema 的 JSON

### Requirement: 阶段产物持久化以支持用户决策式重试
系统 SHALL 在“OCR 已完成但后处理失败”等场景下，持久化足够的阶段产物指针，使用户可在之后决定是否重试。

#### Scenario: 后处理失败后保存可重试指针
- **GIVEN** OCR 已完成且存在阶段产物指针（例如 markdown 的 S3 key）
- **WHEN** 后处理阶段失败
- **THEN** 系统应将可重试所需的最小指针写入 Supabase `etl_task.metadata`
- **AND** 用户后续重试时应可复用该指针而无需重新 OCR

## MODIFIED Requirements

### Requirement: 异步任务队列
系统 SHALL 提供异步任务队列管理 ETL 任务的执行，并使用 ARQ 作为队列/worker 实现，集成 Redis 运行态与 Supabase 持久化。

#### Scenario: 任务队列初始化
- **WHEN** 应用启动并启用 ETL
- **THEN** 应初始化 ARQ 队列配置（Redis 连接、队列名、并发度等）
- **AND** ARQ worker 应可独立于 API 进程运行（部署可选）
- **AND** 系统应能够在 worker 执行期间更新 Redis 运行态

#### Scenario: 提交 ETL 任务
- **WHEN** 用户发送 POST 请求到 `/api/v1/etl/submit`
- **THEN** 系统应确定本次任务使用的 rule：
  - 若请求包含 rule_id，则使用该 rule_id
  - 若请求未包含 rule_id，则使用全局默认规则
- **AND** 应先调用 `task_repository.create_task()` 在数据库中创建记录
- **AND** 获取数据库生成的 task_id (int)
- **AND** 初始化 Redis 运行态（status=`pending`，progress=0，phase=ocr）
- **AND** enqueue OCR Job 并记录 job_id（写入 Redis）
- **AND** 立即返回 202 状态码和 task_id (int)

#### Scenario: Worker 消费任务（链式执行）
- **WHEN** ARQ worker 开始执行 OCR Job
- **THEN** 应更新 Redis 运行态为 `mineru_parsing`
- **AND** 成功完成后应写入阶段产物指针（如 `artifact_mineru_markdown_key`）
- **AND** enqueue 后处理 Job 并更新 Redis 运行态进入 `llm_processing`

#### Scenario: 任务状态持久化
- **WHEN** 任务状态更新为 `completed/failed/cancelled`
- **THEN** 应调用 `task_repository.update_task()` 持久化到数据库
- **AND** 包含: task_id、status、progress、result、error、metadata
- **AND** 更新 updated_at 时间戳

### Requirement: ETL 服务核心流程
系统 SHALL 实现完整的 ETL 服务流程，从原始文件到结构化 JSON，并将 OCR 与后处理拆分为链式 ARQ Job 执行。

#### Scenario: 完整 ETL 流程（OCR → 后处理）
- **WHEN** OCR Job 执行 ETL 任务的 OCR 阶段
- **THEN** 应按顺序执行以下步骤:
  1. 从 S3 生成文件的预签名下载 URL
  2. 调用 OCRProvider（默认 MineRU）创建解析任务并等待完成
  3. 将阶段产物（至少 markdown 或其指针）写入可重试存储（默认 S3），并将指针写入 Redis
- **AND** 后处理 Job 执行时应：
  4. 加载 ETL 规则（rule_id）
  5. 调用 PostProcessor（默认 LLM+规则引擎）转换为结构化 JSON
  6. 上传最终 JSON 到 S3
  7. 将终态写入 Supabase

#### Scenario: 错误处理（阶段化）
- **WHEN** OCR 或后处理任一阶段失败
- **THEN** 应捕获异常并记录错误日志
- **AND** 在 Redis 中记录失败阶段与错误信息
- **AND** 将任务终态更新为 `failed` 并持久化到数据库
- **AND** 若 OCR 已完成，应保留可重试指针以支持“仅重试后处理”

### Requirement: 任务状态查询
系统 SHALL 提供 API 接口查询 ETL 任务的状态和结果，查询时优先从 Redis 获取运行态，Redis 未命中时回退 Supabase。

#### Scenario: 查询单个任务状态（Redis 优先）
- **WHEN** 用户发送 GET 请求到 `/api/v1/etl/tasks/{task_id}`
- **THEN** 系统应优先从 Redis 查询任务详细信息
- **AND** 如果 Redis 中不存在，则从数据库查询
- **AND** 返回任务详细信息（包含 status/progress/result/error/metadata 等）

#### Scenario: 任务不存在
- **WHEN** 查询不存在的任务 ID
- **THEN** 应返回 404 错误
- **AND** 错误信息为 "Task not found"

### Requirement: 任务列表查询
系统 SHALL 支持查询用户的所有 ETL 任务，列表查询应以 Supabase 的历史记录为基底，并用 Redis 的运行态覆盖最新状态。

#### Scenario: 列出用户任务（Redis 覆盖）
- **WHEN** 用户发送 GET 请求到 `/api/v1/etl/tasks`
- **THEN** 系统应从数据库查询任务列表
- **AND** 对于仍在运行的任务，应使用 Redis 的运行态覆盖数据库返回的 status/progress/metadata
- **AND** 返回按创建时间倒序排列的任务列表，并支持分页

### Requirement: 配置管理
系统 SHALL 提供灵活的 ETL 配置管理，并新增 Redis/ARQ 相关配置项以支持新执行引擎。

#### Scenario: 配置项（含 Redis 与 ARQ）
- **WHEN** 应用启动
- **THEN** 应从配置中读取:
  - ETL_QUEUE_SIZE: 队列最大容量(默认 1000)
  - ETL_WORKER_COUNT: Worker 数量(默认 3)
  - ETL_TASK_TIMEOUT: 任务超时时间(默认 600 秒)
  - ETL_CACHE_DIR: 缓存目录(默认 .mineru_cache)
  - ETL_RULES_DIR: 规则目录(默认 .etl_rules)
  - ETL_REDIS_URL: Redis 连接串（用于运行态与 ARQ）
  - ETL_REDIS_PREFIX: Redis key 前缀（默认 `etl:`）
  - ETL_STATE_TTL_SECONDS: 运行态 TTL（默认可配置）
  - ETL_ARQ_QUEUE_NAME: ARQ 队列名（默认可配置）
  - ETL_OCR_MAX_ATTEMPTS: OCR 阶段最大尝试次数（默认可配置）
  - ETL_POSTPROCESS_MAX_ATTEMPTS: 后处理阶段最大尝试次数（默认可配置）
  - ETL_RETRY_BACKOFF_BASE_SECONDS: 重试基础退避（默认可配置）
  - ETL_RETRY_BACKOFF_MAX_SECONDS: 重试最大退避（默认可配置）
  - ETL_POSTPROCESS_CHUNK_THRESHOLD_CHARS: 大文本阈值（默认可配置）
  - ETL_POSTPROCESS_CHUNK_SIZE_CHARS: 分块大小（默认可配置）
  - ETL_POSTPROCESS_MAX_CHUNKS: 分块数量上限（默认可配置）
  - ETL_GLOBAL_RULE_ENABLED: 是否启用全局默认规则（默认 true）
  - ETL_GLOBAL_RULE_ID: 全局默认规则 ID（可选；若未配置则使用内置规则实现）
- **AND** 所有配置应可通过环境变量覆盖

### Requirement: ETL 规则定义和存储
系统 SHALL 支持用户自定义 ETL 规则（JSON Schema + system_prompt + 后处理配置），使用整数类型的规则ID。

#### Scenario: 规则数据模型（含后处理配置）
- **WHEN** 定义 ETL 规则
- **THEN** 应包含以下字段:
  - rule_id: 规则唯一标识(bigint,数据库自动生成)
  - name: 规则名称
  - description: 规则描述
  - json_schema: JSON Schema 对象（在 `postprocess_mode="llm"` 时为必填）
  - system_prompt: 系统提示词(可选)
  - postprocess_mode: 后处理模式（`llm|skip`，默认 `llm`）
  - postprocess_strategy: 后处理策略（可选，例如 `direct-json|chunked-summarize`；在 `postprocess_mode="skip"` 时可忽略）
  - created_at: 创建时间

#### Scenario: 创建规则（默认执行后处理）
- **WHEN** 用户提交创建规则请求
- **AND** 未指定 postprocess_mode
- **THEN** 系统应默认使用 `postprocess_mode="llm"`
- **AND** 应验证 JSON Schema 格式正确
- **AND** 数据库自动生成唯一 rule_id (bigint)
- **AND** 保存规则到 `etl_rule` 表
- **AND** 返回 rule_id

#### Scenario: 创建规则（跳过后处理）
- **WHEN** 用户提交创建规则请求
- **AND** 指定 `postprocess_mode="skip"`
- **THEN** 系统应允许 `json_schema` 为空或被忽略
- **AND** 保存规则到 `etl_rule` 表

### Requirement: ETL 规则引擎执行
系统 SHALL 提供规则引擎/后处理组件负责将 OCR 产物（markdown）转换为结构化 JSON，且允许按规则跳过 LLM 或选择不同算法。

#### Scenario: postprocess_mode=llm 时的 LLM 转换
- **GIVEN** `postprocess_mode="llm"`
- **WHEN** 规则引擎应用规则
- **THEN** 应构造完整 prompt:
  - 包含 JSON Schema
  - 包含 Markdown 内容（或分块后的聚合内容）
  - 添加明确的输出格式要求
- **AND** 应调用 LLM 服务的文本模型
- **AND** 使用规则的 system_prompt（如果有）
- **AND** 指定 response_format="json_object"

#### Scenario: postprocess_mode=skip 时的 No-Op 输出
- **GIVEN** `postprocess_mode="skip"`
- **WHEN** 执行后处理阶段
- **THEN** 系统应跳过 LLM 调用
- **AND** 返回稳定的 JSON 包装（至少包含 markdown 指针与必要元信息）

### Requirement: ETL任务持久化存储
系统 SHALL 将 ETL 任务状态持久化到 Supabase 数据库，并将运行态（中间状态/阶段）存储在 Redis，以提供可靠的任务历史记录与高性能查询。

#### Scenario: 任务创建时持久化
- **WHEN** 用户提交 ETL 任务
- **THEN** 应在 Supabase `etl_task` 表中创建任务记录
- **AND** 数据库返回自动生成的 task_id (bigint)
- **AND** 任务初始状态为 "pending"
- **AND** 同步初始化 Redis 运行态

#### Scenario: 任务完成/失败/取消时更新数据库
- **WHEN** ETL 任务进入 `completed/failed/cancelled`
- **THEN** 应立即更新 Supabase 中的任务记录
- **AND** result/error/metadata 应包含用于审计与重试决策的必要信息

#### Scenario: 中间状态仅更新 Redis
- **WHEN** 任务状态变为 "mineru_parsing" 或 "llm_processing"
- **THEN** 仅更新 Redis 中的运行态
- **AND** 不触发数据库写入操作（优化性能）


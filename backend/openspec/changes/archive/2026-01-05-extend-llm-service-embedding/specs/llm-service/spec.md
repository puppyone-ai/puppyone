# llm-service Specification Delta

## MODIFIED Requirements

### Requirement: LLM 服务配置管理

系统 SHALL 提供灵活的 LLM 服务配置管理,支持多种模型提供商(包括文本生成模型和 embedding 模型)。

#### Scenario: 配置项完整性

- **WHEN** 应用启动并初始化 LLM 服务
- **THEN** 应从配置中读取以下参数:
  - 文本模型列表配置
  - Embedding 模型列表配置
  - API 密钥配置(支持多个提供商)
  - 请求超时时间(默认 60 秒)
  - 重试次数(默认 3 次)
  - 温度参数(默认 0.3,仅用于文本生成)
  - Embedding 向量维度(默认 1536)
  - Embedding 批量处理大小(默认 100)
- **AND** 所有配置应可通过环境变量覆盖

#### Scenario: 多模型提供商支持

- **WHEN** 配置 LLM 模型列表
- **THEN** 应支持以下文本模型提供商:
  - DeepSeek (deepseek-ai/DeepSeek-V3.2-Exp)
  - MiniMax (MiniMaxAI/MiniMax-M2)
  - Moonshot (moonshotai/Kimi-K2-Thinking)
  - Google (google/gemini-3-pro-preview)
  - Anthropic (anthropic/claude-sonnet-4.5)
  - OpenAI (openai/gpt-5-mini)
- **AND** 应通过 OpenRouter 支持以下 embedding 模型:
  - baai/bge-m3
  - qwen/qwen3-embedding-8b
  - qwen/qwen3-embedding-4b
  - openai/text-embedding-3-small
  - google/gemini-embedding-001
- **AND** 通过 LiteLLM 统一接入 OpenRouter API

#### Scenario: 默认模型配置

- **WHEN** 配置模型
- **THEN** 应有默认文本模型(如 deepseek-ai/DeepSeek-V3.2-Exp)
- **AND** 应有默认 embedding 模型(如 openai/text-embedding-3-small)
- **AND** 用户可覆盖默认模型
- **AND** 默认 embedding 向量维度为 1536
- **AND** 所有模型通过 OpenRouter 统一接入

## ADDED Requirements

### Requirement: Embedding 模型调用

系统 SHALL 支持调用 embedding 模型将文本转换为向量表示。

#### Scenario: 成功生成单文本向量

- **WHEN** 调用 embedding 模型接口生成单个文本的向量
- **AND** 提供有效的文本和模型名称
- **THEN** 应使用异步方式调用 embedding API
- **AND** 返回一个浮点数列表作为向量表示
- **AND** 向量维度应与模型配置一致(默认 1536)
- **AND** 响应时间应小于配置的超时时间

#### Scenario: 空文本处理

- **WHEN** 提供空字符串或仅包含空白字符的文本
- **THEN** 应抛出 InvalidInputError
- **AND** 错误信息应说明文本不能为空

#### Scenario: 文本过长处理

- **WHEN** 提供的文本超过模型的 token 限制(如 8191 tokens)
- **THEN** 应抛出 TextTooLongError
- **AND** 错误信息应包含实际长度和限制长度

### Requirement: 批量向量生成

系统 SHALL 支持批量生成多个文本的向量表示,以提高性能。

#### Scenario: 成功批量生成向量

- **WHEN** 调用批量向量生成接口
- **AND** 提供多个有效文本(如 50 个)
- **THEN** 应将文本分批处理(每批不超过配置的 batch_size)
- **AND** 返回与输入文本数量相同的向量列表
- **AND** 向量顺序应与输入文本顺序一致
- **AND** 批量处理应比逐个处理更快

#### Scenario: 空列表处理

- **WHEN** 提供空的文本列表
- **THEN** 应返回空的向量列表
- **AND** 不应调用外部 API

#### Scenario: 批量处理中的部分失败

- **WHEN** 批量处理中某个文本导致错误(如文本过长)
- **THEN** 应抛出包含详细信息的异常
- **AND** 错误信息应指出是哪个文本(索引)导致失败
- **AND** 不应返回部分结果

#### Scenario: 自动分批处理

- **WHEN** 提供的文本数量超过 batch_size(如 250 个文本,batch_size=100)
- **THEN** 应自动分为多个批次(3 批)
- **AND** 每批次独立调用 API
- **AND** 最终结果应合并所有批次的向量
- **AND** 保持原始文本顺序

### Requirement: Embedding 错误处理

系统 SHALL 为 embedding 模型调用提供完善的错误处理机制。

#### Scenario: Embedding API 限流错误

- **WHEN** Embedding API 返回 429 (Rate Limit) 错误
- **THEN** 应自动重试(最多 3 次)
- **AND** 使用指数退避策略(1s、2s、4s)
- **AND** 如果所有重试失败,抛出 RateLimitError

#### Scenario: Embedding API 密钥错误

- **WHEN** Embedding API 返回 401 (Unauthorized) 错误
- **THEN** 不应重试
- **AND** 立即抛出 APIKeyError
- **AND** 错误信息应说明 API 密钥无效或缺失

#### Scenario: Embedding 请求超时

- **WHEN** Embedding API 请求超过配置的超时时间
- **THEN** 应取消请求
- **AND** 抛出 TimeoutError
- **AND** 错误信息应包含超时时间和模型名称

#### Scenario: Embedding 错误日志记录

- **WHEN** 发生 embedding 调用错误
- **THEN** 应记录详细的错误日志:
  - 模型名称
  - 文本数量(批量处理时)
  - 错误类型和消息
  - 堆栈跟踪
- **AND** 日志级别应为 ERROR

### Requirement: Embedding 服务依赖注入

系统 SHALL 为 embedding 服务提供 FastAPI 依赖注入支持。

#### Scenario: Embedding 服务单例模式

- **WHEN** 通过依赖注入获取 EmbeddingService
- **THEN** 应返回全局单例实例
- **AND** 避免重复初始化
- **AND** 线程安全

#### Scenario: Embedding 服务依赖注入示例

- **WHEN** Chunking 模块需要调用 embedding 服务
- **THEN** 应使用 `Depends(get_embedding_service)` 注入
- **AND** 无需手动管理服务生命周期

### Requirement: Embedding 服务懒加载

系统 SHALL 为 embedding 服务采用懒加载策略,优化应用启动速度。

#### Scenario: 延迟客户端初始化

- **WHEN** EmbeddingService 实例被创建
- **THEN** 不应立即导入 OpenAI 或 LiteLLM 库
- **AND** 不应立即初始化 API 客户端
- **AND** 服务初始化应快速完成

#### Scenario: 首次使用时加载

- **WHEN** 首次调用向量生成方法
- **THEN** 应在方法内部加载必要的客户端库
- **AND** 应初始化 API 客户端
- **AND** 应记录加载耗时日志
- **AND** 后续调用应复用已加载的客户端

#### Scenario: 加载失败处理

- **WHEN** 懒加载客户端时发生导入错误
- **THEN** 应抛出清晰的初始化错误
- **AND** 错误信息应说明缺少哪个依赖包

### Requirement: Embedding 配置验证

系统 SHALL 在启动时验证 embedding 配置的有效性。

#### Scenario: Embedding API 密钥验证

- **WHEN** 应用启动
- **THEN** 应检查 embedding 所需的 API 密钥是否配置
- **AND** 如果缺失关键密钥,应打印警告日志
- **AND** 不应阻止应用启动

#### Scenario: Embedding 模型名称验证

- **WHEN** 配置 embedding 模型列表
- **THEN** 应验证模型名称格式正确
- **AND** 如果格式错误,应打印警告日志

#### Scenario: Embedding 向量维度验证

- **WHEN** 配置向量维度
- **THEN** 应验证维度为正整数
- **AND** 应与选定模型的输出维度匹配
- **AND** 如果不匹配,应打印警告日志

#### Scenario: Embedding 批量大小验证

- **WHEN** 配置批量处理大小
- **THEN** 应验证 batch_size 为正整数
- **AND** 应在合理范围内(1-2048)
- **AND** 如果超出范围,应使用默认值并打印警告


## 1. 扩展 LLM 配置支持 Embedding

- [x] 1.1 在 `src/llm/config.py` 中添加 embedding 模型配置
  - [x] 1.1.1 添加 `default_embedding_model` 字段
  - [x] 1.1.2 添加 `supported_embedding_models` 列表
  - [x] 1.1.3 添加 `embedding_dimensions` 配置(默认 1536)
  - [x] 1.1.4 添加 `embedding_batch_size` 配置(默认 100)
- [x] 1.2 在 `src/llm/schemas.py` 中添加 embedding 相关 schema
  - [x] 1.2.1 创建 `EmbeddingRequest` 模型
  - [x] 1.2.2 创建 `EmbeddingResponse` 模型
  - [x] 1.2.3 创建 `BatchEmbeddingRequest` 模型
  - [x] 1.2.4 创建 `BatchEmbeddingResponse` 模型

## 2. 实现 Embedding 服务类

- [x] 2.1 创建 `src/llm/embedding_service.py`
  - [x] 2.1.1 实现 `EmbeddingService` 类基础结构
  - [x] 2.1.2 实现懒加载机制(复用 LLMService 的模式)
  - [x] 2.1.3 实现 `generate_embedding()` 方法(单文本向量生成)
  - [x] 2.1.4 实现 `generate_embeddings_batch()` 方法(批量向量生成)
  - [x] 2.1.5 实现自动分批处理逻辑
  - [x] 2.1.6 添加详细的日志记录

## 3. 错误处理和重试机制

- [x] 3.1 复用现有的错误处理机制
  - [x] 3.1.1 确认现有异常类适用于 embedding(APIKeyError、TimeoutError 等)
  - [x] 3.1.2 如需要,在 `src/llm/exceptions.py` 中添加 embedding 特定异常
- [x] 3.2 实现 embedding 调用的重试逻辑
  - [x] 3.2.1 API 限流错误处理(429,指数退避)
  - [x] 3.2.2 服务不可用错误处理(503,自动重试)
  - [x] 3.2.3 认证错误处理(401,不重试)
  - [x] 3.2.4 请求超时处理
  - [x] 3.2.5 输入验证(空文本、文本过长等)

## 4. 依赖注入支持

- [x] 4.1 在 `src/llm/dependencies.py` 中添加 embedding 服务依赖
  - [x] 4.1.1 实现 `get_embedding_service()` 依赖函数
  - [x] 4.1.2 确保单例模式和线程安全
  - [x] 4.1.3 添加使用示例注释
- [x] 4.2 更新 `src/llm/__init__.py`
  - [x] 4.2.1 导出 `EmbeddingService`
  - [x] 4.2.2 导出 embedding 相关 schema
  - [x] 4.2.3 导出 `get_embedding_service`

## 5. 测试

- [x] 5.1 编写 EmbeddingService 单元测试
  - [x] 5.1.1 测试单文本向量生成
  - [x] 5.1.2 测试批量向量生成
  - [x] 5.1.3 测试自动分批处理
  - [x] 5.1.4 测试空文本和边界情况
  - [x] 5.1.5 测试错误处理和重试
  - [x] 5.1.6 测试懒加载机制
- [x] 5.2 编写配置测试
  - [x] 5.2.1 测试 embedding 配置加载
  - [x] 5.2.2 测试配置验证
- [x] 5.3 编写集成测试
  - [x] 5.3.1 测试与真实 API 的集成(使用 mock 或测试 API key)
  - [x] 5.3.2 测试依赖注入

## 6. 文档和集成

- [x] 6.1 更新代码文档
  - [x] 6.1.1 在 `EmbeddingService` 中添加详细的 docstring
  - [x] 6.1.2 为所有公共方法添加参数说明和返回值说明
  - [x] 6.1.3 添加使用示例代码注释
- [x] 6.2 更新模块文档
  - [x] 6.2.1 在 `src/llm/__init__.py` 中更新模块文档字符串
  - [x] 6.2.2 说明 LLM 模块现在支持文本生成和 embedding 两种能力
- [x] 6.3 更新 OpenSpec 规范
  - [x] 6.3.1 确保所有需求和场景已实现
  - [x] 6.3.2 标记所有任务为完成状态

## 7. 可选优化(未来考虑)

- [ ] 7.1 考虑重构现有 `service.py` 为 `text_service.py`
  - [ ] 7.1.1 评估重命名的影响范围
  - [ ] 7.1.2 如果采用,更新所有导入路径
  - [ ] 7.1.3 确保向后兼容
- [ ] 7.2 提取共享基类 `BaseModelService`
  - [ ] 7.2.1 识别 TextService 和 EmbeddingService 的共同逻辑
  - [ ] 7.2.2 创建 `base_service.py` 提取通用代码
  - [ ] 7.2.3 让两个服务类继承基类


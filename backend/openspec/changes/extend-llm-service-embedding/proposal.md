# Change: 扩展 LLM 服务支持 Embedding 模型

## Why

为了支持即将实现的语义搜索和数据分块功能,系统需要调用 embedding 模型将文本转换为向量。Embedding 模型调用与现有的文本生成模型调用本质上都是"外部模型 API 调用",应该共享配置管理、错误处理、重试机制等基础设施。

将 embedding 支持集成到现有 LLM 服务模块的优势:
- 统一的模型调用层,避免代码重复
- 共享配置(API keys、超时、重试)和错误处理逻辑
- 为未来扩展更多模型类型(audio、vlm 等)建立良好的架构基础
- 更少的模块,更低的维护成本

## What Changes

- 扩展 `src/llm/` 模块,添加 embedding 模型调用能力
- 新增 `src/llm/embedding_service.py` - embedding 模型服务类
- 扩展 `src/llm/config.py` - 添加 embedding 模型配置
- 扩展 `src/llm/schemas.py` - 添加 embedding 请求/响应模型
- 扩展 `src/llm/exceptions.py` - 添加 embedding 特定异常(如需要)
- 扩展 `src/llm/dependencies.py` - 添加 embedding 服务依赖注入
- 通过 OpenRouter 支持多个 embedding 模型:
  - baai/bge-m3
  - qwen/qwen3-embedding-8b
  - qwen/qwen3-embedding-4b
  - openai/text-embedding-3-small (默认, 1536维)
  - google/gemini-embedding-001
- 使用 LiteLLM 统一接入 OpenRouter API
- 实现异步批量向量生成接口
- 采用与 LLMService 一致的懒加载策略

## Impact

- 受影响的规范: `llm-service` (MODIFIED - 添加 embedding 能力)
- 受影响的代码:
  - `src/llm/config.py` - 添加 embedding 配置项
  - `src/llm/service.py` - 可选:重命名为 `text_service.py` 以区分职责
  - `src/llm/embedding_service.py` - 新增 embedding 服务类
  - `src/llm/schemas.py` - 添加 embedding 相关 schema
  - `src/llm/exceptions.py` - 可能添加 embedding 特定异常
  - `src/llm/dependencies.py` - 添加 `get_embedding_service()`
  - `src/llm/__init__.py` - 导出新的公共接口
- 依赖: 使用已有的 `openai>=2.8.0` 和 `litellm>=1.80.7`,无需额外安装
- 非破坏性变更: 不影响现有文本生成功能
- 为未来扩展 audio、vlm 等模型类型奠定架构基础


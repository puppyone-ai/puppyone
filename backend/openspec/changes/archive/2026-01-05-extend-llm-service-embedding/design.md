# 扩展 LLM 服务支持 Embedding 设计文档

## Context

系统需要支持语义搜索功能,需要将文本转换为向量表示(embeddings)。当前系统已有 LLM 服务层 (`src/llm/`) 用于文本生成,现需要在同一模块中添加 embedding 支持。

**背景约束:**
- 已安装 `openai>=2.8.0` 和 `litellm>=1.80.7` 依赖
- 现有 LLMService 已经实现了懒加载、配置管理、错误处理等最佳实践
- 计划中的语义搜索功能将使用 OpenAI text-embedding-3-small 模型(1536维)
- 未来可能需要支持更多模型类型(audio、vlm 等)

**利益相关者:**
- 语义搜索功能模块(主要使用者)
- LLM 模块维护者
- 未来可能需要向量化的其他功能模块

## Goals / Non-Goals

### Goals
1. 在现有 LLM 模块中添加 embedding 能力,避免创建新模块
2. 支持单个和批量文本的向量生成
3. 复用现有的配置管理、错误处理、重试机制
4. 支持多个 embedding 模型提供商(OpenAI、Azure OpenAI 等)
5. 保持与现有 LLMService 一致的架构模式
6. 为未来扩展更多模型类型奠定良好架构基础

### Non-Goals
1. 不实现向量存储功能(由数据库层负责)
2. 不实现向量相似度计算(由数据库 pgvector 负责)
3. 不实现文本分块功能(由独立的 chunking service 负责)
4. 暂不重构现有 LLMService(保持向后兼容)
5. 暂不提取共享基类(可作为未来优化)

## Decisions

### Decision 1: 扩展现有 LLM 模块而非创建新模块

**理由:**
- Embedding 模型调用与文本生成模型调用本质相同,都是"外部模型 API 调用"
- 可以共享配置(API keys、超时、重试)、错误处理、懒加载等基础设施
- 减少模块数量,降低维护成本
- 为未来扩展 audio、vlm 等模型类型建立统一架构
- LiteLLM 本身就支持多种模型类型(`litellm.embedding()`, `litellm.acompletion()` 等)

**备选方案:**
- ❌ 创建独立的 `src/embedding/` 模块: 会导致代码重复,未来每种模型都需要新模块
- ❌ 在 LLMService 类中直接添加方法: 单个类职责过重,不利于扩展
- ✅ **在 LLM 模块中添加新的 EmbeddingService 类**: 职责分离,代码复用

### Decision 2: 复用 LiteLLM 的 embedding 接口

**理由:**
- 项目已使用 LiteLLM 进行文本生成,技术栈一致
- LiteLLM 提供统一的 `aembedding()` 异步接口
- 通过 OpenRouter 统一管理所有模型接入
- 简化代码,不需要单独维护 OpenAI SDK

**实现方式:**
```python
# 使用 LiteLLM 的 embedding 接口
from litellm import aembedding

class EmbeddingService:
    def __init__(self):
        self._litellm_loaded = False
        self._aembedding = None
        
    def _ensure_litellm(self):
        if not self._litellm_loaded:
            from litellm import aembedding
            self._aembedding = aembedding
            self._litellm_loaded = True
```

**备选方案:**
- ❌ 单独使用 OpenAI SDK: 增加额外依赖,不统一
- ✅ **使用 LiteLLM**: 与现有架构一致,统一管理

### Decision 3: 创建独立的 EmbeddingService 类

**理由:**
- 职责分离: LLMService 负责文本生成,EmbeddingService 负责向量生成
- 便于扩展: 未来可以添加 AudioService、VisionService 等
- 保持向后兼容: 不修改现有 LLMService,不影响现有代码
- 代码可读性: 每个服务类职责清晰

**架构:**
```
src/llm/
├── config.py              # 统一配置(文本+embedding+未来其他)
├── service.py             # LLMService(文本生成)
├── embedding_service.py   # EmbeddingService(向量生成) [新增]
├── schemas.py             # 所有模型的 schema
├── exceptions.py          # 统一异常
├── dependencies.py        # 依赖注入
└── __init__.py           # 导出公共接口
```

### Decision 4: 实现批量向量生成接口

**理由:**
- Embedding API 支持单次请求处理多个文本
- 批量处理可显著减少网络往返次数和总处理时间
- 语义搜索场景需要对大量文本分块进行向量化
- OpenRouter 支持批量请求

**实现方式:**
```python
async def generate_embeddings_batch(
    self,
    texts: list[str],
    model: Optional[str] = None,
    batch_size: int = 100  # 可配置
) -> list[list[float]]:
    """批量生成向量,自动分批处理"""
    # 分批逻辑
    results = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        batch_vectors = await self._call_api(batch, model)
        results.extend(batch_vectors)
    return results
```

### Decision 5: 复用现有错误处理机制

**理由:**
- 现有 LLMService 已经实现了完善的错误处理(APIKeyError、TimeoutError、RateLimitError 等)
- Embedding API 的错误类型与文本生成 API 基本一致
- 避免重复代码

**实现方式:**
- 直接使用 `src/llm/exceptions.py` 中的异常类
- 如果有 embedding 特定的错误,添加新的异常类(如 `TextTooLongError`)
- 复用相同的重试逻辑和指数退避策略

### Decision 6: 采用懒加载策略

**理由:**
- 与现有 LLMService 保持一致
- LiteLLM 库导入较慢(20秒+)
- 只有在实际需要向量生成时才加载
- 提升应用启动速度

**实现方式:**
```python
class EmbeddingService:
    def __init__(self):
        self.config = llm_config
        self._litellm_loaded = False
        self._aembedding = None
        logger.info("EmbeddingService initialized (litellm not loaded yet)")
        
    def _ensure_litellm(self):
        """懒加载 LiteLLM"""
        if not self._litellm_loaded:
            logger.info("Lazy-loading litellm library...")
            from litellm import aembedding
            self._aembedding = aembedding
            self._litellm_loaded = True
```

## Risks / Trade-offs

### Risk 1: LLM 模块职责过重

**影响:** 随着支持的模型类型增多,llm 模块可能变得庞大

**缓解措施:**
- 每个模型类型使用独立的服务类(TextService、EmbeddingService 等)
- 配置和异常等共享代码保持模块化
- 未来如果模块过大,可以考虑重命名为 `src/models/` 并重新组织
- 可选:提取 `BaseModelService` 基类封装通用逻辑

### Risk 2: Embedding API 费用成本

**影响:** 大规模向量生成可能产生较高费用

**缓解措施:**
- 使用高性价比模型(如 text-embedding-3-small)
- OpenRouter 提供统一计费和额度管理
- 实现批量处理减少 API 调用次数
- 添加速率限制保护
- 监控 API 使用量和费用

### Risk 3: API 限流

**影响:** OpenRouter 和各模型提供商有速率限制(TPM, RPM),高并发场景可能触发限流

**缓解措施:**
- 实现指数退避重试机制
- 批量处理减少请求频率
- 配置合理的超时和重试次数
- 考虑使用队列异步处理大批量任务
- OpenRouter 提供了统一的限流管理

### Trade-off: 不立即重构现有代码

**选择:** 添加新的 EmbeddingService,不修改现有 LLMService

**理由:**
- 保持向后兼容,不影响现有功能
- 降低变更风险
- 快速交付 embedding 能力

**代价:** 
- 无法立即享受代码重构带来的好处
- 可能存在一定程度的代码重复

**未来优化路径:**
1. 先实现 EmbeddingService,验证架构可行性
2. 识别 LLMService 和 EmbeddingService 的共同模式
3. 提取 BaseModelService 基类
4. 逐步让各服务类继承基类,减少重复代码

## Migration Plan

### 阶段 1: 扩展配置和 Schema (0.5天)

1. 在 `src/llm/config.py` 中添加 embedding 配置项
2. 在 `src/llm/schemas.py` 中添加 embedding schema
3. 运行测试确保现有配置不受影响

**验证标准:** 配置加载成功,现有文本生成功能正常

### 阶段 2: 实现 Embedding 服务 (1-1.5天)

1. 创建 `src/llm/embedding_service.py`
2. 实现核心方法(单文本和批量向量生成)
3. 实现错误处理和重试逻辑
4. 添加详细日志

**验证标准:** 可以成功调用 OpenAI API 生成向量

### 阶段 3: 依赖注入和测试 (0.5-1天)

1. 在 `dependencies.py` 中添加 embedding 服务依赖
2. 更新 `__init__.py` 导出新接口
3. 编写单元测试
4. 编写集成测试

**验证标准:** 所有测试通过,依赖注入正常工作

### 阶段 4: 集成到 chunking service (由后续提案完成)

1. 在 chunking service 中注入 EmbeddingService
2. 进行端到端测试

**验证标准:** 语义搜索功能正常工作

### 回滚计划

如果 embedding 功能出现严重问题:
1. 删除 `src/llm/embedding_service.py`
2. 回退 `config.py` 和 `schemas.py` 中的 embedding 相关变更
3. 回退 `dependencies.py` 和 `__init__.py` 的变更
4. 现有文本生成功能不受影响

## Open Questions

1. **是否需要立即重构现有 service.py?**
   - 可选:重命名为 `text_service.py` 以与 `embedding_service.py` 对称
   - 决策: 第一版不重构,保持向后兼容;未来根据需要优化

2. **是否需要提取 BaseModelService 基类?**
   - 可以封装懒加载、重试等通用逻辑
   - 决策: 第一版不提取,先实现功能;未来如果添加第三种模型时再重构

3. **是否需要支持向量维度降维?**
   - OpenAI 的 text-embedding-3-* 系列模型支持维度压缩
   - 决策: 第一版不实现,未来根据存储和性能需求考虑

4. **批量处理的最优 batch_size 是多少?**
   - 需要平衡 API 限制、网络传输和并发性能
   - 决策: 默认 100,可通过配置调整,后续根据实际使用情况优化

5. **未来如何命名模块?**
   - 当支持更多模型类型时,`llm` 这个名称可能不再准确
   - 决策: 先保持 `llm` 名称;未来如果支持 4+ 种模型类型,考虑重命名为 `models` 或 `ai_services`


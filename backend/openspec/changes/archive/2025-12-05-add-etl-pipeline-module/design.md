# ETL 管道模块技术设计（简化版 MVP）

## Context

ContextBase 需要将企业用户上传的文档数据转换为结构化 JSON，为 LLM 提供友好的数据访问接口。当前系统已有 S3 存储能力，但缺少数据解析和转换能力。

**MVP 策略**: 第一版聚焦核心功能，快速验证技术方案可行性。使用成熟的第三方服务（MineRU）进行文档解析，简化规则引擎设计。

**约束条件**:
- MVP 仅支持文档类型（PDF、DOC、DOCX、PPT、PPTX、图像）
- 使用 MineRU API 进行文档解析（限制: 200MB、600页）
- 处理时间可能较长（几十秒到几分钟），需要异步处理
- 规则引擎简化为 JSON Schema + LLM 清洗
- 需要与现有 S3 模块无缝集成
- 使用 litellm SDK 集成文本模型

**利益相关者**:
- 后端开发者：实现和维护 ETL 模块
- 前端开发者：调用 ETL API 并展示处理状态
- 企业用户：上传文档并获取结构化数据

## Goals / Non-Goals

### Goals
1. 实现简化的 ETL 流程：文档上传 → MineRU 解析 → LLM 清洗 → JSON 输出
2. 集成 MineRU API 进行文档解析
3. 提供基于 JSON Schema 的灵活规则定义
4. 支持用户自定义 system_prompt
5. 异步任务队列，避免阻塞 API 响应
6. 与 S3 模块集成，自动读取/存储文件
7. 统一的 LLM 服务层（仅文本模型）

### Non-Goals
1. 多种解析器支持（仅 MineRU）
2. 内置规则模板（用户完全自定义）
3. OCR、VLM、音频模型支持（后续扩展）
4. 实时流式处理
5. 分布式任务队列（初期使用内存队列）
6. 视频处理
7. 模型微调和训练

## Decisions

### Decision 1: 使用 MineRU API 进行文档解析

**选择**: 使用 MineRU (https://mineru.net) 作为唯一的文档解析服务

**理由**:
- MineRU 是成熟的文档解析服务，支持多种格式（PDF、DOC、DOCX、PPT、PPTX、图像）
- 使用 VLM 模型提供高质量解析结果（Markdown 格式）
- 无需自建解析基础设施，快速交付 MVP
- API 调用简单，支持异步轮询
- 解析结果包含 Markdown、JSON 等多种格式

**配置示例**:
```python
from src.etl.mineru import MineRUClient

client = MineRUClient(api_key=os.getenv("MINERU_API_KEY"))

# 创建解析任务
task_id = await client.create_task(
    url="https://s3.example.com/presigned-url",
    model_version="vlm"
)

# 等待任务完成
await client.wait_for_completion(task_id)

# 下载并缓存结果
cache_dir = await client.download_result(task_id, ".mineru_cache")

# 提取 Markdown
markdown = await client.extract_markdown(cache_dir)
```

**限制**:
- 单文件大小 ≤ 200MB
- 文件页数 ≤ 600 页
- 每天 2000 页高优先级额度

**替代方案**:
- ❌ 自建解析器（pdfplumber、python-docx 等）: 质量不稳定，维护成本高
- ❌ 其他 OCR/VLM 服务: 需要额外集成多个服务

### Decision 2: LLM 集成 - litellm SDK

**选择**: 使用 litellm Python SDK 作为 LLM 集成层（仅文本模型）

**理由**:
- 统一的 API 接口支持 100+ 模型提供商
- 开箱即用的错误处理、重试、fallback 机制
- 支持异步调用
- 活跃的社区维护
- 符合项目 requirements 中指定的技术栈

**配置示例**:
```python
from litellm import acompletion

async def call_text_model(prompt: str, system_prompt: str = None, model: str = "deepseek-ai/DeepSeek-V3.2-Exp"):
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    
    response = await acompletion(
        model=model,
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0.3,  # 更确定性的输出
        timeout=60,
    )
    return response.choices[0].message.content
```

**替代方案**:
- ❌ 直接调用各家 SDK（OpenAI、Anthropic 等）: 维护成本高，接口不统一
- ❌ LangChain: 过于复杂，功能超出需求

### Decision 3: 规则引擎 - JSON Schema + Prompt

**选择**: 使用 JSON Schema 定义输出结构，结合 system_prompt 驱动 LLM 转换

**理由**:
- JSON Schema 是标准化的结构定义语言
- system_prompt 提供灵活的转换逻辑描述
- LLM 可根据 Schema 和 Prompt 生成符合要求的输出
- 易于用户自定义（上传 Schema + system_prompt）
- 简化实现，快速交付 MVP

**规则结构**:
```json
{
  "rule_id": "doc_extraction_001",
  "name": "Document Structure Extraction",
  "description": "Extract structured information from documents",
  "json_schema": {
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "summary": {"type": "string"},
      "sections": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "heading": {"type": "string"},
            "content": {"type": "string"}
          }
        }
      }
    },
    "required": ["title", "sections"]
  },
  "system_prompt": "You are a document analysis expert. Extract structured information from the provided Markdown document and return it as JSON."
}
```

**转换流程**:
```python
# 构造 User Prompt
user_prompt = f"""
Please extract information from the following Markdown document according to this JSON Schema:

{json.dumps(rule.json_schema, indent=2)}

Markdown Document:
{markdown_content}

Return a valid JSON object that matches the schema.
"""

# 调用 LLM
result_json = await llm_service.call_text_model(
    prompt=user_prompt,
    system_prompt=rule.system_prompt,
    response_format="json_object"
)

# 验证 JSON Schema
jsonschema.validate(json.loads(result_json), rule.json_schema)
```

**替代方案**:
- ❌ 内置规则模板: 增加开发时间，不够灵活
- ❌ 自定义 DSL: 开发成本高，学习曲线陡峭
- ❌ Python 代码规则: 安全性风险，难以沙箱化

### Decision 4: 任务队列 - asyncio Queue (MVP)

**选择**: 使用 asyncio.Queue + 后台 worker 实现任务队列

**理由**:
- 简单且轻量级，无需额外依赖
- 满足单机异步处理需求
- 易于测试和调试
- 后续可无缝升级为 Redis Queue 或 Celery

**实现**:
```python
import asyncio

class ETLQueue:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.tasks: dict[str, ETLTask] = {}
    
    async def submit(self, task: ETLTask):
        self.tasks[task.id] = task
        await self.queue.put(task.id)
    
    async def worker(self):
        while True:
            task_id = await self.queue.get()
            task = self.tasks[task_id]
            await self.execute_etl(task)
            self.queue.task_done()
```

**替代方案**:
- ❌ Celery + Redis: 过度设计，MVP 无需分布式
- ❌ RQ (Redis Queue): 增加 Redis 依赖，暂无必要

### Decision 5: S3 路径规范

**选择**: 使用结构化路径 `/users/{user_id}/{type}/{project_id}/{filename}`

**理由**:
- 清晰的命名空间，避免文件冲突
- 支持多用户、多项目隔离
- `raw` 和 `processed` 分离，便于管理和清理
- 与 S3 前缀过滤天然兼容

**路径示例**:
```
原始文件: /users/user123/raw/project456/report.pdf
处理后:   /users/user123/processed/project456/report.pdf.json
```

**替代方案**:
- ❌ 扁平化路径: 难以管理，文件名冲突风险高
- ❌ 使用 UUID 作为文件名: 可读性差，调试困难

### Decision 6: 异步适配策略

**选择**: 使用 `asyncio.to_thread()` 将同步 litellm 调用包装为异步

**理由**:
- FastAPI 路由需要异步函数避免阻塞事件循环
- litellm 提供 `acompletion()` 异步接口，直接使用
- 如果某些操作是同步的（如文件 I/O），使用 `asyncio.to_thread()` 在线程池执行

**实现**:
```python
async def call_llm(self, prompt: str):
    # litellm 原生异步支持
    response = await acompletion(
        model=self.model,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content

async def parse_file_with_local_lib(self, file_path: str):
    # 同步操作包装为异步
    return await asyncio.to_thread(self._sync_parse, file_path)
```

### Decision 7: 解析器与文件类型映射

**选择**: 维护一个配置化的文件扩展名到解析器的映射表

**理由**:
- 灵活配置，易于扩展
- 支持用户覆盖默认解析器
- 支持多个解析器处理同一文件类型

**配置示例**:
```python
DEFAULT_PARSER_MAPPING = {
    ".png": "ocr",
    ".jpg": "ocr",
    ".jpeg": "ocr",
    ".pdf": "vlm",  # 默认使用 VLM，用户可选 document
    ".docx": "document",
    ".md": "document",
    ".txt": "document",
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
}
```

**API 支持**:
```json
POST /api/v1/etl/submit
{
  "user_id": "user123",
  "project_id": "project456",
  "filename": "report.pdf",
  "parser_type": "document",  // 可选，覆盖默认
  "rule_name": "document_structure"
}
```

## Risks / Trade-offs

### Risk 1: LLM API 限流和成本

**风险**: 大量 ETL 任务可能触发 LLM 提供商的 API 限流，或产生高额费用

**缓解措施**:
- 实现请求速率限制（rate limiting）
- 支持配置单用户/单项目的配额
- 监控 API 调用次数和成本
- 提供本地解析器作为 fallback（如 PaddleOCR 本地部署）

### Risk 2: 任务超时和失败处理

**风险**: ETL 任务可能因网络、模型错误、超时等原因失败

**缓解措施**:
- 设置任务超时时间（默认 5 分钟）
- 实现重试机制（最多 3 次）
- 记录详细错误日志
- 提供任务失败通知（可选）

### Risk 3: 内存队列的局限性

**风险**: 内存队列在应用重启时丢失任务

**缓解措施**:
- Phase 1: 接受短暂数据丢失（适用于初期低流量）
- Phase 2: 迁移到 Redis Queue 实现持久化
- 任务状态可选持久化到数据库（如 SQLite）

### Risk 4: LLM 输出不符合 JSON Schema

**风险**: LLM 生成的 JSON 可能不符合预期 Schema

**缓解措施**:
- 在 Prompt 中明确说明 Schema 要求
- 使用 `pydantic` 验证输出
- 验证失败时重试（最多 2 次）
- 提供人工审核接口（后续扩展）

### Trade-off 1: 灵活性 vs 复杂度

**选择**: 优先简单实现，后续按需扩展

- ✅ Phase 1: 内置 3-4 个常见规则
- ✅ Phase 2: 支持用户自定义规则
- ⏸ Phase 3: 可视化规则编辑器（未来）

### Trade-off 2: 性能 vs 准确性

**选择**: 优先准确性，使用更强的模型

- 使用 DeepSeek-V3、Claude Sonnet 4.5 等高质量模型
- 接受较长的处理时间（几十秒到几分钟）
- 提供快速模式（使用轻量模型）作为可选项

## Migration Plan

### Phase 1: MVP (2-3 weeks)

**目标**: 实现基本 ETL 流程

1. Week 1:
   - 实现 LLM 服务模块
   - 实现 4 个核心解析器（OCR、VLM、Audio、Document）
2. Week 2:
   - 实现规则引擎和 3 个内置规则
   - 实现 ETL 服务和任务队列
3. Week 3:
   - 实现 ETL API 路由
   - 集成测试和文档

**部署**:
- 软发布，仅开放给内部测试用户
- 监控 API 调用量和错误率

### Phase 2: 增强功能 (1-2 weeks)

**目标**: 支持自定义规则和更多文件类型

1. 自定义规则管理 API
2. 电子表格解析器（Excel、CSV）
3. 任务状态持久化（SQLite）

### Phase 3: 生产优化 (按需)

**目标**: 提升性能和可靠性

1. 迁移到 Redis Queue
2. 实现任务优先级和调度
3. 添加监控和告警
4. 优化 LLM 调用成本

### 回滚计划

如果 ETL 模块出现严重问题：
1. 在 `main.py` 中注释掉 ETL 路由注册
2. 不影响现有 S3 和其他模块功能
3. 修复问题后重新启用

## Open Questions

1. **Q**: 是否需要支持视频处理？
   - **A**: Phase 1 不支持，后续可通过视频转音频+截帧的方式支持

2. **Q**: 自定义规则的安全性如何保证？
   - **A**: Phase 1 仅支持 JSON Schema + Prompt，不允许执行自定义代码

3. **Q**: 如何处理超大文件（如 100MB+ 的 PDF）？
   - **A**: 设置文件大小限制（默认 50MB），S3服务已经有分块上传的接口。

4. **Q**: 是否需要支持批量 ETL？
   - **A**: Phase 1 不支持，用户可发起多个单独任务；Phase 2 可添加批量接口

5. **Q**: ETL 结果是否需要版本控制？
   - **A**: Phase 1 不支持，覆盖写入；Phase 2 可在文件名中添加版本号（如 `report.pdf.v2.json`）

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          FastAPI Application                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │   S3 Module  │     │  ETL Module  │     │  LLM Module  │   │
│  │              │     │              │     │              │   │
│  │ - Upload     │────▶│ - Parsers    │────▶│ - Text       │   │
│  │ - Download   │     │ - Rules      │     │ - OCR        │   │
│  │ - List       │◀────│ - Queue      │     │ - VLM        │   │
│  │ - Delete     │     │ - Service    │     │ - Audio      │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│         │                     │                     │           │
└─────────┼─────────────────────┼─────────────────────┼───────────┘
          │                     │                     │
          ▼                     ▼                     ▼
    ┌─────────┐           ┌─────────┐         ┌──────────┐
    │   S3    │           │  Queue  │         │ litellm  │
    │ Storage │           │ (Memory)│         │   SDK    │
    └─────────┘           └─────────┘         └──────────┘
                                                    │
                                                    ▼
                                              ┌──────────┐
                                              │   LLM    │
                                              │ Providers│
                                              └──────────┘
```

## ETL Flow Diagram

```
┌──────────┐
│ Frontend │
└────┬─────┘
     │ 1. Upload file
     ▼
┌─────────────┐
│  S3 API     │
│ POST /upload│
└────┬────────┘
     │ 2. Store to S3:/users/{user_id}/raw/{project_id}/file.pdf
     ▼
┌─────────────┐
│    S3       │
└────┬────────┘
     │
     │ 3. Submit ETL task
     ▼
┌─────────────┐
│  ETL API    │
│ POST /submit│
└────┬────────┘
     │ 4. Add to queue
     ▼
┌─────────────┐
│ Task Queue  │
└────┬────────┘
     │ 5. Worker picks task
     ▼
┌─────────────────────────────────────────────────────────┐
│                    ETL Service                          │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ 1. Download from S3                             │    │
│  └────────────────────────────────────────────────┘    │
│                          │                              │
│  ┌────────────────────────────────────────────────┐    │
│  │ 2. Select Parser (OCR/VLM/Audio/Document)      │    │
│  └────────────────────────────────────────────────┘    │
│                          │                              │
│  ┌────────────────────────────────────────────────┐    │
│  │ 3. Parse file → Intermediate result             │────┼──▶ Call LLM
│  └────────────────────────────────────────────────┘    │
│                          │                              │
│  ┌────────────────────────────────────────────────┐    │
│  │ 4. Apply ETL rule → Structured JSON             │────┼──▶ Call LLM
│  └────────────────────────────────────────────────┘    │
│                          │                              │
│  ┌────────────────────────────────────────────────┐    │
│  │ 5. Upload to S3:/users/{user_id}/processed/... │    │
│  └────────────────────────────────────────────────┘    │
│                          │                              │
│  ┌────────────────────────────────────────────────┐    │
│  │ 6. Update task status → completed               │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
                   ┌────────────┐
                   │  Frontend  │
                   │ GET /tasks │
                   └────────────┘
```





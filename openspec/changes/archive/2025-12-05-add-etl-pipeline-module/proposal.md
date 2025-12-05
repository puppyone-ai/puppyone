# Change: 新增 ETL 管道模块与 LLM 服务集成（简化版 MVP）

## Why

ContextBase 作为 LLM 驱动的 RAG 知识库管理平台，需要将企业用户上传的文档数据转换和清洗为结构化的 JSON 格式，以便为大语言模型提供友好的数据访问接口。

当前系统已有 S3 存储模块支持文件上传和管理，但缺少数据解析、转换和清洗的能力。本提案旨在快速交付 MVP 版本，实现从原始文档到结构化数据的基本 ETL 流程。

**MVP 策略**：第一版聚焦核心功能，使用成熟的第三方服务（MineRU）进行文档解析，简化规则引擎设计，快速验证技术方案的可行性。

## What Changes

### 新增模块

1. **LLM 服务模块 (`src/llm/`)**
   - 基于 litellm Python SDK 集成多种文本模型提供商
   - 提供统一的文本模型调用接口（用于数据清洗和结构化）
   - 支持模型配置管理和错误处理
   - 支持异步调用以适配 FastAPI

2. **ETL 核心模块 (`src/etl/`)**
   - **MineRU 客户端** (`mineru/`)
     - 封装 MineRU API 调用（创建任务、查询状态、下载结果）
     - 支持异步轮询和结果缓存（.mineru_cache 目录）
     - API Key 从环境变量 `MINERU_API_KEY` 读取
   - **规则引擎** (`rules/`)
     - 基于 JSON Schema 定义输出结构
     - 支持用户自定义 system_prompt
     - 调用 LLM 将 Markdown 清洗为结构化 JSON
   - **异步任务队列** (`tasks/`)
     - 异步处理 ETL 任务
     - 任务状态跟踪和查询
   - **ETL API 路由**
     - 独立于文件上传的 ETL 执行接口
     - 任务状态查询接口
     - 规则管理接口（创建、查询、删除自定义规则）

### 工作流程（MVP 版本）

```
用户上传文件 (via S3 API)
    ↓
存储到 S3: /users/{user_id}/raw/{project_id}/{filename}
    ↓
用户发起 ETL 请求 (via ETL API，提供 JSON Schema 和可选 system_prompt)
    ↓
ETL 服务从 S3 获取文件的预签名 URL
    ↓
调用 MineRU API 创建解析任务（传入 S3 预签名 URL）
    ↓
异步轮询 MineRU 任务状态，完成后下载 ZIP 压缩包
    ↓
提取 ZIP 中的 auto/auto.md（Markdown 文件）
    ↓
缓存到本地 .mineru_cache/{task_id}/ 目录
    ↓
将 Markdown + JSON Schema + system_prompt 传给 LLM 清洗
    ↓
LLM 返回结构化 JSON，验证符合 Schema
    ↓
上传 JSON 到 S3: /users/{user_id}/processed/{project_id}/{filename}.json
    ↓
返回处理结果和 JSON 文件路径
```

### S3 存储路径规范

- **原始文件**: `/users/{user_id}/raw/{project_id}/{filename}`
- **处理后文件**: `/users/{user_id}/processed/{project_id}/{filename}.json`

其中：
- `user_id`: 用户标识
- `project_id`: 项目标识
- `type`: `raw`（原始）或 `processed`（已处理）

### 技术栈（MVP 版本）

- **Model Integration**: litellm Python SDK
- **文档解析服务**: MineRU API (https://mineru.net)
- **支持的模型**:
  - 文本模型: deepseek-ai/DeepSeek-V3.2-Exp, MiniMaxAI/MiniMax-M2, moonshotai/Kimi-K2-Thinking, google/gemini-3-pro-preview, anthropic/claude-sonnet-4.5, openai/gpt-5-mini
- **异步框架**: asyncio + FastAPI
- **任务队列**: Python asyncio Queue (初期实现)
- **本地缓存**: .mineru_cache 目录（存储 MineRU 解析结果）

### MVP 限制与后续扩展

**MVP 版本限制**:
- 仅支持文档类型（PDF、DOC、DOCX、PPT、PPTX、PNG、JPG、JPEG）
- 仅使用 MineRU 进行文档解析（不支持本地解析器）
- 规则引擎仅支持 JSON Schema + system_prompt（无内置规则）
- 单个文件大小限制 200MB，页数限制 600 页（MineRU 限制）

**后续可扩展**:
- 支持其他解析器（OCR、VLM、音频等）
- 添加内置常用规则模板
- 支持音频、视频等多模态数据
- 优化缓存策略和存储方式

## Impact

### 新增规范

- **etl-core**: ETL 管道核心功能规范（MineRU 客户端、规则引擎、任务管理）
- **llm-service**: LLM 服务集成规范（文本模型调用、配置管理）

### 影响的代码

- `src/llm/`: 新增 LLM 服务模块
  - `config.py`: LLM 模型配置
  - `service.py`: LLM 服务核心逻辑（仅文本模型）
  - `schemas.py`: LLM 请求/响应模型
  - `exceptions.py`: LLM 异常定义
  - `dependencies.py`: LLM 依赖注入
  
- `src/etl/`: 新增 ETL 核心模块
  - `mineru/`: MineRU 客户端
    - `client.py`: MineRU API 客户端
    - `schemas.py`: MineRU 请求/响应模型
    - `exceptions.py`: MineRU 异常定义
    - `config.py`: MineRU 配置（API Key、端点）
  - `rules/`: 规则引擎
    - `schemas.py`: 规则定义模型（JSON Schema + system_prompt）
    - `engine.py`: 规则引擎执行器（调用 LLM 清洗）
    - `repository.py`: 规则存储（文件系统或数据库）
  - `tasks/`: 任务管理
    - `queue.py`: 异步任务队列
    - `models.py`: 任务数据模型
  - `service.py`: ETL 服务核心逻辑
  - `router.py`: ETL API 路由
  - `schemas.py`: ETL 请求/响应模型
  - `config.py`: ETL 配置
  - `exceptions.py`: ETL 异常定义
  - `dependencies.py`: ETL 依赖注入

- `src/main.py`: 注册 ETL 和 LLM 路由
- `pyproject.toml`: 添加 litellm 依赖
- `.mineru_cache/`: 新增本地缓存目录（MineRU 解析结果）
- `.gitignore`: 添加 .mineru_cache 到忽略列表

### 依赖关系

- ETL 模块依赖 S3 模块（读取原始文件、存储处理结果）
- ETL 模块依赖 LLM 模块（数据清洗和转换）
- 无破坏性变更（**BREAKING**）

### 性能考量

- 使用异步编程范式和任务队列，避免阻塞 API 响应
- 大文件处理采用流式读取，控制内存占用
- 初期使用 Python asyncio Queue，后续可扩展为 Redis Queue 或 Celery





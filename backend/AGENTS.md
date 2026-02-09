<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# ContextBase Backend — AI Assistant Guide

## 项目概述

ContextBase 后端是一个基于 **FastAPI** 的 Python 服务，为 LLM Agent 提供结构化上下文管理、MCP 协议集成和智能数据处理管道。

- **语言**: Python 3.12+
- **框架**: FastAPI + Uvicorn (ASGI)
- **包管理**: uv (`pyproject.toml`)
- **数据库**: Supabase (PostgreSQL)
- **存储**: AWS S3 / LocalStack
- **向量搜索**: Turbopuffer
- **LLM 网关**: LiteLLM

## 项目结构

```
backend/
├── src/                       # 主源码
│   ├── main.py                # 应用入口 & 生命周期
│   ├── config.py              # 全局配置 (Pydantic Settings)
│   ├── auth/                  # JWT 认证
│   ├── project/               # 项目管理
│   ├── content_node/          # 内容节点树
│   ├── table/                 # 结构化数据表 (JSON Pointer)
│   ├── tool/                  # 工具注册 & 搜索索引
│   ├── agent/                 # Agent 聊天 (SSE) & 配置
│   ├── mcp_v3/                # MCP 协议 v3 (工具绑定/代理)
│   ├── mcp/                   # MCP 实例管理
│   ├── ingest/                # 数据摄取 ETL
│   │   ├── file/              # 文件摄取 (MineRU + LLM)
│   │   └── saas/              # SaaS 同步 (Notion/GitHub 等)
│   ├── search/                # 向量搜索 (Turbopuffer + RRF)
│   ├── chunking/              # 文本分块
│   ├── llm/                   # LLM 服务
│   ├── oauth/                 # OAuth 集成 (9+ 平台)
│   ├── s3/                    # S3 存储服务
│   ├── sandbox/               # 代码沙盒 (E2B/Docker)
│   ├── scheduler/             # 定时任务 (APScheduler)
│   ├── context_publish/       # 公开 JSON 发布
│   ├── analytics/             # 分析
│   ├── profile/               # 用户画像
│   ├── internal/              # 内部 API
│   ├── supabase/              # Supabase 客户端 & Repository
│   └── utils/                 # 工具库 (日志/中间件)
├── mcp_service/               # MCP Server 独立服务
├── sql/                       # 数据库 DDL
├── tests/                     # 测试
├── scripts/                   # 脚本
└── docs/                      # 功能文档
```

## 开发规范

### 代码模式

- **分层架构**: `Router → Service → Repository (Supabase)` 三层分离
- **依赖注入**: 使用 FastAPI Depends 注入 Service 和 Repository
- **全异步**: 所有 I/O 操作使用 `async/await`
- **Pydantic 模型**: 所有 Request/Response 使用 Pydantic schema 定义
- **UUID 主键**: 所有实体使用 UUID 作为主键
- **JSONB 字段**: 灵活数据使用 PostgreSQL JSONB 存储

### 命名约定

- **文件**: `snake_case.py`
- **类**: `PascalCase` (如 `TableService`, `ToolRepository`)
- **函数/变量**: `snake_case`
- **路由前缀**: 所有业务 API 统一 `/api/v1`，内部 API 使用 `/internal`
- **模块结构**: 每个模块通常包含 `router.py`, `service.py`, `repository.py`, `schemas.py`

### 认证

- JWT 认证基于 Supabase Auth
- 使用 `get_current_user` 依赖获取当前用户
- `get_current_user_optional` 用于可选认证的端点
- 测试环境可通过 `SKIP_AUTH=true` 跳过认证

### 错误处理

- 使用 `AppException` 自定义异常类
- 全局异常处理器统一 JSON 响应格式
- 包含 `RequestValidationError`, `HTTPException`, 通用 `Exception` 处理

### 日志

- 使用 **Loguru** (非标准库 logging)
- 使用 `log_info()`, `log_error()` 等 (来自 `src.utils.logger`)
- 日志格式: 本地终端彩色文本，生产环境 JSON

## 常用命令

```bash
# 安装依赖
uv sync

# 启动开发服务器
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log

# 运行测试
uv run pytest
uv run pytest -m "not e2e"      # 排除 e2e 测试

# 启动 Worker (文件处理 / SaaS 同步)
uv run arq src.ingest.file.jobs.worker.WorkerSettings
uv run arq src.ingest.saas.jobs.worker.WorkerSettings
```

## 关键依赖

| 包 | 用途 |
|------|------|
| `fastapi` | Web 框架 |
| `supabase` | 数据库客户端 |
| `boto3` | S3 存储客户端 |
| `litellm` | 统一 LLM 调用网关 |
| `turbopuffer` | 向量数据库客户端 |
| `arq` | 异步任务队列 (Redis) |
| `anthropic` | Anthropic SDK |
| `e2b-code-interpreter` | E2B 沙盒 |
| `fastmcp` | MCP 协议库 |
| `firecrawl-py` | 网页抓取 |
| `loguru` | 结构化日志 |
| `apscheduler` | 定时任务调度 |

## API 路由总览

| 路由前缀 | 模块 | 说明 |
|----------|------|------|
| `/api/v1/projects` | project | 项目 CRUD |
| `/api/v1/nodes` | content_node | 内容节点 (文件夹/JSON/MD/文件) |
| `/api/v1/tables` | table | 数据表 & JSON Pointer 操作 |
| `/api/v1/tools` | tool | 工具注册 & 搜索索引 |
| `/api/v1/agents` | agent | Agent SSE 流式对话 |
| `/api/v1/mcp` | mcp_v3 | MCP 工具绑定 & 代理 |
| `/api/v1/ingest` | ingest | 文件/SaaS/URL 数据摄取 |
| `/api/v1/s3` | s3 | 文件上传/下载/预签名URL |
| `/api/v1/publishes` | context_publish | 公开 JSON 短链接 |
| `/api/v1/oauth` | oauth | OAuth 授权 (9+ 平台) |
| `/internal` | internal | 内部服务 API |
| `/health` | main | 健康检查 |

## 部署架构

Railway 多服务部署 (共享代码库，通过 `SERVICE_ROLE` 区分):

- **api** (默认): 主 API 服务
- **file_worker**: 文件 ETL Worker (ARQ)
- **saas_worker**: SaaS 同步 Worker (ARQ)
- **mcp_server**: MCP 协议服务 (FastMCP)

## 文档资源

- `docs/` — 各模块功能文档
- `docs/turbopuffer/` — Turbopuffer API 参考
- `docs/anthropic/` — Anthropic API 参考
- `docs/e2b/` — E2B 沙盒参考
- `docs/etl/` — ETL 管道文档
- `openspec/` — OpenSpec 变更规范
- `sql/` — 数据库 DDL 与迁移脚本

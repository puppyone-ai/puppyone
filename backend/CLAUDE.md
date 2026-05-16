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
│   │
│   ├── mut_engine/            # 版本引擎 (Git 原生核心写入通道)
│   │   ├── application/       # 领域逻辑 (transaction_engine, conflict_policy, …)
│   │   ├── adapters/          # 协议适配器
│   │   │   ├── git/           # Git smart-HTTP 路由 (/git/{project_id}.git, /git/ap/...)
│   │   │   └── operations/    # MutOps (产品操作 → OperationWriteIntent)
│   │   ├── server/            # repo_manager, server_repo (S3/PG 适配), admin
│   │   ├── services/          # ephemeral_client, fs_path_index, hooks, version_outbox
│   │   ├── routers/           # content_*, audit, conflict, shadow_snapshot, ws
│   │   └── domain/            # intents, schemas
│   │
│   ├── content/               # 内容节点树 (read index)
│   │   └── table/             # 结构化数据表 (JSON Pointer)
│   ├── tool/                  # 工具注册 & 搜索索引
│   │
│   ├── connectors/            # 连接器
│   │   ├── manager/           # 统一 Access CRUD (access_points 表)
│   │   ├── agent/             # AI Agent (config/chat/MCP 绑定)
│   │   ├── datasource/        # SaaS 数据源 (Gmail/GitHub/Notion/...)
│   │   │   └── oauth/         # OAuth 授权流程 & token 存储
│   │   ├── database/          # 外部数据库连接器
│   │   ├── filesystem/        # 本地文件夹同步 (OpenClaw)
│   │   ├── mcp_endpoint/      # MCP 端点 CRUD & API key
│   │   └── sandbox_endpoint/  # Sandbox 端点 CRUD & exec
│   │
│   ├── platform/              # 平台服务
│   │   ├── auth/              # JWT 认证
│   │   ├── organization/      # 组织 & 成员
│   │   ├── project/           # 项目 CRUD & Dashboard
│   │   ├── profile/           # 用户画像
│   │   ├── workspace/         # 工作区
│   │   └── analytics/         # 使用统计
│   │
│   ├── infra/                 # 基础设施
│   │   ├── supabase/          # Supabase 客户端
│   │   ├── s3/                # S3 存储
│   │   ├── llm/               # LLM 服务
│   │   ├── search/            # 向量搜索 (Turbopuffer)
│   │   ├── chunking/          # 文本分块
│   │   ├── scheduler/         # 定时任务 (APScheduler)
│   │   ├── sandbox/           # Sandbox 运行时 (Docker/E2B)
│   │   ├── security/          # AES-256-GCM 加密
│   │   └── turbopuffer/       # 向量 DB 客户端
│   │
│   ├── ingest/                # 数据摄取 ETL
│   ├── oauth/                 # OAuth (9+ 平台)
│   ├── sandbox/               # 沙盒运行时 (Docker/E2B)
│   ├── context_publish/       # 公开 JSON 短链接
│   ├── internal/              # 内部 API
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

# 启动 File Worker (文件 ETL / OCR)
uv run arq src.upload.file.jobs.worker.WorkerSettings
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
| `/api/v1/projects` | platform/project | 项目 CRUD & Dashboard |
| `/api/v1/organizations` | platform/organization | 组织 & 成员 |
| `/api/v1/nodes` | content | 内容节点 (文件夹/JSON/MD/文件) |
| `/api/v1/tables` | content/table | 数据表 & JSON Pointer 操作 |
| `/api/v1/tools` | tool | 工具注册 & 搜索索引 |
| `/api/v1/agents` | connectors/agent | Agent SSE 流式对话 |
| `/api/v1/agent-config` | connectors/agent/config | Agent CRUD & 权限 |
| `/api/v1/mcp` | connectors/agent/mcp | MCP 工具绑定 & 代理 |
| `/api/v1/mcp-endpoints` | connectors/mcp_endpoint | MCP 端点 CRUD |
| `/api/v1/sandbox-endpoints` | connectors/sandbox_endpoint | Sandbox 端点 CRUD |
| `/api/v1/access` | connectors/manager | 统一 Access 管理 |
| `/api/v1/sync` | connectors/datasource | SaaS 数据源同步 |
| `/api/v1/collab` | mut_engine | 协作 (checkout/commit/versions/rollback/diff) |
| `/git/{project_id}.git`, `/git/ap/{access_key}.git` | mut_engine/adapters/git | Git smart-HTTP (info/refs, git-receive-pack, git-upload-pack) |
| `/api/v1/mut/{project_id}/ws` | mut_engine | 提交通知 WebSocket (历史名称，未改) |
| `/api/v1/ingest` | ingest | 文件/URL 数据摄取 ETL |
| `/api/v1/db-connector` | connectors/database | 数据库连接器 |
| `/api/v1/workspace` | platform/workspace | 工作区管理 |
| `/api/v1/publishes` | context_publish | 公开 JSON 短链接 |
| `/api/v1/oauth` | oauth | OAuth 授权 (9+ 平台) |
| `/api/v1/auth` | platform/auth | 认证相关 |
| `/internal` | internal | 内部服务 API |
| `/health` | main | 健康检查 |

## 部署架构

Railway 多服务部署 (共享代码库，通过 `SERVICE_ROLE` 区分):

- **api** (默认): 主 API 服务
- **file_worker**: 文件 ETL / OCR Worker (ARQ)
- **mcp_server**: MCP 协议服务 (FastMCP)

## 文档资源

- `docs/` — 各模块功能文档
- `docs/turbopuffer/` — Turbopuffer API 参考
- `docs/anthropic/` — Anthropic API 参考
- `docs/e2b/` — E2B 沙盒参考
- `docs/etl/` — ETL 管道文档
- `openspec/` — OpenSpec 变更规范
- `sql/` — 数据库 DDL 与迁移脚本

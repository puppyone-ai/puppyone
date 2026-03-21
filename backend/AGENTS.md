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

## 架构（Mut-Native）

**Mut tree (S3) 是唯一的内容 SOT。PG 是控制平面，不持有内容节点。**

- 没有 `content_nodes` 表
- 没有 `connection_accesses` 表
- 文件操作全部通过 MutWriteService / MutTreeReader
- 权限通过 Mut scope (connections.config.scope) 管理
- 前端使用 path-based 路由和 Tree API

## 项目结构

```
backend/
├── src/
│   ├── main.py                # 应用入口 & 生命周期
│   ├── config.py              # 全局配置 (Pydantic Settings)
│   │
│   ├── mut_engine/            # MUT 版本引擎 (核心读写通道)
│   │   ├── write_service.py   # 唯一写入入口 (MutWriteService)
│   │   ├── tree_reader.py     # 唯一读取入口 (MutTreeReader)
│   │   ├── tree_router.py     # Tree API (/api/v1/tree/*)
│   │   ├── repo_manager.py    # per-project Mut 仓库管理
│   │   ├── server_repo.py     # PuppyOneServerRepo (S3/PG 适配)
│   │   ├── schemas.py         # 所有数据模型
│   │   ├── dependencies.py    # FastAPI DI 工厂
│   │   ├── audit_router.py    # 审计日志 API
│   │   ├── protocol_router.py # MUT 线路协议 (clone/push/pull/negotiate)
│   │   └── backends/          # S3 + Supabase 后端适配
│   │
│   ├── content/
│   │   └── table/             # 结构化数据表 (JSON Pointer)
│   ├── tool/                  # 工具注册 & 搜索索引
│   │
│   ├── connectors/            # 连接器
│   │   ├── manager/           # 统一连接 CRUD (connections 表)
│   │   ├── agent/             # AI Agent (config/chat/MCP 绑定)
│   │   ├── datasource/        # SaaS 数据源 (Gmail/GitHub/Notion/...)
│   │   ├── filesystem/        # 双向本地文件夹同步 (OpenClaw)
│   │   └── database/          # 外部数据库连接
│   │
│   ├── endpoints/             # 端点管理
│   │   ├── mcp/               # MCP 端点
│   │   └── sandbox/           # Sandbox 端点
│   │
│   ├── platform/              # 平台服务
│   │   ├── auth/              # JWT 认证
│   │   ├── organization/      # 组织管理
│   │   ├── project/           # 项目管理
│   │   ├── profile/           # 用户资料
│   │   ├── workspace/         # 工作空间
│   │   └── analytics/         # 使用统计
│   │
│   ├── infra/                 # 基础设施
│   │   ├── supabase/          # Supabase 客户端
│   │   ├── s3/                # S3 存储
│   │   ├── llm/               # LLM 服务
│   │   ├── search/            # 向量搜索
│   │   └── scheduler/         # 定时任务
│   │
│   └── utils/                 # 工具模块
├── tests/                     # 测试
└── sql/                       # 数据库 DDL & 迁移
```

## 核心模块

### MutWriteService（唯一写入入口）

```python
class MutWriteService:
    def __init__(self, repo_manager: MutRepoManager): ...

    async def write_file(project_id, path, content, operator, message, base_version) -> WriteResult
    async def delete_file(project_id, path, operator, message) -> DeleteResult
    async def move_file(project_id, old_path, new_path, operator, message) -> MoveResult
    async def move_folder(project_id, old_path, new_path, operator, message) -> MoveResult
    async def mkdir(project_id, path, operator) -> WriteResult
    async def trash(project_id, path, operator) -> MoveResult
    async def restore(project_id, trash_path, original_path, operator) -> MoveResult
    async def delete_folder(project_id, path, operator, message) -> DeleteResult
    async def read_file(project_id, path) -> bytes
    async def get_version_history(project_id, path, limit, since_version) -> list[dict]
    async def get_version_content(project_id, path, version) -> bytes
    async def compute_diff(project_id, v1, v2) -> list[dict]
    async def rollback(project_id, target_version, operator) -> int
```

### MutTreeReader（唯一读取入口）

```python
class MutTreeReader:
    def __init__(self, repo_manager: MutRepoManager): ...

    def list_dir(project_id, path) -> list[MutEntry]
    def read_file(project_id, path) -> bytes
    def stat(project_id, path) -> MutEntry | None
    def list_tree(project_id, path, max_depth) -> list[MutEntry]
    def exists(project_id, path) -> bool
    def get_root_hash(project_id) -> str
    def get_version(project_id) -> int
```

### DI 注入

```python
from src.mut_engine.dependencies import (
    get_mut_write_service,    # FastAPI DI
    get_tree_reader,          # FastAPI DI
    get_repo_manager,         # FastAPI DI
    create_mut_write_service, # Standalone (scheduler/ARQ)
    create_tree_reader,       # Standalone
    get_repo_manager_standalone,
    read_blob_content,        # 通过 content_hash 读取
)
```

## API 路由

| 路由前缀 | 模块 | 说明 |
|----------|------|------|
| `/api/v1/tree/{project_id}` | mut_engine/tree_router | Tree API (ls/cat/stat/tree/write/mkdir/mv/rm) |
| `/api/v1/mut/{project_id}` | mut_engine/protocol_router | MUT 线路协议 |
| `/api/v1/tables` | content/table | 数据表 JSON Pointer 操作 |
| `/api/v1/projects` | platform/project | 项目管理 |
| `/api/v1/organizations` | platform/organization | 组织管理 |
| `/api/v1/tools` | tool | 工具注册 |
| `/api/v1/agents` | connectors/agent | Agent SSE 聊天 |
| `/api/v1/agent-config` | connectors/agent/config | Agent CRUD |
| `/api/v1/mcp` | connectors/agent/mcp | MCP v3 工具绑定 |
| `/api/v1/sync` | connectors/datasource | 数据源同步 |
| `/api/v1/connections` | connectors/manager | 统一连接管理 |
| `/api/v1/ingest` | ingest | 文件/URL 导入 |
| `/api/v1/oauth` | oauth | OAuth 授权 |
| `/internal` | internal | 内部 API |

## 常用命令

```bash
uv sync                 # 安装依赖
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log
uv run pytest           # 运行测试
```

## 开发约定

- **分层架构**: Router → Service → MutWriteService/MutTreeReader
- **依赖注入**: FastAPI Depends
- **全异步**: 所有 I/O 使用 async/await
- **路径标识**: 文件以 path（如 "docs/readme.md"）标识，不使用 UUID
- **命名**: 文件 snake_case.py，类 PascalCase，函数/变量 snake_case
- **路由前缀**: 业务 API 在 /api/v1，内部 API 在 /internal

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
- 没有独立的权限绑定表（scope 存储在 `access_points.config.scope`）
- 文件操作全部通过 MutWriteService / MutTreeReader
- 权限通过 Mut scope (access_points.config.scope) 管理
- 前端使用 path-based 路由和 Tree API

## 项目结构

```
backend/
├── src/
│   ├── main.py                # 应用入口 & 生命周期
│   ├── config.py              # 全局配置 (Pydantic Settings)
│   │
│   ├── mut_engine/            # MUT 版本引擎 (核心读写通道)
│   │   ├── routers/           # HTTP 路由层
│   │   │   ├── content_router.py  # Content API (/api/v1/content/*)
│   │   │   ├── protocol_router.py # MUT 线协议 (/api/v1/mut/*)
│   │   │   ├── access_point.py    # Access Point (/api/v1/mut/ap/*)
│   │   │   └── audit_router.py    # 审计日志
│   │   ├── services/          # 业务服务层
│   │   │   ├── ops.py         # MutOps — 统一操作入口
│   │   │   ├── ephemeral_client.py # 进程内 clone→push
│   │   │   ├── tree_reader.py # MutTreeReader — 轻量读取
│   │   │   └── hooks.py       # Post-commit hooks
│   │   ├── server/            # 服务端基础设施层
│   │   │   ├── server_repo.py # PuppyOneServerRepo (S3/PG 适配)
│   │   │   ├── repo_manager.py# per-project Mut 仓库管理
│   │   │   ├── admin.py       # MutAdminService (init/历史/diff)
│   │   │   ├── auth.py        # 认证适配器
│   │   │   └── backends/      # 存储后端 (S3/Supabase)
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
│   │   ├── manager/           # 统一 Access CRUD (access_points 表)
│   │   ├── agent/             # AI Agent (config/chat/MCP 绑定)
│   │   ├── datasource/        # SaaS 数据源 (Gmail/GitHub/Notion/...)
│   │   │   └── oauth/         # OAuth 授权流程 & token 存储
│   │   ├── filesystem/        # 双向本地文件夹同步 (OpenClaw)
│   │   ├── database/          # 外部数据库连接
│   │   ├── mcp_endpoint/      # MCP 端点 CRUD & API key
│   │   └── sandbox_endpoint/  # Sandbox 端点 CRUD & exec
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

    async def write_file(project_id, path, content, operator, message, base_commit_id) -> WriteResult
    async def delete_file(project_id, path, operator, message) -> DeleteResult
    async def move_file(project_id, old_path, new_path, operator, message) -> MoveResult
    async def move_folder(project_id, old_path, new_path, operator, message) -> MoveResult
    async def mkdir(project_id, path, operator) -> WriteResult
    async def trash(project_id, path, operator) -> MoveResult
    async def restore(project_id, trash_path, original_path, operator) -> MoveResult
    async def delete_folder(project_id, path, operator, message) -> DeleteResult
    async def read_file(project_id, path) -> bytes
    async def get_commit_history(project_id, path, limit, since_commit_id) -> list[dict]
    async def get_commit_content(project_id, path, commit_id) -> bytes
    async def compute_diff(project_id, from_commit_id, to_commit_id) -> list[dict]
    async def rollback(project_id, target_commit_id, operator) -> str  # new commit_id
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
| `/api/v1/content/{project_id}` | mut_engine/routers/content_router | Content API (ls/cat/stat/tree/write/mkdir/mv/rm) |
| `/api/v1/mut/{project_id}` | mut_engine/protocol_router | MUT 线路协议 |
| `/api/v1/tables` | content/table | 数据表 JSON Pointer 操作 |
| `/api/v1/projects` | platform/project | 项目管理 |
| `/api/v1/organizations` | platform/organization | 组织管理 |
| `/api/v1/tools` | tool | 工具注册 |
| `/api/v1/agents` | connectors/agent | Agent SSE 聊天 |
| `/api/v1/agent-config` | connectors/agent/config | Agent CRUD |
| `/api/v1/mcp` | connectors/agent/mcp | MCP v3 工具绑定 |
| `/api/v1/sync` | connectors/datasource | 数据源同步 |
| `/api/v1/access` | connectors/manager | 统一 Access 管理 |
| `/api/v1/ingest` | ingest | 文件/URL 导入 |
| `/api/v1/oauth` | oauth | OAuth 授权 |
| `/internal` | internal | 内部 API |

## 常用命令

```bash
uv sync                 # 安装依赖
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log
uv run pytest           # 运行测试
```

## 部署 (Railway / Nixpacks)

后端用 **Railway + Nixpacks** 构建，配置文件全部在 `backend/`：

- `backend/railway.toml` — `[build]` / `[deploy]`，定义 builder 与 startCommand
- `backend/nixpacks.toml` — `[phases.setup]` / `[phases.install]`，覆盖 Nixpacks 默认 Python 流水线，自己建 venv → pin uv → `uv export` → `pip install -r requirements.lock.txt`

### Railway 控制台必须设置的项

每个共享本仓库的 service（`api` / `file_worker` / `mcp_server`）都必须把
`Settings -> Service -> Source -> Root Directory` 设成 `backend`（写 `/backend` 也等价）。

否则：

- Railway 把整个 monorepo 根当成构建上下文，根本看不到 `backend/railway.toml` 和 `backend/nixpacks.toml`
- Nixpacks 会用默认 Python 流水线

### 即使 Root Directory 设对了，`[phases.*]` 也不能写在 railway.toml 里

`railway.toml` 的 schema 只认 `[build]` / `[deploy]` / `[environments.*]`。`[phases.setup]`
和 `[phases.build]` 这种 Nixpacks 自定义阶段写在 railway.toml 里会被**静默忽略**。

所有 Nixpacks 自定义阶段必须放到独立的 `backend/nixpacks.toml`。

### 必须覆盖的是 `[phases.install]`，不只是 `[phases.build]`

Nixpacks 默认 Python+uv provider 把建 venv + 装依赖塞在 **install** 阶段，
渲染出来大概是：

```
python -m venv --copies /opt/venv \
  && . /opt/venv/bin/activate \
  && pip install uv==$NIXPACKS_UV_VERSION \
  && uv sync --no-dev --frozen
```

当 provider 没注入 `NIXPACKS_UV_VERSION` 时（最近 uv 升级后会偶发），渲染结果变成
`pip install uv==`，整个 build 直接挂：

```
ERROR: Invalid requirement: 'uv==': Expected end or semicolon
```

`[phases.build]` 在 install 之后才跑，光覆盖 build 没用 —— **必须覆盖 `[phases.install]`**，
我们的 `nixpacks.toml` 就是这么写的（自己建 venv，pip 装一个 pinned 的 uv，再 uv export →
pip install requirements）。

### uv 版本要硬编码，不要用 `${UV_VERSION}` 这种变量展开

中间踩过一次：在 `[variables]` 里定义 `UV_VERSION = "0.5.11"`，cmd 里写
`pip install --upgrade pip 'uv==${UV_VERSION}'`。看起来很优雅，实际整套 build 直接挂：

- TOML 字符串里的单引号会**原样**进入 Dockerfile 的 `RUN` 行
- bash 在单引号里**不会**展开 `${UV_VERSION}`
- pip 拿到字面字符串 `uv==${UV_VERSION}`，再次报 `Invalid requirement: 'uv==${UV_VERSION}'`

跟原来的 `pip install uv==` 是同类失败。结论：直接在 cmd 里硬编码 `uv==0.5.11`，
不要叠加 TOML + bash 两层 escape 规则。要升级 uv 就改 `nixpacks.toml` 里那一行字面量。

### 不要在仓库根目录放 Python 项目文件

`pyproject.toml` / `uv.lock` / `.python-version` **只能放在 `backend/`**。

哪怕只是放一个空的 `uv.lock` 或者只写 `[tool.black]` 的 `pyproject.toml` 在根目录，
Nixpacks 也会触发 Python 检测并尝试默认安装流程，把上面的 build 弄挂。

### 多 service 用同一份代码

`startCommand` 通过 `SERVICE_ROLE` 环境变量切换：

| `SERVICE_ROLE` | 进程 |
|----------------|------|
| 未设置 / `api` | `uvicorn src.main:app` (FastAPI) |
| `file_worker` | `arq src.ingest.file.jobs.worker.WorkerSettings` |
| `mcp_server` | `uvicorn mcp_service.server:app` |

每个 Railway service 在 Variables 里设 `SERVICE_ROLE` 即可，不需要复制代码。

## 开发约定

- **分层架构**: Router → Service → MutWriteService/MutTreeReader
- **依赖注入**: FastAPI Depends
- **全异步**: 所有 I/O 使用 async/await
- **路径标识**: 文件以 path（如 "docs/readme.md"）标识，不使用 UUID
- **命名**: 文件 snake_case.py，类 PascalCase，函数/变量 snake_case
- **路由前缀**: 业务 API 在 /api/v1，内部 API 在 /internal

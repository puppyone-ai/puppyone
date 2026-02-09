# PuppyOne (ContextBase)

## 项目简介

PuppyOne 是一个为 LLM Agent 提供结构化上下文管理的全栈平台，包含数据摄取 ETL、向量搜索、MCP 协议集成、多平台 OAuth 和代码沙盒执行等能力。

## 活跃开发目录

当前仓库的开发工作集中在以下三个目录：

- **`backend/`** — Python (FastAPI) 后端服务
- **`frontend/`** — Next.js 前端应用
- **`sandbox/`** — Docker 沙盒环境（JSON 编辑 / 代码执行）

## 废弃目录（请勿修改）

以下目录已废弃，不再维护，请忽略：

- `PuppyEngine`
- `PuppyFlow`
- `PuppyStorage`
- `tools`

---

## Backend（后端）

- **语言**: Python 3.12+
- **框架**: FastAPI + Uvicorn (ASGI)
- **包管理**: uv (`pyproject.toml`)
- **数据库**: Supabase (PostgreSQL)
- **存储**: AWS S3 / LocalStack
- **向量搜索**: Turbopuffer
- **LLM 网关**: LiteLLM
- **任务队列**: ARQ (Redis)
- **日志**: Loguru

### 后端目录结构

```
backend/
├── src/                       # 主源码
│   ├── main.py                # 应用入口 & 生命周期
│   ├── config.py              # 全局配置 (Pydantic Settings)
│   ├── auth/                  # JWT 认证 (Supabase Auth)
│   ├── project/               # 项目管理 CRUD
│   ├── content_node/          # 内容节点树 (文件夹/JSON/MD/文件)
│   ├── table/                 # 结构化数据表 (JSON Pointer)
│   ├── tool/                  # 工具注册 & 搜索索引
│   ├── agent/                 # Agent 聊天 (SSE 流式) & 配置
│   ├── mcp_v3/                # MCP 协议 v3 (工具绑定/代理)
│   ├── mcp/                   # MCP 实例管理
│   ├── ingest/                # 数据摄取 ETL
│   │   ├── file/              # 文件摄取 (MineRU + LLM)
│   │   └── saas/              # SaaS 同步 (Notion/GitHub 等)
│   ├── search/                # 向量搜索 (Turbopuffer + RRF)
│   ├── chunking/              # 文本分块
│   ├── llm/                   # LLM 服务 (生成 + Embedding)
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
├── mcp_service/               # MCP Server 独立服务 (FastMCP)
├── sql/                       # 数据库 DDL
├── tests/                     # 测试
├── scripts/                   # 脚本
└── docs/                      # 功能文档
```

### 后端开发规范

- **分层架构**: `Router → Service → Repository (Supabase)` 三层分离
- **依赖注入**: 使用 FastAPI `Depends` 注入 Service 和 Repository
- **全异步**: 所有 I/O 操作使用 `async/await`
- **Pydantic 模型**: 所有 Request/Response 使用 Pydantic schema 定义
- **命名约定**: 文件 `snake_case.py`，类 `PascalCase`，函数/变量 `snake_case`
- **路由前缀**: 业务 API 统一 `/api/v1`，内部 API 使用 `/internal`
- **模块结构**: 每个模块通常包含 `router.py`, `service.py`, `repository.py`, `schemas.py`

### 后端 API 路由总览

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

### 后端常用命令

```bash
# 安装依赖
uv sync

# 启动开发服务器
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log

# 运行测试
uv run pytest
uv run pytest -m "not e2e"      # 排除 e2e 测试

# 启动 Worker
uv run arq src.ingest.file.jobs.worker.WorkerSettings      # 文件处理 Worker
uv run arq src.ingest.saas.jobs.worker.WorkerSettings       # SaaS 同步 Worker
```

### 后端部署

Railway 多服务部署（共享代码库，通过 `SERVICE_ROLE` 区分）：

- **api**（默认）: 主 API 服务
- **file_worker**: 文件 ETL Worker (ARQ)
- **saas_worker**: SaaS 同步 Worker (ARQ)
- **mcp_server**: MCP 协议服务 (FastMCP)

---

## Frontend（前端）

- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **UI**: React 18 + Tailwind CSS
- **认证**: Supabase Auth
- **状态管理**: Zustand + React Context
- **数据请求**: SWR

### 前端目录结构

```
frontend/
├── app/                          # Next.js App Router 页面
│   ├── (main)/                   # 路由组 (共享 AppSidebar 布局)
│   │   ├── projects/             # 项目模块
│   │   │   └── [projectId]/      # 项目详情页
│   │   │       ├── data/         # 数据浏览器
│   │   │       ├── toolkit/      # Agent 工具包
│   │   │       ├── tools/        # 项目工具
│   │   │       ├── logs/         # 项目日志
│   │   │       └── settings/     # 项目设置
│   │   ├── settings/             # 全局设置
│   │   ├── tools-and-server/     # 工具 & MCP 服务器管理
│   │   ├── home/                 # 主页/仪表盘
│   │   ├── billing/              # 计费
│   │   └── team/                 # 团队管理
│   ├── api/                      # API 路由 (agent, sandbox)
│   ├── auth/                     # Auth 回调
│   ├── login/                    # 登录页
│   ├── onboarding/               # 新手引导
│   └── oauth/                    # OAuth 回调 (多平台)
├── components/                    # React 组件
│   ├── agent/                    # Agent 相关组件
│   ├── chat/                     # 聊天界面
│   ├── dashboard/                # 仪表盘组件
│   ├── editors/                  # 编辑器 (JSON/Markdown/Code)
│   │   ├── code/                 # Monaco / CodeMirror
│   │   ├── markdown/             # Milkdown Markdown 编辑器
│   │   ├── table/                # 表格式 JSON 编辑器
│   │   ├── tree/                 # 树形 JSON 编辑器
│   │   └── vanilla/              # Vanilla JSON 编辑器
│   ├── sidebar/                  # 侧边栏
│   └── RightAuxiliaryPanel/      # 右侧辅助面板
├── lib/                          # 工具库 & API 客户端
│   ├── hooks/                    # 自定义 React Hooks
│   ├── apiClient.ts              # 基础 API 客户端
│   ├── chatApi.ts                # 聊天 API
│   ├── contentNodesApi.ts        # 内容节点 API
│   ├── mcpApi.ts                 # MCP API
│   ├── projectsApi.ts            # 项目 API
│   └── oauthApi.ts               # OAuth API
├── contexts/                     # React Context
│   ├── AgentContext.tsx           # Agent 状态管理
│   └── WorkspaceContext.tsx       # 工作区状态管理
├── middleware.ts                  # Next.js 中间件 (认证 & 路由)
└── next.config.ts                # Next.js 配置
```

### 前端核心功能

1. **项目管理** — 多项目工作区，项目数据表与配置
2. **数据管理** — 多视图（列表/网格/Miller Columns/资源管理器），JSON/Markdown 编辑
3. **Agent & AI** — SSE 流式聊天，Agent 配置，MCP 工具集成
4. **工具 & MCP 服务器** — 工具库管理，MCP Server 部署与访问控制
5. **OAuth 集成** — 支持 Notion/GitHub/Gmail/Google Drive/Linear/Airtable 等 9+ 平台
6. **新手引导** — 多步骤向导，演示内容

### 前端常用命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 前端环境变量

```
NEXT_PUBLIC_SUPABASE_URL        # Supabase URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Supabase 匿名 Key
NEXT_PUBLIC_API_URL             # 后端 API 地址 (默认 http://localhost:9090)
NEXT_PUBLIC_DEV_MODE            # 开发模式标志
```

---

## Sandbox（沙盒）

轻量级 Docker 沙盒环境，用于在隔离容器中安全执行 CLI 命令（如 `jq` 编辑 JSON）。

### 沙盒结构

```
sandbox/
├── README.md          # 使用文档
├── Dockerfile         # Alpine + jq/bash/coreutils
└── test-data.json     # 示例测试数据
```

### 工作流程

1. 创建临时 Docker 容器（Alpine + jq/bash）
2. 挂载 JSON 文件到 `/workspace/data.json`
3. AI Agent 生成并执行 CLI 命令
4. 读取修改后的 JSON 数据
5. 销毁容器

前端 (`app/api/sandbox/route.ts`) 和后端 (`src/sandbox/`) 均有沙盒集成，后端还支持 E2B 云沙盒。

---

## 其他目录说明

| 目录 | 说明 |
|------|------|
| `docs/` | 项目级文档 |
| `assert/` | 静态资源 |
| `puppydoc/` | 文档相关 |
| `scripts/` | 工具脚本 |
| `todo/` | 待办事项 |
| `.github/` | GitHub Actions & CI |

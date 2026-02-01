# Import Module Architecture

## Overview

Unified import system for all data sources: SaaS platforms, URLs, and files.

---

## 🏗️ ARQ 架构最佳实践

### 核心原则：职责分离

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    共享层 (API + Worker 都使用)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │  handlers/   │ │    task/     │ │    utils/    │ │ 外部 services │  │
│  │  业务逻辑    │ │  状态管理    │ │   工具函数   │ │ oauth, s3...  │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          ▲                                          ▲
          │                                          │
   ┌──────┴──────┐                           ┌──────┴──────┐
   │  API 专用层  │                           │ Worker 专用层│
   │ router.py   │                           │  jobs/      │
   │ schemas.py  │                           │  worker.py  │
   │ service.py  │                           │  jobs.py    │
   └─────────────┘                           └─────────────┘
         │                                          │
         ▼                                          ▼
   ┌─────────────┐                           ┌─────────────┐
   │ FastAPI App │                           │ ARQ Worker  │
   │  (main.py)  │                           │ (独立进程)   │
   └─────────────┘                           └─────────────┘
```

### 代码应该放在哪里？

| 层级 | 目录/文件 | 职责 | 谁使用 |
|------|----------|------|--------|
| **共享-业务** | `handlers/*.py` | 核心业务逻辑（导入处理） | API + Worker |
| **共享-状态** | `task/manager.py` | 任务状态管理 | API + Worker |
| **共享-状态** | `task/repository.py` | Redis + DB 持久化 | API + Worker |
| **共享-模型** | `task/models.py` | 数据模型定义 | API + Worker |
| **共享-工具** | `utils/*.py` | 工具函数（URL解析、爬虫等） | API + Worker |
| **API专用** | `router.py` | HTTP 端点定义 | API only |
| **API专用** | `schemas.py` | Request/Response Pydantic | API only |
| **API专用** | `service.py` | API 业务编排（提交任务、查询状态） | API only |
| **API专用** | `dependencies.py` | FastAPI 依赖注入 | API only |
| **Worker专用** | `jobs/jobs.py` | ARQ job 函数 | Worker only |
| **Worker专用** | `jobs/worker.py` | Worker 配置和启动逻辑 | Worker only |
| **共享配置** | `config.py` | 模块配置 | API + Worker |
| **共享配置** | `arq_client.py` | ARQ 客户端（enqueue jobs） | API only |

---

### 详细职责说明

#### 1. `handlers/` - 核心业务逻辑 (共享)

```python
# handlers/github_handler.py
class GithubHandler(BaseHandler):
    """
    纯业务逻辑，不关心是谁调用它
    - 可以被 Worker 调用（import_job）
    - 也可以被 API 调用（preview 预览）
    """
    async def process(self, task, on_progress) -> ImportResult:
        # 下载、转换、存储 - 核心业务
        pass
    
    async def preview(self, url, user_id) -> PreviewResult:
        # 预览（不创建任务）- API 直接调用
        pass
```

**原则**: Handler 只做业务逻辑，不知道自己是被 API 还是 Worker 调用。

#### 2. `task/` - 状态管理 (共享)

```python
# task/manager.py
class ImportTaskManager:
    """
    任务生命周期管理
    - API 用它创建任务、查询状态
    - Worker 用它更新进度、标记完成/失败
    """
    async def create_task(self, ...) -> ImportTask  # API 用
    async def get_task(self, task_id) -> ImportTask  # API + Worker 都用
    async def mark_processing(self, task_id)         # Worker 用
    async def update_progress(self, task_id, ...)    # Worker 用
    async def mark_completed(self, task_id, ...)     # Worker 用
```

#### 3. `service.py` - API 业务编排 (API 专用)

```python
# service.py
class ImportService:
    """
    API 层的业务编排 - 协调多个组件
    - 创建任务 + 入队 ARQ job
    - 查询任务状态
    - 取消任务
    """
    async def submit(self, ...) -> ImportTask:
        # 1. 创建任务
        task = await self.task_manager.create_task(...)
        # 2. 入队 ARQ job
        await self.arq_client.enqueue_import_job(task.id)
        return task
```

**原则**: Service 是 API 的"指挥官"，协调各个组件但不包含核心业务逻辑。

#### 4. `jobs/jobs.py` - ARQ Job 函数 (Worker 专用)

```python
# jobs/jobs.py
async def import_job(ctx, task_id: str):
    """
    ARQ job 函数 - Worker 的入口点
    - 从 context 获取服务实例
    - 加载任务
    - 路由到正确的 Handler
    - 更新任务状态
    """
    task_manager = ctx["task_manager"]
    task = await task_manager.get_task(task_id)
    
    handler = _get_handler(task.task_type, ...)
    result = await handler.process(task, on_progress)
    
    await task_manager.mark_completed(task_id, ...)
```

**原则**: Job 函数是 Worker 的"入口"，做任务路由和状态更新，核心逻辑委托给 Handler。

---

### 数据流图

```
                     ┌─────────────────────────────────────────────────────┐
                     │                   Client (Frontend)                 │
                     └──────────────────────┬──────────────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │           1. POST /import/submit                          │
              ▼                             │                             │
     ┌────────────────┐                     │              ┌──────────────┴──────┐
     │   router.py    │                     │              │ 4. Poll task status │
     │ (parse request)│                     │              │ GET /import/tasks/x │
     └───────┬────────┘                     │              └──────────────┬──────┘
             │                              │                             │
             ▼                              │                             │
     ┌────────────────┐                     │              ┌──────────────▼──────┐
     │   service.py   │                     │              │   task/manager.py   │
     │  (orchestrate) │                     │              │   (read from Redis) │
     └───────┬────────┘                     │              └─────────────────────┘
             │                              │
       ┌─────┴─────┐                        │
       │           │                        │
       ▼           ▼                        │
┌──────────┐ ┌──────────┐                   │
│task/     │ │arq_client│                   │
│manager   │ │(enqueue) │                   │
│(create)  │ └────┬─────┘                   │
└──────────┘      │                         │
                  │                         │
                  ▼                         │
           ┌──────────────┐                 │
           │    Redis     │◄────────────────┤
           │ (job queue)  │                 │
           └──────┬───────┘                 │
                  │                         │
                  │ 2. ARQ picks up job     │
                  ▼                         │
           ┌──────────────┐                 │
           │  jobs.py     │                 │
           │ (import_job) │                 │
           └──────┬───────┘                 │
                  │                         │
                  ▼                         │
           ┌──────────────┐                 │
           │  handlers/   │                 │
           │ (process)    │                 │
           └──────┬───────┘                 │
                  │                         │
                  │ 3. Update progress      │
                  └─────────────────────────┘
```

---

## Directory Structure

```
import_/
├── handlers/           # 🔄 共享 - 核心业务逻辑
│   ├── base.py         # BaseHandler, ImportResult, PreviewResult
│   ├── github_handler.py    # GitHub 导入 + 预览
│   ├── notion_handler.py    # Notion 导入 + 预览
│   ├── gmail_handler.py     # Gmail 导入
│   ├── url_handler.py       # URL 导入 (Firecrawl)
│   └── file_handler.py      # 文件 ETL
│
├── task/               # 🔄 共享 - 任务状态管理
│   ├── models.py       # ImportTask, ImportTaskType, ImportTaskStatus
│   ├── repository.py   # Redis + Supabase 持久化
│   └── manager.py      # 任务生命周期管理
│
├── utils/              # 🔄 共享 - 工具函数
│   ├── url_parser.py   # URL 类型检测 + 解析
│   └── firecrawl_client.py  # Firecrawl API 封装
│
├── jobs/               # 🔧 Worker 专用
│   ├── jobs.py         # import_job 函数
│   └── worker.py       # ARQ Worker 配置
│
├── router.py           # 🌐 API 专用 - HTTP 端点
├── schemas.py          # 🌐 API 专用 - Request/Response
├── service.py          # 🌐 API 专用 - 业务编排
├── dependencies.py     # 🌐 API 专用 - DI
├── arq_client.py       # 🌐 API 专用 - 入队 jobs
│
└── config.py           # ⚙️ 共享配置
```

图例: 🔄 = 共享, 🌐 = API 专用, 🔧 = Worker 专用, ⚙️ = 配置

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/import/submit` | Submit import task |
| GET | `/api/v1/import/tasks/{task_id}` | Get task status |
| GET | `/api/v1/import/tasks` | List user tasks |
| DELETE | `/api/v1/import/tasks/{task_id}` | Cancel task |
| POST | `/api/v1/import/parse` | Parse URL for preview |

## Import Types

| Type | Handler | Description |
|------|---------|-------------|
| `github` | GithubHandler | GitHub repos, issues, PRs |
| `notion` | NotionHandler | Notion pages and databases |
| `gmail` | GmailHandler | Gmail messages |
| `url` | UrlHandler | Generic URLs via Firecrawl |
| `file` | FileHandler | Uploaded files (ETL) |

## Handler Interface

```python
class BaseHandler(ABC):
    async def process(task: ImportTask, on_progress: Callback) -> ImportResult
    async def preview(url: str, user_id: str) -> PreviewResult
    def can_handle(task: ImportTask) -> bool
```

## Notes

- OAuth tokens are obtained via `src/oauth/` services
- Content is stored in Supabase (`content_nodes` table)
- Large files are stored in S3
- Task state is cached in Redis for fast polling

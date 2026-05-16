# Connector 架构设计

> **Terminology note** (per
> [07-version-engine-supplement.md](07-version-engine-supplement.md)
> §4): "Connector" here means **Service Adapter** — third-party data
> source / OAuth / sync code. Protocol-layer adapters (Git
> smart-HTTP, the Product Operation Adapter, the FS CLI backend)
> live under `backend/src/mut_engine/adapters/` and are a different
> kind of "adapter". When in doubt, treat this doc as "service-layer
> connector spec" and consult the supplement for the protocol-layer
> contract.

> Connector 是 PuppyOne 的数据接入层——将外部世界的各种数据源、执行环境、协议端点
> 统一接入 PuppyOne hosted file system。
>
> 前置阅读：[01-mut-engine.md](01-mut-engine.md)（MUT 引擎架构）、
> [02-access-points.md](02-access-points.md)（Access Point 与认证）
>
> 实现参考：[`backend/src/connectors/`](../../backend/src/connectors/)

---

## 1. 设计哲学

### 1.1 一张表、两种写入模式

所有 connector 类型共享一张 `access_points` 表（`provider` 字段区分类型），
但按**数据写入方式**分为两大阵营：

```
┌─────────────────────────────── External World ──────────────────────────────┐
│                                                                             │
│  Notion / Gmail / GitHub       External DB        Local Folder / Agent /    │
│  Google Drive / URL / ...      (PostgreSQL/...)    Sandbox / MCP Client     │
│           │                        │                        │               │
│           └───────┬────────────────┘                        │               │
│                   │                                         │               │
│          ┌────────┴─────────┐                   ┌───────────┴───────────┐   │
│          │  Server          │                   │  Client               │   │
│          │  Pull & Overwrite│                   │  Clone → Modify →    │   │
│          │                  │                   │  Push                 │   │
│          └────────┬─────────┘                   └───────────┬───────────┘   │
│                   │                                         │               │
│          MutOps.write_file()                     MUT native protocol        │
│          (服务端拉取 → 覆盖写入)                   (clone / push / pull)     │
│                   │                                         │               │
└───────────────────┼─────────────────────────────────────────┼───────────────┘
                    │                                         │
                    ▼                                         ▼
              ┌──────────────────────────────────────────────────┐
              │                   MUT Tree (S3 Merkle)           │
              │                   唯一 Source of Truth            │
              └──────────────────────────────────────────────────┘

注：前端 UI 通过 /api/v1/nodes 直接使用 MutOps 读写 MUT tree，
    这是平台内部能力，不属于 Connector 范畴。
```

**为什么分两种？** 因为数据流向不同：

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| **Server Pull & Overwrite** | 外部 SaaS / 数据库数据拉取 | 服务端主动拉取 → 覆盖写入，单向，无需 merge |
| **MUT Native Protocol** | 双向同步、交互式读写 | 客户端 clone → 本地修改 → push，支持 three-way merge |

### 1.2 Connector 分类总览

```
connectors/
├── manager/            统一 CRUD 入口（access_points 表）
│
│  Server Pull & Overwrite:
├── datasource/         SaaS 数据源（Gmail/GitHub/Notion/...）
│   └── oauth/          OAuth 授权流程
├── database/           外部数据库（PostgreSQL/MySQL/...）
│
│  MUT Native Protocol (clone → modify → push):
├── filesystem/         本地文件夹同步（CLI daemon 为客户端）
├── agent/              AI Agent（MutEphemeralClient 为客户端）
│   ├── config/         Agent CRUD & 权限
│   ├── chat/           Chat 会话管理
│   └── mcp/            MCP 工具绑定
├── sandbox_endpoint/   Sandbox 端点（MutEphemeralClient 为客户端）
│
│  被动端点（无写入，外部客户端按需调用）:
└── mcp_endpoint/       MCP 协议端点
```

---

## 2. 两种写入模式详解

### 2.1 Server Pull & Overwrite

**使用者**: datasource、database

服务端主动从外部 API 拉取数据，通过 `MutOps.write_file()` 直接写入 MUT tree。
数据流是单向的（外部 → MUT），不涉及 merge。

```
┌──────────┐     fetch()      ┌───────────┐  write_file()  ┌──────────┐
│ External │ ───────────────→ │ SyncEngine│ ─────────────→ │ MUT Tree │
│ API      │                  │           │                │ (S3)     │
└──────────┘                  └───────────┘                └──────────┘
                                    │
                              content_hash
                              比对 → 无变更则跳过
```

**关键组件**：

- **`SyncEngine`** — 执行引擎，调用 connector.fetch() 拉取数据，比对 hash 后写入
- **`BaseConnector`** — 插件接口，每个 SaaS 源实现 `spec()` + `fetch()`
- **`ConnectorRegistry`** — 自动发现并注册所有 `datasource/*/connector.py`
- **`MutOps`** — 写入层，内部使用 `MutEphemeralClient` 完成 clone → write → push

### 2.2 MUT Native Protocol

**使用者**: filesystem、agent、sandbox_endpoint

客户端通过 MUT 的原生 HTTP 协议（clone / push / pull）与 MUT Server 交互。
支持双向同步、three-way merge、冲突检测。

```
┌──────────┐   clone    ┌───────────┐   push    ┌──────────┐
│ Client   │ ◄────────→ │ MUT       │ ────────→ │ MUT Tree │
│ (CLI /   │   pull     │ Access    │           │ (S3)     │
│  Sandbox │ ◄──────── │ Point     │           │          │
│  Agent)  │            │ (HTTP)    │           │          │
└──────────┘            └───────────┘           └──────────┘
     │
     └── 本地修改（文件编辑 / 代码执行 / LLM 生成）
```

**关键组件**：

- **Access Point** (`mut_engine/access_point.py`) — MUT 协议的 HTTP 端点
- **`MutEphemeralClient`** — 进程内 clone → push 客户端（Agent / Sandbox 使用）
- **Access Key** — 每个 access point 的 `access_key` 字段用于认证（`cli_xxx` / `sbx_xxx`）
- **Scope** — `config.scope` 定义可访问的 MUT 子树路径和读写权限

**三种客户端**：

| 客户端 | clone 方式 | 修改方式 | push 方式 |
|--------|-----------|---------|----------|
| CLI daemon (filesystem) | HTTP clone via Access Point | 本地文件系统编辑 | HTTP push via Access Point |
| Agent service | `MutEphemeralClient.clone()` | Sandbox 容器内执行 | `MutEphemeralClient.push()` |
| Sandbox endpoint | `MutEphemeralClient.clone()` | 容器内命令执行 | `MutEphemeralClient.push()` |

---

## 3. Trigger 机制

Trigger 决定"什么时候同步"。两种写入模式对应两种 trigger 管理方式：

```
┌─────────────────────────────────────────────────────────────┐
│                  Server-Driven Trigger                      │
│                  (服务端管理)                                │
│                                                             │
│   datasource ──→ SchedulerService.sync_trigger()            │
│   database   ──→ (手动触发，scheduler 待接入)                │
│                       │                                     │
│                       ▼                                     │
│              infra/scheduler/                               │
│              ├── service.py    APScheduler 管理              │
│              └── jobs/                                      │
│                  └── sync_job.py  execute_sync_pull()        │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Client-Driven Trigger                      │
│                  (客户端自治，服务端不管)                      │
│                                                             │
│   filesystem ──→ CLI daemon chokidar 文件监听               │
│   agent      ──→ 用户发消息 → LLM 回复后 push               │
│   sandbox    ──→ 用户调 API 执行命令 → 执行后 push           │
│   mcp        ──→ 外部 MCP 客户端主动调用                     │
│                                                             │
│   服务端只负责接收 push，不主动触发任何操作                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Server-Driven Trigger

统一入口：`SchedulerService.sync_trigger(connection_id, provider, trigger_config)`

- **注册 trigger**: 传入 `trigger_config` dict → 解析为 APScheduler CronTrigger / DateTrigger
- **移除 trigger**: 传入 `trigger_config=None` → 移除已注册的 job
- **启动恢复**: 服务启动时 `_load_scheduled_syncs()` 从 DB 重建所有 scheduled job

**调用方**（都通过 `sync_trigger()` 这一个入口）：

| 调用位置 | 场景 |
|---------|------|
| `datasource/router.py` POST create_sync | 创建 scheduled sync 时注册 |
| `datasource/router.py` PATCH trigger | 更新 trigger 配置时注册/移除 |
| `datasource/router.py` DELETE sync | 删除 sync 时移除 |
| `datasource/router.py` POST bootstrap | 批量创建 sync 时注册 |
| `manager/router.py` POST create | 通过统一入口创建 datasource 时注册 |
| `manager/router.py` PATCH update | 更新 access point trigger 时注册/移除 |
| `manager/router.py` DELETE access point | 删除 access point 时移除 |

### 3.2 Trigger 配置格式

存储在 `access_points.trigger` JSON 字段：

```json
// Cron 表达式
{ "type": "scheduled", "schedule": "0 9 * * *" }

// 简单时间 + 重复
{ "type": "scheduled", "time": "09:00", "repeat_type": "daily" }

// 一次性
{ "type": "scheduled", "time": "14:00", "date": "2026-04-01", "repeat_type": "once" }

// 非定时模式（不注册 scheduler job）
{ "type": "import_once" }
{ "type": "manual" }
```

---

## 4. 各 Connector 类型详解

### 4.1 Datasource（SaaS 数据源）

**写入模式**: Server Pull & Overwrite
**Trigger**: Server-driven（手动 / 定时 scheduler）

```
datasource/
├── _base.py           BaseConnector 接口（spec + fetch）
├── registry.py        ConnectorRegistry（自动发现 + 注册）
├── engine.py          SyncEngine（执行引擎）
├── service.py         SyncService（连接 CRUD）
├── repository.py      SyncRepository（access_points 表访问）
├── router.py          API 路由
├── oauth/             OAuth 授权流程（9+ 平台）
├── gmail/             Gmail connector
├── github/            GitHub connector
├── google_drive/      Google Drive connector
├── google_docs/       Google Docs connector
├── google_sheets/     Google Sheets connector
├── google_calendar/   Google Calendar connector
├── google_search_console/  GSC connector
└── url/               URL / 网页抓取 connector
```

**数据流**:

```
SyncEngine.execute(sync_id)
  1. 从 access_points 表读取 sync 配置
  2. connector.fetch(config, credentials)  → 从外部 API 拉取
  3. 比对 content_hash                     → 无变更则跳过
  4. MutOps.write_file(project_id, path)   → 写入 MUT tree
  5. 更新 remote_hash, last_synced_at      → 记录同步状态
```

**插件接口**:

```python
class BaseConnector:
    def spec(self) -> ConnectorSpec:
        """声明能力、认证方式、UI 表单字段"""

    async def fetch(self, config, credentials) -> FetchResult:
        """从外部拉取数据，返回内容 + hash"""
```

新增数据源只需在 `datasource/` 下创建目录，实现 `connector.py`，
`ConnectorRegistry` 自动发现 `datasource/*/connector.py` 并注册。

### 4.2 Filesystem（本地文件夹同步）

**写入模式**: MUT Native Protocol
**Trigger**: Client-driven（CLI daemon chokidar）

```
filesystem/
├── connector.py       FilesystemConnector（ConnectorSpec 声明）
├── service.py         FilesystemService（access point 生命周期管理）
└── router.py          API 路由（仅生命周期端点）
```

**服务端职责极简**——只管理连接生命周期，不参与数据同步：

| 端点 | 用途 |
|------|------|
| `POST /bootstrap` | 创建 access point、分配 access_key |
| `GET /{id}/access-status` | 查询 access point 状态 |
| `POST /connect` | CLI 上线通知 |
| `POST /heartbeat` | CLI 心跳保活 |
| `GET /status` | 查询同步状态 |
| `POST /disconnect` | CLI 下线通知 |

**数据同步完全由 CLI daemon 通过 MUT 原生协议完成**：

```
CLI daemon (客户端)                          MUT Server (服务端)
   │                                              │
   ├─ chokidar 检测文件变更                        │
   ├─ clone (首次) ─────────────────────────────→ │
   ├─ 本地修改                                     │
   ├─ push (变更上传) ──────────────────────────→ │ ← three-way merge
   │                                              │
   ├─ pull (定期拉取服务端变更) ◄──────────────── │
   ├─ 应用到本地文件系统                            │
   └─ 循环...                                     │
```

### 4.3 Agent（AI Agent）

**写入模式**: MUT Native Protocol（via MutEphemeralClient + Sandbox）
**Trigger**: Client-driven（用户发消息 / sandbox reaper 空闲清理）

```
agent/
├── service.py            核心服务（LLM 调用、工具执行、sandbox 编排）
├── sandbox_session.py    Sandbox 会话管理（MutEphemeralClient 生命周期）
├── config/               Agent CRUD & 权限配置
├── chat/                 Chat 会话管理
└── mcp/                  MCP 工具绑定 & 代理
```

**Agent 读写 MUT 的完整生命周期**：

```
用户发消息
  │
  ▼
AgentService.stream_chat()
  │
  ├─ 1. MutEphemeralClient.clone(scope_path)    ← 首次消息时 clone
  │     克隆 MUT 子树到进程内存
  │
  ├─ 2. 准备 Sandbox 文件
  │     将 clone 的文件挂载到 Docker/E2B 容器
  │
  ├─ 3. LLM 调用 → 工具执行
  │     Agent 在 Sandbox 中读写文件、执行代码
  │
  ├─ 4. _read_modified_files()
  │     扫描 Sandbox 容器，diff 出变更文件
  │
  └─ 5. MutEphemeralClient.push()               ← 回复结束时 push
        将变更原子提交回 MUT tree
```

**Sandbox 会话复用**：同一 chat session 内多轮对话复用同一个 `AgentSandboxSession`，
避免每条消息都 clone/push。空闲超时后由 `sandbox_reaper` 自动 push 并销毁。

### 4.4 MCP Endpoint

**写入模式**: 被动端点（外部 MCP 客户端调用 → 内部读写 MUT）
**Trigger**: Client-driven（外部客户端按需调用）

```
mcp_endpoint/
├── router.py          API 路由（CRUD）
├── service.py         端点管理
├── repository.py      数据访问
└── schemas.py         数据模型
```

- 对外暴露 MCP 协议接口，供 Claude Desktop / Cursor 等客户端连接
- `access_key`（`mcp_xxx`）用于认证
- `config` 中定义暴露的工具列表和内容访问 scope

### 4.5 Sandbox Endpoint

**写入模式**: MUT Native Protocol（via MutEphemeralClient）
**Trigger**: Client-driven（用户调 API 执行命令）

```
sandbox_endpoint/
├── router.py          API 路由（CRUD + exec）
├── service.py         端点管理
├── repository.py      数据访问
└── schemas.py         数据模型
```

**执行流程**：

```
POST /sandbox-endpoints/{id}/exec { command: "jq '.users' data.json" }
  │
  ├─ 1. MutEphemeralClient.clone()    ← 按 mount 配置 clone 相关文件
  ├─ 2. 挂载到 Docker 容器
  ├─ 3. 执行命令
  ├─ 4. _read_modified_files()        ← diff 出变更
  └─ 5. MutEphemeralClient.push()     ← 写回 MUT（仅 writable mount）
```

与 Agent 共享 `sandbox_session.py` 中的 `_read_modified_files()` 工具函数。

### 4.6 Database Connector

**写入模式**: Server Pull & Overwrite
**Trigger**: 仅手动（scheduler 待接入）

```
database/
├── router.py              API 路由
├── service.py             DBConnectorService
├── repository.py          access_points 表访问 (provider='database')
├── providers/
│   ├── base.py            BaseDBProvider 接口
│   └── supabase_rest.py   Supabase REST provider
├── jobs.py                db_sync_job（存根，未接入 scheduler）
└── schemas.py / models.py
```

**已知架构问题**：历史上曾使用独立的 `db_connections` 表，现已统一到 `access_points` 表，
是一个待修复的一致性问题。

---

## 5. 统一管理层（Manager）

`connectors/manager/router.py` 是所有 connector 的统一 CRUD 入口：

```
POST   /access        → 按 provider 路由到子服务创建
GET    /access        → 按 project_id / provider / status 过滤
GET    /access/{id}   → 查询详情
PATCH  /access/{id}   → 更新 status / trigger / config
DELETE /access/{id}   → 删除（同时移除 scheduler job）
POST   /access/{id}/regenerate-key → 重新生成 access_key
GET    /access/types  → 列出所有可用 access point 类型
```

**创建路由**：

```
provider = "gmail" / "github" / ...  → _create_datasource() → SyncService
provider = "agent"                   → _create_agent()      → AgentConfigService
provider = "mcp"                     → _create_mcp()        → McpEndpointService
provider = "sandbox"                 → _create_sandbox()    → SandboxEndpointService
provider = "filesystem"              → _create_filesystem() → FilesystemService
```

**PATCH / DELETE 时自动同步 scheduler**：
更新或删除 access point 时会调用 `SchedulerService.sync_trigger()` 确保
scheduler job 与 DB 状态一致。

---

## 6. 相关基础设施

| 模块 | 位置 | 职责 |
|------|------|------|
| MutOps | `mut_engine/services/ops.py` | 统一写入入口（内部使用 MutEphemeralClient） |
| MutEphemeralClient | `mut_engine/ephemeral_client.py` | 进程内 clone → push 客户端 |
| Access Point | `mut_engine/access_point.py` | MUT 协议 HTTP 端点（CLI 使用） |
| SchedulerService | `infra/scheduler/service.py` | APScheduler 管理 |
| Sandbox Runtime | `infra/sandbox/` | Docker / E2B 容器执行引擎 |
| OAuth | `connectors/datasource/oauth/` | OAuth 授权流程（9+ 平台） |

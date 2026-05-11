# MUT 引擎架构设计

> MUT 是 PuppyOne 的版本化文件系统核心——一个基于 Merkle tree 的 Git-like 协议。
> 本文档描述 MUT 引擎在 PuppyOne 中的**设计决策**：为什么这么设计、解决什么问题、架构边界在哪里。
>
> 前置阅读：[00-vision.md](00-vision.md)（问题定义、技术决策、场景矩阵）
> 实现参考：[`backend/src/mut_engine/ARCHITECTURE.md`](../../backend/src/mut_engine/ARCHITECTURE.md)（代码结构、路由表、数据流）

---

## 1. 架构哲学

### 1.1 MUT 与 PuppyOne 的关系

MUT 是独立开源的版本管理协议，专为 AI Agent 设计。
它提供完整的自包含 Server，任何人可以在本地文件系统上独立运行，不需要 PG 或 S3。

PuppyOne 是 MUT 的托管平台。为了实现 cloud-native 部署（无状态 API + 托管存储），
PuppyOne 将 MUT Server 的每个组件"解构"到了不同的托管服务中。

**类比：MUT = Git，PuppyOne = GitHub。**

在 PuppyOne 的服务器上，不存在任何 MUT 文件或 `.mut-server/` 目录。

### 1.2 数据平面 vs 控制平面

```
┌─────────────────── Data Plane: MUT ───────────────────┐
│                                                         │
│  Merkle tree (S3)  — 树结构 + 文件内容（唯一 SOT）       │
│  mut_commits (PG)  — 版本历史                            │
│  audit_logs (PG)   — 审计日志                            │
│  scope             — 权限边界（access_points.config.scope） │
│                                                         │
│  能力: 版本控制、merge、diff、rollback、scope 权限       │
│  协议: clone / push / pull / negotiate                  │
│                                                         │
└────────────────────────┬────────────────────────────────┘
                         │
┌─────────────── Control Plane: PG ──────────────────────┐
│                                                         │
│  projects           — 项目注册                           │
│  access_points      — Agent/connector/endpoint 注册      │
│                       + scope 配置 + access_key          │
│  access_tools       — Agent ↔ Tool 绑定                 │
│  tools / mcps       — Tool / MCP 注册                    │
│  organizations      — 组织管理                           │
│  profiles           — 用户资料                           │
│  oauth_connections  — OAuth 集成                         │
│  chat_sessions/msg  — Agent 聊天历史                     │
│                                                         │
│  能力: 注册、认证、计费、运营                             │
│  特点: 不持有任何文件内容或树结构                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.3 核心原则

```
所有写入 → MUT Protocol (clone → modify → push)
所有读取 → MUT Protocol (clone / pull) 或 MutTreeReader (轻量直读)
没有例外。没有后门。
```

---

## 2. MUT Server 解构

### 2.1 MUT 原生 Server vs PuppyOne 托管

MUT 原生 Server 将所有状态存储为本地文件。PuppyOne 将这些组件解构到云服务中：

```
              Self-hosted MUT                              PuppyOne 托管
  ┌──────────────────────────────────────┐    ┌──────────────────────────────────────────────┐
  │                                      │    │                                              │
  │  ServerRepo                          │    │  PuppyOneServerRepo (无状态)                  │
  │  └── .mut-server/                    │    │  ├── .store   → S3StorageBackend      ──→ S3  │
  │      ├── objects/  (FileSystemBE)    │    │  ├── .history → SupabaseHistoryMgr    ──→ PG  │
  │      ├── history/  (HistoryManager)  │    │  ├── .audit   → SupabaseAuditMgr     ──→ PG  │
  │      ├── audit/    (AuditLog)        │    │  ├── .scopes  → SupabaseScopeMgr     ──→ PG  │
  │      ├── scopes/   (ScopeManager)    │    │  └── .locks   → threading.Lock       ──→ 内存 │
  │      └── locks/    (文件锁)          │    │                                              │
  │                                      │    │          ┌────────────┐  ┌────────────────┐  │
  │  + credentials.json (API key)        │    │          │    S3      │  │      PG        │  │
  │                                      │    │          │  objects/  │  │  projects      │  │
  │  一切都在本地文件系统                  │    │          │  (blobs)   │  │  mut_commits   │  │
  │  SOT = 文件                          │    │          │            │  │  audit_logs    │  │
  │                                      │    │          │            │  │  access_points │  │
  │                                      │    │          └────────────┘  └────────────────┘  │
  │                                      │    │                                              │
  │                                      │    │  SOT = S3 + PG                               │
  └──────────────────────────────────────┘    └──────────────────────────────────────────────┘

  同一时刻只有一种部署模式在运行，SOT 始终只有一份。
```

### 2.2 解构映射

```
MUT 组件                   PuppyOne 存储                 选择理由
──────────────────────    ─────────────────────────     ─────────────────
objects/ (blobs)       →  S3 mut/{pid}/objects/         大二进制、content-addressable
history/ (版本记录)    →  PG mut_commits + projects     需要查询、索引
audit/ (审计日志)      →  PG audit_logs                 需要时间范围、agent 过滤
scopes/ (权限定义)     →  PG access_points.config.scope   小数据、需要关联查询
credentials.json       →  PG access_points.access_key     安全性（加密、吊销）
current/ (工作区)      →  不存在                         按需从 Merkle tree 重建
locks/ (并发锁)        →  内存 threading.Lock            短生命周期
```

拆分原则：

| 特征 | 存储选择 | 示例 |
|------|---------|------|
| 大二进制 blob，只追加 | S3 | objects |
| 结构化，需要查询/过滤/索引 | PG | history、audit、scope |
| 临时状态，无需持久化 | 内存 | locks |
| 可从其他数据派生 | 不存储 | current/ 工作区 |

### 2.3 Backend Adapter 体系

MUT 核心库为每个存储组件提供可插拔的 Backend 抽象接口，不同部署使用不同实现：

```
ObjectStore                              HistoryManager
  StorageBackend (抽象接口)                HistoryBackend (抽象接口)
  ├── FileSystemBackend   ← self-hosted    ├── FileSystemHistoryBE   ← self-hosted
  └── S3StorageBackend    ← PuppyOne       └── SupabaseHistoryManager ← PuppyOne

AuditLog                                 ScopeManager
  AuditBackend (抽象接口)                  ScopeBackend (抽象接口)
  ├── FileSystemAuditBE   ← self-hosted    ├── FileSystemScopeBE    ← self-hosted
  └── SupabaseAuditManager ← PuppyOne      └── SupabaseScopeManager  ← PuppyOne
```

每个 Backend 接口定义完整的方法签名。MUT 协议升级增加新方法时，抽象接口强制所有后端实现适配。

### 2.4 SOT 治理

**每一个数据字段，在任何时刻，只有且仅有一个 SOT。**

| 数据 | SOT 位置 | 所属层 |
|------|---------|--------|
| 文件内容 + 树结构 | S3 `mut/{pid}/objects/` | 数据平面 |
| 版本号 / Root hash | PG `projects` | 数据平面 |
| 版本变更记录 | PG `mut_commits` | 数据平面 |
| 审计日志 | PG `audit_logs` | 数据平面 |
| Scope 权限定义 | PG `access_points.config.scope` | 数据平面 |
| 项目 / 连接 / 用户 / OAuth | PG 各表 | 控制平面 |
| 搜索索引 | Turbopuffer | 派生数据 |

---

## 3. 两条写入路径

这是 `mut_engine` 最重要的设计决策。所有对内容的修改，必须走以下两条路径之一：

```
  前端 / Agent / Connector                  CLI daemon / 远程 MUT 客户端
  (不了解 MUT 协议)                          (自己实现 MUT 协议)
       │                                        │
       │ "写入文件 X 的内容为 Y"                  │ clone → 本地 diff → push payload
       │                                        │
       ▼                                        ▼
  ┌─ 路径 A: MutOps 编排 ──────────┐    ┌─ 路径 B: MUT 原生协议 ─────────┐
  │                                │    │                                │
  │  MutOps.write_file()           │    │  handle_push(repo, auth, body) │
  │    → MutEphemeralClient        │    │  (客户端已完成 clone + diff)    │
  │      clone → modify → push    │    │                                │
  │  (服务端自动完成协议周期)       │    │  (服务端只做协议处理)           │
  │                                │    │                                │
  └────────────┬───────────────────┘    └────────────┬───────────────────┘
               │                                     │
               ▼                                     ▼
  ┌── PuppyOneServerRepo ──────────────────────────────────────┐
  │  S3 (Merkle blobs) + PG (版本历史 + 审计 + 权限)            │
  └─────────────────────────────────────────────────────────────┘
```

### 3.1 为什么需要两条路径？

**路径 A（MutOps 编排）** 存在的意义：
- 不同 channel（前端/Agent/Ingest/Table/Seed）对 MUT tree 的操作本质相同——读/写/删/移动
- 区别只有谁触发、什么认证、什么 scope
- MutOps 把 clone→modify→push 这个固定流程抽为一个薄层，**隐藏 MUT 协议细节**
- 调用方只需提供 `path + content + who + scope`，不需要知道 Merkle tree

**路径 B（MUT 原生协议）** 存在的意义：
- CLI daemon 等 MUT 原生客户端**自己实现了完整的 clone→diff→push 流程**
- 它们和 Git 客户端一样，本地 watch 文件变化、构建 push payload
- 服务端只需做协议处理——和 Git server 只接收 push 一样
- 走 MutOps 反而是多余的间接层

### 3.2 两条路径不是重复实现

两条路径**最终调用同一个 `PuppyOneServerRepo`**，写入同一个 S3 + PG 存储。
差别只在"谁负责构建 push payload"：

| | 路径 A (MutOps) | 路径 B (原生协议) |
|---|---|---|
| **构建 push payload** | 服务端（MutEphemeralClient） | 客户端 |
| **scope 校验** | MUT core（push 阶段） | MUT core（push 阶段） |
| **三方合并** | MUT core | MUT core |
| **存储写入** | PuppyOneServerRepo | PuppyOneServerRepo |

---

## 4. HTTP 入口设计

四种入口，服务不同调用方：

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  Content API (/content)         面向前端和内部服务，REST 语义             │
│    → MutOps 编排                  ls / cat / write / mkdir / mv / rm     │
│                                                                          │
│  Protocol Router (/mut)         面向 CLI daemon，MUT 原生协议             │
│    → mut.server.handlers 直调     clone / push / pull / negotiate        │
│                                                                          │
│  Access Point (/api/v1/mut/ap)         面向任意 MUT 客户端，URL+Key 即可连接     │
│    → 和 Protocol Router 相同       无需传 project_id 和 auth header      │
│                                                                          │
│  Audit Router (/nodes)          面向前端审计面板                          │
│    → 直接查询 PG audit_logs                                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 为什么 Content API 和 Protocol Router 不合并？

- **协议语义不同**：Content API 是 REST（write a file），Protocol 是 MUT 线协议（push a tree snapshot）
- **认证方式不同**：Content API 用 JWT + 项目成员校验，Protocol 用 MUT Authenticator（JWT 或 Access Key）
- **服务端职责不同**：Content API 需要服务端做 clone→push 编排，Protocol 只做协议处理
- **合并会破坏关注点分离**：REST 语义转译和线协议处理是两种完全不同的逻辑

### 为什么 Access Point 单独存在？

Access Point 是 Protocol Router 的简化入口：
- Protocol Router 需要 `project_id`（URL 路径）+ `Authorization`（Header）
- Access Point 只需要一个 `access_key`（URL 路径），project_id 和 auth 自动解析
- 适用于给第三方或 Agent 一个 "URL+Key 即可连接" 的极简接入方式

---

## 5. Channel 架构

### 5.1 Inbound vs Outbound

**Inbound（对内）**：人类或系统把数据写入 MUT tree

| Channel | 触发 | who | 路径 |
|---------|------|-----|------|
| Web UI | 用户点击保存 | `user:{uid}` | 路径 A（Content API → MutOps） |
| File Upload | 用户上传文件/URL | `ingest:{task_id}` | 路径 A（MutOps.bulk_write） |
| Table CRUD | 用户操作表格 | `table:{user_id}` | 路径 A（MutOps.write_file） |

**Outbound（对外分发）**：把 MUT tree 的能力暴露给外部消费者

| Channel | 触发 | who | 路径 |
|---------|------|-----|------|
| MCP Endpoints | MCP client tool_call | `mcp:{endpoint_id}` | 路径 A（内部调用 MutOps） |
| Agent / Sandbox | Chat / cron | `agent:{id}` | 路径 A（MutOps.bulk_write） |
| Datasource | refresh / cron / webhook | `sync:{provider}:{id}` | 路径 A（SyncEngine → MutOps） |
| Filesystem Sync | CLI daemon FSEvent | `fs:{connection_id}` | 路径 B（Protocol Router → handle_push） |

**内部**：

| Channel | 触发 | who | 路径 |
|---------|------|-----|------|
| Seed / Init | 项目创建 / onboarding | `system:seed` | 路径 A（MutOps.bulk_write） |
| DB Connector | 手动 / cron | `db_connector:{id}` | 路径 A（MutOps.write_file） |

### 5.2 关键设计决策

**Connector 职责分离**：
- `connector.fetch()`：OAuth → 调外部 API → 返回 FetchResult(content, hash)
- `SyncEngine`：判断变化(hash 比较) → 序列化 → `MutOps.write_file()`
- connector 不碰 MUT，SyncEngine 不碰外部 API

**Filesystem Sync 完全 client 驱动**：
- Client 负责：watch 文件变化、diff、clone/push/pull
- Server 负责：暴露 Protocol Router、创建 access point + 发放 Access Key
- Server 不做：watch、diff、sync 状态管理、任何 daemon 逻辑
- 和 Git 模式完全一致：server 不管 client 怎么 watch，client 决定什么时候 push

**Sandbox 写回 = 普通 bulk_write**：
- Sandbox 执行完后，diff 变更文件，调 `MutOps.bulk_write()` 写回
- 和前端批量编辑没有本质区别，不需要直接操作 MUT handlers

### 5.3 Scope 分配表

每个 channel 通过 `who` + `scope` 传入 MutOps，越权写入在 push 阶段被拒绝：

| Channel | who | scope |
|---------|-----|-------|
| Web UI | `user:{uid}` | `""` (root) |
| Agent / Sandbox | `agent:{id}` | agent 配置的 scope path |
| MCP | `mcp:{endpoint_id}` | endpoint 配置的 scope path |
| Datasource | `sync:{provider}:{id}` | 挂载路径 |
| Filesystem | `fs:{connection_id}` | access point 配置的 scope path |
| Ingest / ETL | `ingest:{task_id}` | target_folder |
| Table CRUD | `table:{user_id}` | table_path |
| DB Connector | `db_connector:{id}` | target_path |
| Seed / Init | `system:seed` | `""` (root) |

---

## 6. 权限模型

### 6.1 Scope 定义

Agent 权限完全由 `access_points.config.scope` 定义，path-based：

```json
{
  "path": "docs/",
  "exclude": ["docs/internal/"],
  "mode": "rw"
}
```

MUT 协议在 clone/push/pull 时使用 scope 限制可见范围——clone 只给 scope 内文件，push 拒绝越权写入。

### 6.2 认证 vs 授权

| 职责 | 管理者 | 存储 |
|------|--------|------|
| 身份认证（"谁"） | PuppyOne | PG `access_points.access_key` |
| 权限边界（"哪些路径"） | MUT ScopeManager | PG `access_points.config.scope` |
| 操作模式（"读/写"） | MUT ScopeManager | `scope.mode` |

### 6.3 权限检查流程

```
请求进来 → 解析 auth token
  │
  ├─ JWT (人类用户) → scope = {"path": "", "mode": "rw"}  (全量访问)
  │
  └─ Access Key (Agent) → 查 access_points 表 → scope = config.scope
     │
     ▼
  对每个文件操作: check_path_permission(scope, file_path, action)
     ├─ path 在 scope.path 下？
     ├─ path 不在 scope.exclude 下？
     └─ action 匹配 scope.mode？
```

### 6.4 删除与恢复

删除直接从当前 Mut tree 中移除路径，并产生 commit/audit 记录。
恢复不通过树内回收站目录实现，而是通过版本历史、diff、rollback
或未来的 per-path restore 能力完成。

---

## 7. 可扩展性

**新增一种 Channel**：只需调用 `MutOps.write_file()` / `MutOps.bulk_write()`，传入 `who` 和 `scope`。不需要修改 MUT 内核、Storage Layer、或理解 Merkle tree 实现细节。

**新增一种存储后端**：实现 `mut` 核心库定义的 Backend 抽象接口，替换对应适配器。

**新增 HTTP 入口**：在 `routers/` 下创建新的 FastAPI Router，注入 `MutRepoManager`（协议级）或 `MutOps`（编排级）。

> 具体代码结构、路由表、请求数据流详见 [`backend/src/mut_engine/ARCHITECTURE.md`](../../backend/src/mut_engine/ARCHITECTURE.md)

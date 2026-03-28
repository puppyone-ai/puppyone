# MUT 引擎核心架构

> MUT 是 PuppyOne 的版本化文件系统核心——一个基于 Merkle tree 的 Git-like 协议。
> 本文档描述 MUT 引擎在 PuppyOne 中的架构设计：存储解构、操作分层、Channel 接入和权限模型。
>
> 前置阅读：[00-vision.md](00-vision.md)（问题定义、技术决策、场景矩阵）

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
│  scope             — 权限边界（connections.config.scope） │
│  .trash/           — 软删除（Mut tree 内目录）            │
│                                                         │
│  能力: 版本控制、merge、diff、rollback、scope 权限       │
│  协议: clone / push / pull / negotiate                  │
│                                                         │
└────────────────────────┬────────────────────────────────┘
                         │
┌─────────────── Control Plane: PG ──────────────────────┐
│                                                         │
│  projects           — 项目注册                           │
│  connections        — Agent/connector/endpoint 注册      │
│                       + scope 配置 + access_key          │
│  connection_tools   — Agent ↔ Tool 绑定                 │
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
  │                                      │    │          │            │  │  connections   │  │
  │                                      │    │          └────────────┘  └────────────────┘  │
  │                                      │    │                                              │
  │                                      │    │  SOT = S3 + PG                               │
  └──────────────────────────────────────┘    └──────────────────────────────────────────────┘

  同一时刻只有一种部署模式在运行，SOT 始终只有一份。
```

### 2.2 解构映射

```
MUT 组件                   PuppyOne 存储                 实现类                         选择理由
──────────────────────    ─────────────────────────     ────────────────────────       ─────────────────
objects/ (blobs)       →  S3 mut/{pid}/objects/         S3StorageBackend               大二进制、content-addressable
history/ (版本记录)    →  PG mut_commits + projects     SupabaseHistoryManager         需要查询、索引
audit/ (审计日志)      →  PG audit_logs                 SupabaseAuditManager           需要时间范围、agent 过滤
scopes/ (权限定义)     →  PG connections.config.scope   SupabaseScopeManager           小数据、需要关联查询
credentials.json       →  PG connections.access_key     PuppyOneAuthenticator          安全性（加密、吊销）
current/ (工作区)      →  不存在                         按需从 Merkle tree 重建         无需持久化
locks/ (并发锁)        →  内存 threading.Lock            PuppyOneServerRepo             短生命周期
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
| Scope 权限定义 | PG `connections.config.scope` | 数据平面 |
| 项目 / 连接 / 用户 / OAuth | PG 各表 | 控制平面 |
| 搜索索引 | Turbopuffer | 派生数据 |

---

## 3. MutOps — 统一操作层

`MutOps` 是所有 channel 操作 MUT tree 的**唯一入口**（`mut_engine/ops.py`）。

### 3.1 为什么需要这一层

不同 channel 对 MUT tree 的操作本质相同（读/写/删/移动），区别只有谁触发、什么认证、什么 scope。MutOps 把固定逻辑（创建 client → clone → 构建 snapshot → push → 处理冲突 → 返回版本号）抽为一个薄层，避免每个 channel 重复实现。

### 3.2 接口概要

**写操作**（内部均为 clone → modify → push）：

| 方法 | 说明 |
|------|------|
| `write_file(project_id, path, content, who, scope)` | 写入单个文件 |
| `bulk_write(project_id, files, who, scope, deleted)` | 批量写入 + 批量删除（单次 push） |
| `delete(project_id, paths, who, scope)` | 删除文件/目录 |
| `mkdir(project_id, path, who, scope)` | 创建目录（写入 .keep） |
| `move(project_id, old_path, new_path, who, scope)` | 移动/重命名 |
| `trash(project_id, path, who, scope)` | 移入 .trash（软删除） |
| `restore(project_id, trash_path, original_path, who, scope)` | 从 .trash 恢复 |

**读操作**（MutTreeReader 直读 Merkle tree，不经过 PG）：

| 方法 | 说明 |
|------|------|
| `read_file(project_id, path)` | 读取文件内容 |
| `list_dir(project_id, path)` | 列出目录内容 |
| `list_tree(project_id, path, max_depth)` | 递归列出目录树 |
| `stat(project_id, path)` | 获取文件/目录元信息 |
| `get_version(project_id)` | 获取当前版本号 |

所有写操作返回 `WriteResult(version, merged, conflicts)`。

### 3.3 两种 HTTP 外壳

MutOps 通过两个 router 对外暴露，两者殊途同归：

**tree_router** — 高层 REST API（面向前端和内部服务）：

```
POST /api/v1/tree/{project_id}/write      → MutOps.write_file()
POST /api/v1/tree/{project_id}/mkdir      → MutOps.mkdir()
POST /api/v1/tree/{project_id}/mv         → MutOps.move()
POST /api/v1/tree/{project_id}/rm         → MutOps.trash()
POST /api/v1/tree/{project_id}/bulk-write → MutOps.bulk_write()
GET  /api/v1/tree/{project_id}/ls         → MutOps.list_dir()
GET  /api/v1/tree/{project_id}/cat        → MutOps.read_file()
GET  /api/v1/tree/{project_id}/tree       → MutOps.list_tree()
GET  /api/v1/tree/{project_id}/stat       → MutOps.stat()
```

**protocol_router** — MUT 线协议（面向 CLI daemon / 远程 client）：

```
POST /api/v1/mut/{project_id}/clone
POST /api/v1/mut/{project_id}/push
POST /api/v1/mut/{project_id}/pull
POST /api/v1/mut/{project_id}/negotiate
```

### 3.4 DI 注入

```python
# FastAPI 路由中
def get_mut_ops(repo_manager = Depends(get_repo_manager)) -> MutOps:
    return MutOps(repo_manager)

# Job / Worker 中
def create_mut_ops() -> MutOps:
    return MutOps(get_repo_manager_standalone())
```

---

## 4. Channel 架构

### 4.1 Inbound vs Outbound

**Inbound（对内）**：人类或系统把数据写入 MUT tree

| Channel | 触发 | who | 说明 |
|---------|------|-----|------|
| Web UI | 用户点击保存 | `user:{uid}` | HTTP → tree_router → MutOps |
| File Upload | 用户上传文件/URL | `ingest:{task_id}` | ingest API → ETL → MutOps.bulk_write |
| Table CRUD | 用户操作表格 | `table:{user_id}` | table API → MutOps.write_file |

**Outbound（对外分发）**：把 MUT tree 的能力暴露给外部消费者

| Channel | 触发 | who | 说明 |
|---------|------|-----|------|
| MCP Endpoints | MCP client tool_call | `mcp:{endpoint_id}` | MCP Server → internal API → MutOps |
| Agent / Sandbox | Chat / cron | `agent:{id}` | 读 scope 文件 → sandbox 执行 → diff → MutOps.bulk_write |
| Datasource | refresh / cron / webhook | `sync:{provider}:{id}` | connector.fetch() → SyncEngine → MutOps.write_file |
| Filesystem Sync | CLI daemon FSEvent | `fs:{connection_id}` | HTTP → protocol_router → MutOps |

**内部**：

| Channel | 触发 | who | 说明 |
|---------|------|-----|------|
| Seed / Init | 项目创建 / onboarding | `system:seed` | MutOps.bulk_write |
| DB Connector | 手动 / cron | `db_connector:{id}` | MutOps.write_file |

### 4.2 关键设计决策

**Connector 职责分离**：
- `connector.fetch()`：OAuth → 调外部 API → 返回 FetchResult(content, hash)
- `SyncEngine`：判断变化(hash 比较) → 序列化 → `MutOps.write_file()`
- connector 不碰 MUT，SyncEngine 不碰外部 API

**Filesystem Sync 完全 client 驱动**：
- Client 负责：watch 文件变化、diff、clone/push/pull
- Server 负责：暴露 protocol_router、创建 connection + 发放 Access Key
- Server 不做：watch、diff、sync 状态管理、任何 daemon 逻辑
- 和 Git 模式完全一致：server 不管 client 怎么 watch，client 决定什么时候 push

**Sandbox 写回 = 普通 bulk_write**：
- Sandbox 执行完后，diff 变更文件，调 `MutOps.bulk_write()` 写回
- 和前端批量编辑没有本质区别，不需要直接操作 MUT handlers

### 4.3 Scope 分配表

每个 channel 通过 `who` + `scope` 传入 MutOps，越权写入在 push 阶段被拒绝：

| Channel | who | scope |
|---------|-----|-------|
| Web UI | `user:{uid}` | `""` (root) |
| Agent / Sandbox | `agent:{id}` | agent 配置的 scope path |
| MCP | `mcp:{endpoint_id}` | endpoint 配置的 scope path |
| Datasource | `sync:{provider}:{id}` | 挂载路径 |
| Filesystem | `fs:{connection_id}` | connection 配置的 scope path |
| Ingest / ETL | `ingest:{task_id}` | target_folder |
| Table CRUD | `table:{user_id}` | table_path |
| DB Connector | `db_connector:{id}` | target_path |
| Seed / Init | `system:seed` | `""` (root) |

---

## 5. 权限模型

### 5.1 Scope 定义

Agent 权限完全由 `connections.config.scope` 定义，path-based：

```json
{
  "path": "docs/",
  "exclude": ["docs/internal/"],
  "mode": "rw"
}
```

MUT 协议在 clone/push/pull 时使用 scope 限制可见范围——clone 只给 scope 内文件，push 拒绝越权写入。

### 5.2 认证 vs 授权

| 职责 | 管理者 | 存储 |
|------|--------|------|
| 身份认证（"谁"） | PuppyOne | PG `connections.access_key` |
| 权限边界（"哪些路径"） | MUT ScopeManager | PG `connections.config.scope` |
| 操作模式（"读/写"） | MUT ScopeManager | `scope.mode` |

### 5.3 权限检查流程

```
请求进来 → 解析 auth token
  │
  ├─ JWT (人类用户) → scope = {"path": "", "mode": "rw"}  (全量访问)
  │
  └─ Access Key (Agent) → 查 connections 表 → scope = config.scope
     │
     ▼
  对每个文件操作: check_path_permission(scope, file_path, action)
     ├─ path 在 scope.path 下？
     ├─ path 不在 scope.exclude 下？
     └─ action 匹配 scope.mode？
```

### 5.4 .trash 软删除

在 Mut tree 内部用 `.trash/` 目录实现，不依赖 PG：
- 删除 = `MutOps.trash()` → mv 到 `.trash/<name>_<timestamp>`
- 恢复 = `MutOps.restore()` → mv 回原路径
- `.trash/` 是 Mut tree 的一部分，有完整版本历史
- Agent scope 默认 exclude `.trash/`

---

## 6. 数据流

### 6.1 写入流

```
  前端 / CLI / Agent / Connector
          │
          ▼
  ┌── API 层 ──────────────────────────────────────────────┐
  │  Tree API     (/api/v1/tree/{pid}/write|mkdir|mv|rm)    │
  │  MUT Protocol (/api/v1/mut/{pid}/clone|push|pull)       │
  │  Datasource   (SyncEngine → MutOps)                    │
  └──────────────────┬─────────────────────────────────────┘
                     │
                     ▼
  ┌── MutOps → MUT Core ────────────────────────────────────┐
  │  1. content → ObjectStore.put(bytes) → S3               │
  │  2. 修改 Merkle tree → S3                               │
  │  3. graft_subtree → new root hash                       │
  │  4. three_way_merge (冲突时)                             │
  │  5. history.record() → PG mut_commits                   │
  │  6. audit.record() → PG audit_logs                      │
  │  7. post-commit hook:                                   │
  │     ├── 更新受影响的 connections.node_id                  │
  │     ├── 更新搜索索引 (Turbopuffer)                       │
  │     └── WebSocket 通知                                  │
  └─────────────────────────────────────────────────────────┘
```

### 6.2 读取流

```
  前端 / CLI / Agent
          │
          ├── 目录浏览 ──→ MutOps.list_dir()     → S3 Merkle tree
          ├── 文件内容 ──→ MutOps.read_file()    → S3 blob
          ├── 版本历史 ──→ PG mut_commits
          ├── Diff ──────→ mut.core.diff_trees()  → S3 (两个 tree)
          ├── Scope ─────→ ScopeManager           → PG
          └── 搜索 ──────→ Turbopuffer            → (project_id, path)
```

### 6.3 Post-commit Hooks

| Hook | 触发条件 | 动作 |
|------|---------|------|
| 搜索索引 | 文件 added/modified/deleted | upsert/delete Turbopuffer chunks，key = (project_id, path) |
| 挂载点一致性 | 文件/目录 move/delete | 更新 `connections.node_id` 中受影响的路径 |
| Scope 一致性 | 路径 rename | 通过 `ScopeManager.list_by_path_prefix()` 更新受影响的 scope |
| WebSocket | 任何 commit | 推送实时更新通知给前端 |

---

## 附录：模块职责总结

| 模块 | 职责 | 不做什么 |
|------|------|---------|
| `mut_engine/ops.py` (MutOps) | 所有 channel 的读写统一入口 | 不管认证、不管触发条件 |
| `mut_engine/tree_reader.py` (MutTreeReader) | 轻量读取 Merkle tree | 不做写入 |
| `mut_engine/ephemeral_client.py` (MutEphemeralClient) | clone → push 协议封装 | 不对外暴露，只被 MutOps 使用 |
| `mut_engine/tree_router.py` | MutOps 的 REST HTTP 外壳 | 不含业务逻辑 |
| `mut_engine/protocol_router.py` | MutOps 的 MUT 线协议 HTTP 外壳 | 不含业务逻辑 |
| `mut_engine/write_service.py` (MutAdminService) | init_tree / rollback / 历史查询 | 不做常规写入 |
| `mut_engine/server_repo.py` (PuppyOneServerRepo) | S3 + PG 适配器，per-project repo | 不含业务逻辑 |
| `mut_engine/repo_manager.py` | per-project repo 工厂 | 不含业务逻辑 |
| `mut_engine/auth.py` | JWT/AccessKey → agent + scope | 只做认证 |
| `connectors/*/service.py` | Channel 触发 + 认证逻辑 | 不直接操作 MUT，只调 MutOps |

**可扩展性**：新增一种 channel 只需在 router/service 中调用 `MutOps.write_file()` / `MutOps.bulk_write()`，传入 `who` 和 `scope`。不需要修改 MUT 内核、Storage Layer、或理解 Merkle tree 实现细节。

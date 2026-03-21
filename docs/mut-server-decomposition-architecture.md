# MUT Server 解构架构

> PuppyOne 将 MUT Server 解构为 S3 + PG + 内存，实现 cloud-native 无状态部署。
> 本文档描述解构后的存储映射、SOT 治理规则和一致性维护机制。

---

## 1. MUT 与 PuppyOne 的关系

MUT 是 PuppyOne 独立开源的版本管理协议，专为 AI Agent 设计。
它提供完整的自包含 Server，任何人可以在本地文件系统上独立运行，不需要 PG 或 S3。

PuppyOne 是 MUT 的托管平台。为了实现 cloud-native 部署（无状态 API + 托管存储），
PuppyOne 将 MUT Server 的每个组件"解构"到了不同的托管服务中。

**在 PuppyOne 的服务器上，不存在任何 MUT 文件或 `.mut-server/` 目录。**

---

## 2. 解构映射

### 2.1 MUT 原生 Server 结构

MUT 原生 Server 将所有状态存储为本地文件：

```
/repo-root/
├── current/                    ← 工作区文件
├── credentials.json            ← API key → agent + scope 绑定
└── .mut-server/
    ├── config.json             ← 项目配置
    ├── objects/                ← content-addressable blob 存储
    ├── scopes/                 ← 路径权限定义 (per-scope JSON)
    ├── history/                ← 版本历史 (per-version JSON + latest + root)
    ├── audit/                  ← 审计日志 (per-event JSON)
    └── locks/                  ← 并发锁 (文件锁)
```

### 2.2 PuppyOne 的解构目标

```
MUT 组件                   PuppyOne 存储                 实现类                         选择理由
──────────────────────    ─────────────────────────     ────────────────────────       ─────────────────
objects/ (blobs)       →  S3 mut/{pid}/objects/         S3StorageBackend               大二进制、content-addressable
history/latest (版本)  →  PG projects.mut_version       SupabaseHistoryManager         需要查询、索引
history/root (根hash)  →  PG projects.mut_root_hash     SupabaseHistoryManager         同上
history/*.json (记录)  →  PG mut_commits 表              SupabaseHistoryManager         需要分页、按 scope 过滤
audit/ (审计日志)      →  PG audit_logs 表               SupabaseAuditManager           需要时间范围、agent 过滤
scopes/ (权限定义)     →  PG connections.config.scope    SupabaseScopeManager           小数据、需要关联查询
config.json (项目名)   →  PG projects.name               PuppyOneServerRepo             已有实体属性
credentials.json (key) →  PG connections.access_key      PuppyOneAuthenticator          安全性（加密、吊销、审计）
current/ (工作区)      →  不存在                          list_scope_files() 按需重建    Merkle tree 已包含全部信息
locks/ (并发锁)        →  内存 threading.Lock             PuppyOneServerRepo             短生命周期、无需持久化
```

### 2.3 拆分原则

| 特征 | 存储选择 | 示例 |
|------|---------|------|
| 大二进制 blob，只追加 | S3 | objects |
| 结构化，需要查询/过滤/索引 | PG | history、audit、scope |
| 临时状态，无需持久化 | 内存 | locks |
| 可从其他数据派生 | 不存储 | current/ 工作区 |

### 2.4 完整对比图

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

---

## 3. SOT 治理

### 3.1 核心规则

**每一个数据字段，在任何时刻，只有且仅有一个 SOT。**

PuppyOne 部署中不存在 MUT 文件，因此 S3 / PG 中的数据不是"第二份"，
而是唯一一份。就像 `SupabaseHistoryManager` 不是 `.mut-server/history/` 的缓存——
因为后者根本不存在。

### 3.2 数据归属表

| 数据 | SOT 位置 | 所属层 |
|------|---------|--------|
| 文件内容 (blobs) | S3 `mut/{pid}/objects/` | 数据平面 (MUT) |
| 树结构 (Merkle tree) | S3 `mut/{pid}/objects/` | 数据平面 (MUT) |
| 版本号 / Root hash | PG `projects` | 数据平面 (MUT) |
| 版本变更记录 | PG `mut_commits` | 数据平面 (MUT) |
| 审计日志 | PG `audit_logs` | 数据平面 (MUT) |
| Scope 权限定义 | PG `connections.config.scope` | 数据平面 (MUT) |
| | | |
| 项目信息 | PG `projects` | 控制平面 (PuppyOne) |
| 连接配置 (provider/status/trigger) | PG `connections` | 控制平面 (PuppyOne) |
| 挂载路径 (node_id) | PG `connections.node_id` | 控制平面 (PuppyOne) |
| Access Key | PG `connections.access_key` | 控制平面 (PuppyOne) |
| Agent 工具绑定 | PG `connection_tools` | 控制平面 (PuppyOne) |
| 用户 / 组织 / OAuth | PG 各表 | 控制平面 (PuppyOne) |
| 搜索索引 | Turbopuffer | 派生数据 |

### 3.3 Access Key 不在 MUT 文件里

MUT 原生用 `credentials.json` 存储 API key。PuppyOne 刻意绕过这个机制，
将 access_key 存在 PG 中。这是一个正确的安全决策：

- PG 支持加密存储、RLS、审计追踪
- Key 的生命周期管理（创建/吊销/轮换）是平台层职责
- 文件存储密钥无加密、无吊销机制

---

## 4. Backend Adapter 体系

### 4.1 设计

MUT 核心库为每个存储组件提供可插拔的 Backend 抽象接口。
不同部署场景使用不同的后端实现。

```
ObjectStore
  StorageBackend (抽象接口)
  ├── FileSystemBackend       ← self-hosted 用户
  └── S3StorageBackend        ← PuppyOne 托管

HistoryManager
  HistoryBackend (抽象接口)
  ├── FileSystemHistoryBE     ← self-hosted 用户
  └── SupabaseHistoryManager  ← PuppyOne 托管

AuditLog
  AuditBackend (抽象接口)
  ├── FileSystemAuditBE       ← self-hosted 用户
  └── SupabaseAuditManager    ← PuppyOne 托管

ScopeManager
  ScopeBackend (抽象接口)
  ├── FileSystemScopeBE       ← self-hosted 用户
  └── SupabaseScopeManager    ← PuppyOne 托管
```

### 4.2 接口约束

每个 Backend 接口定义了完整的方法签名。当 MUT 协议升级增加新方法时，
抽象接口强制所有后端实现适配，不会出现遗漏。

**ScopeBackend**：
- `get(scope_id) → dict | None`
- `put(scope_id, scope_dict)`
- `list_all() → list[dict]`
- `delete(scope_id)`
- `list_by_path_prefix(path) → list[dict]`

**HistoryBackend**：
- `get_latest_version() → int`
- `set_latest_version(version)`
- `get_root_hash() → str`
- `set_root_hash(hash)`
- `record(version, who, message, scope_path, changes, conflicts, root_hash)`
- `get_since(since_version, scope_path, limit) → list[dict]`
- `get_entry(version) → dict | None`

**AuditBackend**：
- `record(event_type, agent_id, detail)`

### 4.3 PuppyOneServerRepo 组装

```
PuppyOneServerRepo
├── store    = ObjectStore(backend=S3StorageBackend(s3, pid))
│              S3 key: mut/{pid}/objects/{h[:2]}/{h[2:]}
│
├── history  = SupabaseHistoryManager(supabase, pid)
│              PG: projects.mut_version, projects.mut_root_hash, mut_commits
│
├── audit    = SupabaseAuditManager(supabase, pid)
│              PG: audit_logs
│
├── scopes   = SupabaseScopeManager(supabase, pid)
│              PG: connections.config.scope
│
└── locks    = threading.Lock (内存)
```

---

## 5. 认证与权限

### 5.1 认证流程

```
请求进来 → PuppyOneAuthenticator.authenticate(token, project_id)
  │
  ├─ JWT Bearer (人类用户)
  │   → scope = {"path": "", "exclude": [], "mode": "rw"} (全量访问)
  │
  └─ Access Key (Agent)
      → PG: SELECT id, config FROM connections WHERE access_key = key
      → scope = server_repo.scopes.get(connection_id)
      → return {"agent": conn_id, "_scope": scope}

MUT handlers 使用 auth["_scope"] 限制文件访问范围
```

### 5.2 Scope 定义

Scope 是路径前缀 + 排除列表 + 读写模式：

```json
{
    "path": "docs/",
    "exclude": ["docs/internal/"],
    "mode": "rw"
}
```

MUT 协议在 clone/push/pull 时使用 scope 限制 agent 的可见范围。
Agent 只能看到和修改 scope 范围内的文件。

### 5.3 Scope vs Access Key 的分工

| 职责 | 管理者 | 存储 |
|------|--------|------|
| "这个 agent 是谁" — 身份认证 | PuppyOne | PG `connections.access_key` |
| "这个 agent 能访问哪些路径" — 权限边界 | MUT ScopeManager | PG `connections.config.scope` (通过 ScopeBackend) |
| "这个 agent 能做什么操作" — 读/写模式 | MUT ScopeManager | scope.mode |

---

## 6. 挂载点一致性

### 6.1 什么是挂载点

`connections.node_id` 是"connector 将外部数据写入 MUT tree 的目标路径"。
这是 PuppyOne 平台层概念，MUT 协议不关心它。

| connection | provider | node_id | 含义 |
|---|---|---|---|
| Gmail sync | gmail | `data/gmail.md` | Gmail 数据写到这个路径 |
| GitHub sync | github | `data/github-issues.md` | GitHub issues 写到这个路径 |
| Folder sync | filesystem | `docs` | 本地文件夹同步到这个目录 |
| Agent | agent | (null) | agent 没有挂载点 |

### 6.2 一致性维护

挂载点引用了 MUT tree 中的路径。当路径发生变更时，
`MutWriteService` 通过 post-commit hook 维护 PG 中引用的一致性：

| MUT 操作 | 对 connections 的影响 |
|----------|----------------------|
| `delete_file(path)` | 标记 `node_id = path` 的 connections 为 orphaned |
| `delete_folder(path)` | 标记 `node_id LIKE path/%` 的 connections 为 orphaned |
| `trash(path)` | 同 delete（路径变更到 `.trash/`） |
| `move_file(old, new)` | 更新 `node_id = old` → `node_id = new` |
| `move_folder(old, new)` | 批量更新 `node_id` 中以 `old/` 开头的路径 |

同样的机制也处理 `scope.path` 的更新：当 scope 引用的路径被 rename 时，
post-commit hook 通过 `ScopeManager.list_by_path_prefix()` 找到受影响的 scope 并更新。

---

## 7. 数据流

### 7.1 写入

```
  前端 / CLI / Agent / Connector
          │
          ▼
  ┌── API 层 ──────────────────────────────────────────────┐
  │  Tree API     (/api/v1/tree/{pid}/write|mkdir|mv|rm)    │
  │  MUT Protocol (/api/v1/mut/{pid}/clone|push|pull)       │
  │  Datasource   (SyncService → MutWriteService)           │
  │  Filesystem   (OpenClawService → MUT push)              │
  └──────────────────┬─────────────────────────────────────┘
                     │
                     ▼
  ┌── MutWriteService ─────────────────────────────────────┐
  │  1. content → ObjectStore.put(bytes) → S3              │
  │  2. 修改 Merkle tree → S3                              │
  │  3. graft_subtree → new root hash                      │
  │  4. three_way_merge (冲突时)                            │
  │  5. history.record() → PG mut_commits                  │
  │  6. audit.record() → PG audit_logs                     │
  │  7. post-commit hook:                                  │
  │     ├── 更新受影响的 connections.node_id                 │
  │     ├── 更新受影响的 scope.path                         │
  │     ├── 更新搜索索引 (Turbopuffer)                      │
  │     └── WebSocket 通知                                 │
  └────────────────────────────────────────────────────────┘
```

### 7.2 读取

```
  前端 / CLI / Agent
          │
          ├── 目录浏览 ──→ MutTreeReader.list_dir()  → S3 Merkle tree
          ├── 文件内容 ──→ MutTreeReader.read_file() → S3 blob
          ├── 版本历史 ──→ PG mut_commits
          ├── Diff ──────→ mut.core.diff_trees()     → S3 (两个 tree)
          ├── Scope ─────→ ScopeManager              → PG
          ├── 连接列表 ──→ PG connections
          └── 搜索 ──────→ Turbopuffer               → (project_id, path)
```

---

## 8. 设计决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| MUT Server 部署模式 | 解构到 S3 + PG | cloud-native、无状态、可扩展 |
| 所有存储组件 | Backend Adapter 模式 | 支持多部署模式、接口约束防遗漏 |
| Scope 存储 | PG（通过 ScopeBackend） | 数据量小、需要关联查询、与其他组件一致 |
| Access Key 存储 | PG `connections.access_key` | 安全性（加密、吊销、审计） |
| 挂载点存储 | PG `connections.node_id` | 平台层概念，MUT 协议不关心 |
| 挂载点一致性 | MutWriteService post-commit hook | 应用层维护引用完整性 |
| 工作区 (current/) | 不存储 | Merkle tree 包含全部信息，按需重建 |
| 并发锁 | 内存 threading.Lock | 短生命周期、单进程足够 |

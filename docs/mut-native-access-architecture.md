# MUT-Native Access Architecture

PuppyOne 的核心是 MUT tree —— 一个基于 Merkle tree 的版本化文件系统。
所有对 MUT tree 的读写操作，不论来源，都必须经过 MUT protocol。

## 核心原则

```
所有写入 → MUT Protocol (clone → modify → push)
所有读取 → MUT Protocol (clone / pull) 或 MutTreeReader (轻量直读)
没有例外。没有后门。
```

---

## Channel 分类

PuppyOne 有两类 channel：

- **Inbound (对内)**：人类或系统把数据写入 MUT tree
- **Outbound (对外分发)**：把 MUT tree 的能力暴露给外部消费者

### Inbound Channels (对内 — 数据进入 MUT tree)

| Channel | 数据来源 | 说明 |
|---------|---------|------|
| **Web UI** | 人类在浏览器中编辑 | 最基本的写入方式 |
| **File Upload (Ingest/ETL)** | 用户上传文件 | 文件解析后写入 MUT tree |

这两种是纯粹的 "人 → 系统" 输入。

### Outbound Channels (对外分发 — MUT tree 暴露给外部)

| Channel | 消费者 | 说明 |
|---------|--------|------|
| **MCP Endpoints** | Claude Desktop, Cursor, 任何 MCP client | 通过 MCP tool (ls/cat/write/rm) 读写 MUT tree |
| **Agent / Sandbox** | AI Agent | 在隔离沙盒中执行任务，clone scope → exec → push back |
| **Datasource Connectors** | Gmail, GitHub, Google Drive, URL, DB, ... | 外部 SaaS 数据通过 connector 同步到 MUT tree |
| **Filesystem Sync** | 本地文件系统 (CLI daemon) | 双向同步：MUT tree ↔ 本地文件夹 |

这四种的共同特点：**MUT tree 对外暴露了一种能力**，让外部系统（Agent、SaaS、本地文件系统）能够与 MUT tree 交互。Datasource 虽然数据流向是"外 → 内"，但本质上是 PuppyOne 对外伸出一只手去**抓取**外部数据 —— 它是一个对外的 connector，不是内部操作。

---

## 架构总览

```
                     ┌──────────────────────────────────────────┐
                     │           INBOUND (对内)                  │
                     │                                          │
                     │  ┌────────────┐      ┌────────────┐     │
                     │  │  Web UI    │      │  Ingest    │     │
                     │  │  (Human)   │      │  (Upload)  │     │
                     │  └─────┬──────┘      └─────┬──────┘     │
                     │        │                    │            │
                     └────────┼────────────────────┼────────────┘
                              │                    │
                              ▼                    ▼
                     ┌──────────────────────────────────────────┐
                     │                                          │
                     │          MutEphemeralClient               │
                     │          (in-process 调用)                 │
                     │                                          │
                     └──────────────────┬───────────────────────┘
                                        │
                                        ▼
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║                        MUT SERVER HANDLERS                               ║
║                                                                          ║
║    handle_clone()  ·  handle_push()  ·  handle_pull()  ·  negotiate()    ║
║                                                                          ║
║    每次操作自动执行:                                                      ║
║    ✓ Scope 权限检查        ✓ 冲突检测 (3-way merge)                      ║
║    ✓ Merkle tree 一致性     ✓ 版本记录 (mut_commits)                     ║
║    ✓ 审计日志 (audit_logs)  ✓ Post-commit hook                          ║
║                                                                          ║
╚════════════════════════════════════════════════════════════════════════════╝
                                        ▲
                                        │
                     ┌──────────────────┴───────────────────────┐
                     │                                          │
                     │          MutEphemeralClient               │
                     │            (in-process)                   │
                     │               +                           │
                     │          protocol_router                  │
                     │          (HTTP wire protocol)             │
                     │                                          │
                     └──────────────────────────────────────────┘
                              ▲          ▲          ▲          ▲
                              │          │          │          │
                     ┌────────┼──────────┼──────────┼──────────┼────────┐
                     │        │          │          │          │        │
                     │  ┌─────┴────┐┌────┴─────┐┌──┴───────┐┌┴──────┐ │
                     │  │   MCP    ││  Agent / ││Datasource││  FS   │ │
                     │  │Endpoints ││ Sandbox  ││Connectors││ Sync  │ │
                     │  └──────────┘└──────────┘└──────────┘└───────┘ │
                     │                                                 │
                     │           OUTBOUND (对外分发)                     │
                     └─────────────────────────────────────────────────┘
```

---

## 两种 MUT 入口

所有 channel 最终都通过以下两种方式之一进入 MUT:

### 1. MutEphemeralClient (in-process)

Server 内部的操作。直接调用 MUT handlers，不走 HTTP。

```python
client = MutEphemeralClient(repo_manager, project_id, auth_context)
files = client.clone()                      # scope 内的文件快照
client.push(modified={"a.md": b"..."})      # 原子提交
```

**使用者**: Web UI, Agent/Sandbox, MCP, Datasource, Ingest, Table CRUD, Seed

### 2. protocol_router (HTTP wire protocol)

外部 client 通过 HTTP 调用。走 Access Key 认证。

```
POST /api/v1/mut/{project_id}/clone
POST /api/v1/mut/{project_id}/push
POST /api/v1/mut/{project_id}/pull
POST /api/v1/mut/{project_id}/negotiate
```

**使用者**: CLI daemon (Filesystem Sync), 远程 MUT client, 任何实现了 MUT protocol 的外部工具

两者殊途同归 —— 都调用同一套 MUT Server Handlers。

---

## 各 Channel 详细设计

### Inbound 1: Web UI

```
人类在浏览器编辑 → HTTP API → tree_router.py → MutEphemeralClient
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户点击保存 |
| auth_context | `{ agent: "user:{uid}", scope: root/rw }` |
| 实现 | `tree_router.py` 的 write/mkdir/mv/rm/restore/bulk-write |
| 读取 | `MutTreeReader` (轻量直读, 不需要 clone) |

### Inbound 2: File Upload (Ingest/ETL)

```
用户上传文件 → ingest API → ETL 处理 → MutEphemeralClient.push()
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户上传文件 / URL 提交 |
| auth_context | `{ agent: "ingest:{task_id}", scope: { path: target_folder, mode: "rw" } }` |
| 实现 | `ingest/router.py`, `ingest/file/jobs/jobs.py` |

### Outbound 1: MCP Endpoints

```
Claude/Cursor → MCP tool_call → MCP Server → InternalAPI → MutEphemeralClient
```

| 项目 | 说明 |
|------|------|
| 触发 | 外部 MCP client 发起 tool_call (ls/cat/write/mkdir/rm) |
| auth_context | `{ agent: "mcp:{endpoint_id}", scope: endpoint 配置的 scope }` |
| 实现 | `mcp_service/tool/fs_tool.py` → `internal/router.py` → MutEphemeralClient |
| 特点 | MCP Server 是独立进程, 通过 HTTP 调 internal API |

### Outbound 2: Agent / Sandbox

```
Agent 执行任务 → clone scope 到 sandbox → 执行 → diff → push back
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户发起 Chat / Scheduler cron |
| auth_context | `{ agent: "agent:{id}", scope: agent 配置的 scope }` |
| 实现 | `agent/service.py` → `sandbox/registry.py` diff_and_writeback → MutEphemeralClient |
| 流程 | clone(scope) → 挂载到 sandbox → Agent 执行 → 读取 sandbox 文件 → push(modified) |

### Outbound 3: Datasource Connectors

```
SyncEngine → connector.fetch(credentials) → FetchResult → MutEphemeralClient.push()
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户手动 refresh / Scheduler cron / Webhook |
| auth_context | `{ agent: "sync:{provider}:{sync_id}", scope: { path: sync.node_id, mode: "rw" } }` |
| 实现 | `datasource/engine.py` SyncEngine |
| 特点 | connector 只实现 `fetch()` 方法, 不知道 MUT 的存在 |

connector 的职责边界:
- **connector.fetch()**: OAuth 认证 → 调外部 API → 返回 FetchResult(content, hash)
- **SyncEngine**: 判断是否有变化(hash 比较) → 序列化 → MutEphemeralClient.push()
- connector 不碰 MUT, SyncEngine 不碰外部 API

### Outbound 4: Filesystem Sync

```
CLI daemon (client) ←→ MUT protocol (HTTP) ←→ MUT tree
```

| 项目 | 说明 |
|------|------|
| 触发 | CLI daemon 的 FSEvent watcher |
| 认证 | Access Key → protocol_router 自动解析 scope |
| 实现 | Client (CLI daemon) 自己做 watch/diff/push/pull |
| 服务端 | 只提供 MUT protocol endpoints, **不管 daemon 逻辑** |

**关键决策**: Filesystem sync 完全由 client 端负责。
- Client 负责: watch 文件变化, diff, clone/push/pull
- Server 负责: 暴露 MUT protocol, 创建 connection + 发放 Access Key
- Server **不做**: watch, diff, sync 状态管理, 文件分发

这和 Git 的模式完全一致: Git server 不管 client 怎么 watch 文件,
client 自己决定什么时候 push。

---

## Scope 分配

每个 channel 通过 auth_context 携带 scope, MUT handlers 自动执行权限检查:

| Channel | agent identity | scope |
|---------|---------------|-------|
| Web UI | `user:{uid}` | `{ path: "", mode: "rw" }` (root, 全量) |
| Agent/Sandbox | `agent:{id}` | agent 配置的 scope (管理员设定) |
| MCP | `mcp:{endpoint_id}` | endpoint 配置的 scope |
| Datasource | `sync:{provider}:{id}` | `{ path: sync.node_id, mode: "rw" }` |
| Filesystem | `fs:{connection_id}` | connection 配置的 scope |
| Ingest/ETL | `ingest:{task_id}` | `{ path: target_folder, mode: "rw" }` |
| Seed/Init | `system:init` | `{ path: "", mode: "rw" }` (系统级) |
| Table CRUD | `table:{user_id}` | `{ path: table_path, mode: "rw" }` |

越权写入会被 MUT handler 在 push 阶段拒绝。

---

## MutWriteService 的最终定位

MutWriteService 降级为内部管理工具 (重命名为 MutAdminService 更合适):

**保留**:
- `init_tree()` — 项目创建时初始化空 Merkle tree (一次性)
- `rollback()` — 管理员回滚到指定版本 (特权操作)
- `get_version_history()` — 只读: 版本历史查询
- `get_version_content()` — 只读: 历史版本内容
- `compute_diff()` — 只读: 版本差异比较
- `_post_commit_delete/move()` — post-commit hook (protocol_router 调用)

**删除** (全部改为 MutEphemeralClient):
- `write_file()`, `delete_file()`, `move_file()`, `move_folder()`
- `mkdir()`, `trash()`, `restore()`, `delete_folder()`

---

## 冲突检测

当多方并发编辑同一文件时:

1. A 和 B 都 `clone()` 得到 version N
2. A `push()` 成功 → version N+1
3. B `push()` 带 `base_version=N` → server 检测到 N < N+1
4. Server 执行 3-way merge: base(N) + server(N+1) + client(B 的修改)
5. merge 成功 → version N+2
6. 有冲突 → push response 中返回 `conflicts` 数组

不管是人类 vs Agent, Agent vs Agent, 还是 Datasource vs Web UI, 都走同一套冲突检测。

---

## 可扩展性

新增一种 channel 只需要:

1. 实现 Trigger + Fetch 逻辑 (channel 自己的事)
2. 构造 auth_context (identity + scope)
3. 调用 MutEphemeralClient (in-process) 或 MUT HTTP protocol (外部)

不需要:
- 修改 MUT 内核
- 修改 Storage Layer
- 写新的 write/delete/move 逻辑
- 理解 Merkle tree / ObjectStore 实现细节

---

## 现状审计：目标架构 vs 当前代码

### 已完成 (✅ 已走 MUT Protocol)

| Channel | 文件 | 说明 |
|---------|------|------|
| Web UI | `tree_router.py` write/mkdir/mv/rm/restore/bulk-write | MutEphemeralClient.clone() → push() |
| MCP | `internal/router.py` write/create/trash/rename/move | MutEphemeralClient.clone() → push() |
| Agent (Chat) | `sandbox/registry.py` diff_and_writeback | MutEphemeralClient.clone() → push() |
| Workspace merge | `workspace/router.py` complete | MutEphemeralClient.clone() → push() |
| Sandbox reaper | `scheduler/jobs/sandbox_reaper.py` | MutEphemeralClient.clone() → push() |
| External MUT | `protocol_router.py` clone/push/pull/negotiate | 原生 MUT handlers |

### 未完成 (❌ 仍在直接调用 MutWriteService，绕过 MUT Protocol)

#### Outbound 2: Agent/Sandbox — Schedule Agent 写回

| 文件 | 行号 | 调用 | 说明 |
|------|------|------|------|
| `agent/service.py` | ~357 | `MutWriteService.write_file()` | Schedule Agent sandbox 执行后逐文件写回 |

**改造方案**: 和 Chat Agent 一样，收集所有修改文件，一次 `MutEphemeralClient.push()` 原子提交。

#### Outbound 3: Datasource Connectors

| 文件 | 行号 | 调用 | 说明 |
|------|------|------|------|
| `datasource/engine.py` | 125 | `mut_write.write_file()` | SyncEngine 写入 fetch 结果 |
| `datasource/service.py` | 235 | `mut_write.write_file()` | 创建 sync 目标文件 |
| `datasource/service.py` | 311 | `mut_write.write_file()` | 拉取后写入 |
| `datasource/router.py` | 521 | `writer.write_file()` | CLI push 已有 sync |
| `datasource/router.py` | 554 | `writer.write_file()` | CLI push 新文件 |

**改造方案**: SyncEngine 和 SyncService 构造 `MutEphemeralClient`，
connector.fetch() 返回结果后通过 `client.push()` 写入。
`get_version_content()` (只读) 保留。

#### Outbound 4: Filesystem Sync — 服务端代码需大幅精简

| 文件 | 写入调用数 | 说明 |
|------|-----------|------|
| `filesystem/service.py` | 6 (write_file ×4, delete_file ×2) | push/delete/confirm_upload 全部直写 |
| `filesystem/folder_access.py` | 2 (write_file) | agent workspace 编辑写回 |
| `filesystem/watcher.py` | 1 (write_file) | 本地文件夹监听后写入 |
| `filesystem/worker.py` | 0 (只读) | 从 MUT 读取到 Lower 缓存 |
| `filesystem/lifecycle.py` | 0 | 仅管理 connection 生命周期 |

**改造方案 (关键决策: client 全权负责)**:
- `service.py` (FolderSyncService): 删除 push/delete/confirm_upload 中的 MutWriteService 调用。
  CLI daemon 应该直接通过 MUT HTTP protocol 的 clone/push/pull 来做同步。
  服务端只保留 pull 的读取能力 (通过 protocol_router 的 /pull endpoint)。
- `folder_access.py` (FolderAccessService): 整个文件可删除。
  Agent workspace 同步应由 agent 自己通过 MutEphemeralClient 或 MUT protocol 处理。
- `watcher.py` (FolderSourceService): 整个文件可删除。
  文件夹 watch 应由 client daemon 负责，不是服务端。
- `worker.py` (SyncWorker): 整个文件可删除。
  Client 自己用 MUT clone/pull 获取文件，不需要服务端帮它同步到本地。
- `lifecycle.py` (OpenClawService): 保留。Connection CRUD 和 Access Key 分发仍需服务端。

#### Inbound 2: Ingest/ETL

| 文件 | 行号 | 调用 | 说明 |
|------|------|------|------|
| `ingest/router.py` | 143, 157 | `write_file()` | 上传 JSON/text 直写 |
| `ingest/file/jobs/jobs.py` | 377, 414, 438 | `write_file()` | ETL 后处理: 创建空节点、写 OCR 结果、挂载输出 |

**改造方案**: 构造 `MutEphemeralClient` (scope=target_folder)，
ETL 完成后用 `client.push()` 写入。

#### 其他: Table CRUD / Seed / Profile

| 文件 | 写入调用数 | 说明 |
|------|-----------|------|
| `content/table/service.py` | 4 (write_file ×3, delete_file ×1) | Table JSON CRUD |
| `platform/project/seed_content.py` | 5 (write_file ×4, mkdir ×1) | 项目初始化种子内容 |
| `platform/profile/service.py` | 4 (write_file ×3, mkdir ×1) | onboarding demo 内容 |
| `connectors/database/service.py` | 1 (write_file) | DB table → JSON |
| `connectors/database/jobs.py` | 1 (write_file) | 定时刷新 DB sync |

**改造方案**: 全部改为 `MutEphemeralClient`。
Seed/Profile 使用 `system:init` scope。
Table 使用 `table:{user_id}` scope。
Database connector 和 Datasource 类似，用 `sync:db:{id}` scope。

#### 管理操作: rollback

| 文件 | 行号 | 调用 | 说明 |
|------|------|------|------|
| `tree_router.py` | 531 | `MutWriteService.rollback()` | 回滚到历史版本 |

**决策**: rollback 作为管理员特权操作，保留在 MutWriteService (MutAdminService) 中。
不走 scope 检查。

---

## 改造状态 (已完成)

所有写入路径已完成从 `MutWriteService` 到 `MutEphemeralClient` 的迁移:

| 改造项 | 状态 | 说明 |
|-------|------|------|
| Web UI (tree_router) | ✅ 已完成 | 所有写入端点使用 MutEphemeralClient |
| MCP (fs_tool) | ✅ 已完成 | 通过 MutEphemeralClient |
| Chat Agent (diff_and_writeback) | ✅ 已完成 | 通过 MutEphemeralClient |
| Workspace (complete_workspace) | ✅ 已完成 | 通过 MutEphemeralClient |
| Schedule Agent 写回 | ✅ 已完成 | 改为 MutEphemeralClient.push() |
| Datasource SyncEngine | ✅ 已完成 | SyncEngine 内部使用 MutEphemeralClient |
| Datasource SyncService | ✅ 已完成 | _ensure_node_exists / _pull_one 使用 MutEphemeralClient |
| Datasource Router (push_file) | ✅ 已完成 | CLI push 使用 MutEphemeralClient |
| Database connector | ✅ 已完成 | save_table / db_sync_job 使用 MutEphemeralClient |
| Ingest (file upload) | ✅ 已完成 | 批量 push 通过 MutEphemeralClient |
| Ingest (ETL postprocess) | ✅ 已完成 | OCR 结果写入使用 MutEphemeralClient |
| Table CRUD | ✅ 已完成 | create/update/delete 使用 MutEphemeralClient |
| Seed content | ✅ 已完成 | 单次 push 所有种子文件 |
| Profile demo | ✅ 已完成 | 单次 push 所有 demo 文件 |
| Filesystem (服务端) | ✅ 已完成 | 精简为 MutEphemeralClient + MutTreeReader |
| rollback | ✅ 保留 | 管理员特权操作，保留在 MutWriteService |
| init_tree | ✅ 保留 | 项目初始化操作，保留在 MutWriteService |
| get_version_history/content/diff | ✅ 保留 | 只读操作，保留在 MutWriteService |

### MutWriteService 保留的操作

MutWriteService 现在仅用于以下管理/只读操作:
- `init_tree()` — 创建项目初始空树
- `rollback()` — 管理员回滚操作
- `get_version_history()` — 读取版本历史
- `get_version_content()` — 读取历史版本内容
- `compute_diff()` — 计算版本差异

所有内容写入 (write_file/delete_file/mkdir) 均已迁移到 MutEphemeralClient。


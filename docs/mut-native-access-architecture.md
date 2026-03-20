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

## 分层架构

PuppyOne 的 MUT 访问严格分为 **三层**：底层 MUT Handlers、中层 MutOps 统一操作层、上层各 Channel 触发层。

```
┌──────────────────────────────────────────────────────────────┐
│                      上层: Channels                           │
│                                                              │
│  各 Channel 只负责:                                           │
│    1. 认证 (JWT / Access Key / 内部调用)                       │
│    2. 触发条件 (人类点击 / cron / webhook / FSEvent)            │
│    3. 调用 MutOps                                             │
│                                                              │
│  ┌────────┐ ┌────────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌──────┐ │
│  │ Web UI │ │ Ingest │ │ MCP  │ │Agent/ │ │ Data │ │  FS  │ │
│  │(Human) │ │(Upload)│ │Endpt │ │Sandbox│ │Source│ │ Sync │ │
│  └───┬────┘ └───┬────┘ └──┬───┘ └──┬────┘ └──┬───┘ └──┬───┘ │
└──────┼──────────┼─────────┼────────┼─────────┼────────┼──────┘
       │          │         │        │         │        │
       ▼          ▼         ▼        ▼         ▼        ▼
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                     中层: MutOps                              │
│                     (唯一的操作入口)                           │
│                                                              │
│  写操作:                                                      │
│    write_file(project, path, content, who)                    │
│    delete(project, paths, who)                                │
│    mkdir(project, path, who)                                  │
│    move(project, old, new, who)                               │
│    bulk_write(project, {path: content}, who)                  │
│                                                              │
│  读操作:                                                      │
│    read_file(project, path) → bytes                           │
│    list_dir(project, path) → [Entry]                          │
│    list_tree(project, path) → [Entry]                         │
│    stat(project, path) → Entry                                │
│    get_version(project) → int                                 │
│                                                              │
│  内部实现:                                                     │
│    写 → MutEphemeralClient (clone → push)                     │
│    读 → MutTreeReader (轻量直读)                               │
│    统一: auth_ctx 构建, async 处理, 异常, 日志                  │
│                                                              │
│  HTTP 外壳 (对 MutOps 的透传，不含业务逻辑):                    │
│    tree_router     — REST API (write/mkdir/mv/rm/ls/cat)      │
│    protocol_router — MUT wire protocol (clone/push/pull)      │
│                                                              │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║                    底层: MUT Server Handlers                  ║
║                                                              ║
║   handle_clone() · handle_push() · handle_pull() · negotiate ║
║                                                              ║
║   每次操作自动执行:                                            ║
║   ✓ Scope 权限检查        ✓ 冲突检测 (3-way merge)            ║
║   ✓ Merkle tree 一致性     ✓ 版本记录 (mut_commits)           ║
║   ✓ 审计日志 (audit_logs)  ✓ Post-commit hook                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

所有 channel **无一例外**都通过 MutOps 操作 MUT tree：

- **内部 channel** (Web UI / Agent / Sandbox / MCP / Datasource / Ingest / Table / Seed / DB)
  在同一进程内直接调用 `MutOps` 的 Python 方法。
- **外部 client** (CLI daemon / 远程 MUT client)
  通过 HTTP 调用 `protocol_router`，而 `protocol_router` 内部同样调用 `MutOps`。

`tree_router` 和 `protocol_router` 都是 MutOps 的 **HTTP 外壳**——前者暴露高层 REST API（write/mkdir/mv/rm），后者暴露底层 MUT 线协议（clone/push/pull/negotiate）。两者本身不包含业务逻辑，只做 HTTP 参数解析 + 认证 + 调用 MutOps。

---

## MutOps — 统一操作层

`MutOps` 是所有 channel 操作 MUT tree 的**唯一入口**（位于 `mut_engine/ops.py`）。

### 为什么需要这一层

不同 channel（Web UI、Agent、Datasource、Ingest、Table 等）对 MUT tree 的操作本质相同——都是读文件、写文件、删文件、创建目录。区别只有：

| 维度 | 变化的部分 |
|------|----------|
| 谁触发的 | 人类 / 定时器 / webhook / CLI daemon |
| 认证方式 | JWT / Access Key / 内部系统调用 |
| scope 范围 | root / 某个子路径 |
| 操作类型 | write / delete / mkdir / move / bulk_write |

操作本身的逻辑（创建 client → clone → 构建 snapshot → push → 处理冲突 → 返回版本号）完全一样。`MutOps` 把这些固定逻辑抽为一个薄层，避免每个 channel 自己重新实现。

### 接口设计

```python
class MutOps:
    """统一的 MUT tree 操作入口。

    所有 channel (Web UI / Agent / MCP / Datasource / Ingest / Table)
    通过此类操作 MUT tree。channel 不直接接触 MutEphemeralClient。
    """

    def __init__(self, repo_manager: MutRepoManager):
        self._repos = repo_manager
        self._reader = MutTreeReader(repo_manager)

    # ── 写操作 (clone → modify → push) ──

    async def write_file(
        self, project_id: str, path: str, content: bytes,
        who: str, scope: str = "", message: str = "",
    ) -> WriteResult:
        """写入单个文件。"""

    async def delete(
        self, project_id: str, paths: list[str],
        who: str, scope: str = "", message: str = "",
    ) -> WriteResult:
        """删除一个或多个文件/目录。"""

    async def mkdir(
        self, project_id: str, path: str,
        who: str, scope: str = "", message: str = "",
    ) -> WriteResult:
        """创建目录 (写入 .keep)。"""

    async def move(
        self, project_id: str, old_path: str, new_path: str,
        who: str, scope: str = "", message: str = "",
    ) -> WriteResult:
        """移动/重命名。"""

    async def bulk_write(
        self, project_id: str, files: dict[str, bytes],
        who: str, scope: str = "",
        deleted: list[str] | None = None,
        message: str = "",
    ) -> WriteResult:
        """批量写入 + 批量删除 (单次 push)。"""

    async def trash(
        self, project_id: str, path: str,
        who: str, scope: str = "", message: str = "",
    ) -> WriteResult:
        """移入 .trash (软删除)。"""

    async def restore(
        self, project_id: str, trash_path: str, original_path: str,
        who: str, scope: str = "", message: str = "",
    ) -> WriteResult:
        """从 .trash 恢复。"""

    # ── 读操作 (MutTreeReader 直读) ──

    def read_file(self, project_id: str, path: str) -> bytes:
        """读取文件内容。"""

    def list_dir(self, project_id: str, path: str = "") -> list[MutEntry]:
        """列出目录内容。"""

    def list_tree(self, project_id: str, path: str = "", max_depth: int = -1) -> list[MutEntry]:
        """递归列出目录树。"""

    def stat(self, project_id: str, path: str) -> MutEntry | None:
        """获取文件/目录信息。"""

    def get_version(self, project_id: str) -> int:
        """获取当前版本号。"""
```

### 内部实现

所有写操作的内部流程统一为：

```python
async def _do_write(self, project_id, who, scope, fn) -> WriteResult:
    client = MutEphemeralClient(self._repos, project_id, {
        "agent": who,
        "_scope": {"id": who, "path": scope, "exclude": [], "mode": "rw"},
    })
    files = await asyncio.to_thread(client.clone)
    modified, deleted = fn(files)  # channel 提供的变换函数
    result = await asyncio.to_thread(client.push, modified=modified, deleted=deleted, ...)
    return WriteResult(version=result["version"], ...)
```

- 统一用 `asyncio.to_thread` 处理阻塞的 MUT 调用
- 统一构建 `auth_context` 并校验
- 统一异常处理和日志
- 统一返回 `WriteResult` (version, merged, conflicts)

### DI 注入

```python
# FastAPI 路由中使用
def get_mut_ops(repo_manager: MutRepoManager = Depends(get_repo_manager)) -> MutOps:
    return MutOps(repo_manager)

# 非请求上下文 (Job / Worker) 使用
def create_mut_ops() -> MutOps:
    return MutOps(get_repo_manager_standalone())
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

## 各 Channel 详细设计

### Inbound 1: Web UI

```
人类在浏览器编辑 → HTTP API → tree_router.py → MutOps
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户点击保存 |
| who | `user:{uid}` |
| scope | `""` (root, 全量 rw) |
| 实现 | `tree_router.py` 的 write/mkdir/mv/rm/restore/bulk-write → `MutOps` |
| 读取 | `MutOps.read_file / list_dir / list_tree` (内部走 `MutTreeReader`) |

`tree_router.py` 是 MutOps 的 HTTP 外壳，本身不包含业务逻辑：

```python
@router.post("/{project_id}/write")
async def write_file(project_id, body, ops: MutOps = Depends(get_mut_ops), ...):
    result = await ops.write_file(project_id, body.path, content_bytes, who=f"user:{user.id}")
    return ApiResponse.success(data=result)
```

### Inbound 2: File Upload (Ingest/ETL)

```
用户上传文件 → ingest API → ETL 处理 → MutOps.write_file / bulk_write
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户上传文件 / URL 提交 |
| who | `ingest:{task_id}` |
| scope | `{ path: target_folder }` |
| 实现 | `ingest/router.py` → `MutOps.bulk_write()`; ETL job → `MutOps.write_file()` |

### Inbound 3: Table CRUD

```
前端操作表格 → table API → table/service.py → MutOps.write_file / delete
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户在 UI 中操作 JSON 表格 (行列增删改) |
| who | `table:{user_id}` |
| scope | `{ path: table_path }` |
| 实现 | `content/table/service.py` → `MutOps.write_file()` / `MutOps.delete()` |

### Outbound 1: MCP Endpoints

```
Claude/Cursor → MCP tool_call → MCP Server → InternalAPI → MutOps
```

| 项目 | 说明 |
|------|------|
| 触发 | 外部 MCP client 发起 tool_call (ls/cat/write/mkdir/rm) |
| who | `mcp:{endpoint_id}` |
| scope | endpoint 配置的 scope |
| 实现 | `mcp_service/tool/fs_tool.py` → `internal/router.py` → `MutOps` |
| 特点 | MCP Server 是独立进程, 通过 HTTP 调 internal API |

### Outbound 2: Agent / Sandbox

```
Agent 执行任务 → MutOps 读取 scope 文件 → 挂载到 sandbox → 执行 → diff → MutOps.bulk_write
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户发起 Chat / Scheduler cron |
| who | `agent:{id}` |
| scope | agent 配置的 scope |
| 实现 | `agent/service.py` + `sandbox/registry.py` → `MutOps` |
| 流程 | `MutOps.read_*` 读 scope 文件 → 挂载到 sandbox → Agent 执行 → diff → `MutOps.bulk_write()` |

Sandbox 不需要直接操作底层 MUT handlers。对 Sandbox 来说，执行完之后写回只是一次普通的 `bulk_write`——和前端批量编辑多个文件没有本质区别。

### Outbound 3: Datasource Connectors

```
SyncEngine → connector.fetch(credentials) → FetchResult → MutOps.write_file
```

| 项目 | 说明 |
|------|------|
| 触发 | 用户手动 refresh / Scheduler cron / Webhook |
| who | `sync:{provider}:{sync_id}` |
| scope | `{ path: sync.node_id }` |
| 实现 | `datasource/engine.py` SyncEngine → `MutOps.write_file()` |
| 特点 | connector 只实现 `fetch()` 方法, 不知道 MUT 的存在 |

connector 的职责边界:
- **connector.fetch()**: OAuth 认证 → 调外部 API → 返回 FetchResult(content, hash)
- **SyncEngine**: 判断是否有变化(hash 比较) → 序列化 → `MutOps.write_file()`
- connector 不碰 MUT, SyncEngine 不碰外部 API

### Outbound 4: Filesystem Sync

```
CLI daemon (client) → HTTP → protocol_router → MutOps → MUT handlers
```

| 项目 | 说明 |
|------|------|
| 触发 | CLI daemon 的 FSEvent watcher |
| 认证 | Access Key → protocol_router 自动解析 scope |
| 实现 | Client (CLI daemon) 调 `protocol_router` HTTP 端点，server 端由 MutOps 处理 |
| 服务端 | `protocol_router` (MutOps 的 HTTP 外壳) + connection 生命周期管理 |

**关键决策**: Filesystem sync 完全由 client 端负责。

- Client 负责: watch 文件变化, diff, clone/push/pull
- Server 负责: 暴露 `protocol_router` (MutOps 的 HTTP 外壳), 创建 connection + 发放 Access Key
- Server **不做**: watch, diff, sync 状态管理, 文件分发, 任何 daemon 逻辑

Filesystem Sync 和其他 channel 的唯一区别是**物理位置**——CLI daemon 运行在用户本机，所以只能通过 HTTP 调用 MutOps，而不是 in-process 调用。但走的是同一个 MutOps，同一套 MUT handlers。

这和 Git 的模式完全一致: Git server 不管 client 怎么 watch 文件,
client 自己决定什么时候 push。

### 内部: Seed / Profile Demo

```
项目创建 / 用户注册 → MutOps.bulk_write
```

| 项目 | 说明 |
|------|------|
| 触发 | 项目初始化 / 用户 onboarding |
| who | `system:seed` / `system:onboarding` |
| scope | `""` (root) |
| 实现 | `project/seed_content.py`, `profile/service.py` → `MutOps.bulk_write()` |

### 内部: Database Connector

```
DB sync job → 拉取外部数据库数据 → MutOps.write_file
```

| 项目 | 说明 |
|------|------|
| 触发 | 手动 / cron |
| who | `db_connector:{connection_id}` |
| scope | `{ path: target_path }` |
| 实现 | `database/service.py`, `database/jobs.py` → `MutOps.write_file()` |

---

## MutOps 的两种 HTTP 外壳

MutOps 通过两个 router 对外暴露 HTTP 接口。两者都是 MutOps 的薄外壳，不含业务逻辑：

### 1. tree_router — 高层 REST API

面向前端和内部服务，提供类 POSIX 的文件操作：

```
POST /api/v1/tree/{project_id}/write     → MutOps.write_file()
POST /api/v1/tree/{project_id}/mkdir     → MutOps.mkdir()
POST /api/v1/tree/{project_id}/mv        → MutOps.move()
POST /api/v1/tree/{project_id}/rm        → MutOps.trash() / delete()
POST /api/v1/tree/{project_id}/restore   → MutOps.restore()
POST /api/v1/tree/{project_id}/bulk-write → MutOps.bulk_write()
GET  /api/v1/tree/{project_id}/ls        → MutOps.list_dir()
GET  /api/v1/tree/{project_id}/cat       → MutOps.read_file()
GET  /api/v1/tree/{project_id}/tree      → MutOps.list_tree()
GET  /api/v1/tree/{project_id}/stat      → MutOps.stat()
```

**使用者**: Web UI (前端), internal API (MCP Server), 任何需要高层文件操作的 HTTP 调用方

### 2. protocol_router — MUT 线协议

面向外部 MUT client，提供原生 clone/push/pull/negotiate：

```
POST /api/v1/mut/{project_id}/clone      → MutOps 内部的 handle_clone
POST /api/v1/mut/{project_id}/push       → MutOps 内部的 handle_push
POST /api/v1/mut/{project_id}/pull       → MutOps 内部的 handle_pull
POST /api/v1/mut/{project_id}/negotiate  → MutOps 内部的 handle_negotiate
```

**使用者**: CLI daemon (Filesystem Sync), 远程 MUT client, 任何实现了 MUT protocol 的外部工具

两者殊途同归 —— 都通过 MutOps 调用同一套 MUT Server Handlers。

---

## Scope 分配

每个 channel 通过 `who` + `scope` 参数传入 MutOps，最终转化为 MUT auth_context:

| Channel | who | scope |
|---------|-----|-------|
| Web UI | `user:{uid}` | `""` (root, 全量 rw) |
| Agent/Sandbox | `agent:{id}` | agent 配置的 scope path |
| MCP | `mcp:{endpoint_id}` | endpoint 配置的 scope path |
| Datasource | `sync:{provider}:{id}` | `sync.node_id` (挂载路径) |
| Filesystem | `fs:{connection_id}` | connection 配置的 scope path |
| Ingest/ETL | `ingest:{task_id}` | target_folder |
| Table CRUD | `table:{user_id}` | table_path |
| DB Connector | `db_connector:{id}` | target_path |
| Seed/Init | `system:seed` | `""` (root, 系统级) |

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

**不包含任何内容写入方法**。所有写入通过 MutOps。

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
这是因为所有写入都经过 MutOps → MutEphemeralClient → handle_push，没有旁路。

---

## 可扩展性

新增一种 channel 只需要:

1. 实现 Trigger + Fetch 逻辑 (channel 自己的事)
2. 在 router 或 service 中调用 `MutOps.write_file()` / `MutOps.bulk_write()`，传入 `who` 和 `scope`
3. 完成

不需要:
- 修改 MUT 内核
- 修改 Storage Layer
- 自己创建 MutEphemeralClient 或构建 auth_context
- 处理 asyncio / clone / push / snapshot 构建
- 理解 Merkle tree / ObjectStore 实现细节

---

## 模块职责总结

| 模块 | 职责 | 不做什么 |
|------|------|---------|
| `mut_engine/ops.py` (MutOps) | 所有 channel 的读写统一入口 | 不管认证、不管触发条件 |
| `mut_engine/tree_reader.py` (MutTreeReader) | 轻量读取 Merkle tree | 不做写入；被 MutOps 内部使用 |
| `mut_engine/ephemeral_client.py` (MutEphemeralClient) | clone → push 协议封装 | 不对外暴露，只被 MutOps 内部使用 |
| `mut_engine/tree_router.py` | MutOps 的 REST HTTP 外壳 | 不含业务逻辑，不直接创建 client |
| `mut_engine/protocol_router.py` | MutOps 的 MUT 线协议 HTTP 外壳 | 不含业务逻辑，不直接创建 client |
| `mut_engine/write_service.py` (MutAdminService) | init_tree / rollback / 历史查询 | 不做常规写入 |
| `connectors/*/service.py` | Channel 的触发 + 认证逻辑 | 不直接操作 MUT，只调 MutOps |
| `connectors/*/router.py` | HTTP 端点 + 参数校验 | 不直接操作 MUT，只调 MutOps |

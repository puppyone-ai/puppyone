# MUT-Native Architecture — PuppyOne 终态设计

> **设计原则：MUT 是 Git，PuppyOne 是 GitHub。**
>
> - MUT 是所有内容的 source of truth
> - PuppyOne 提供 Web UI、REST API、MCP 工具、连接器 — 全部基于 MUT
> - `mut push` 和 Web 编辑器都创建 MUT commit
> - `content_nodes` 是 read index（类似 GitHub 的文件搜索索引）— 不存内容本身
> - PuppyOne 不用 MUT 自带的 `ServerRepo`（依赖本地文件系统），而是实现一个 S3/PG 后端的适配器

---

## 1. 分层架构

```
┌─────────────────── Layer 0: Storage ──────────────────────┐
│  S3 ObjectStore    PostgreSQL         Redis               │
│  (blobs+trees)     (history/audit/    (locks/cache)       │
│                     metadata index)                       │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────── Layer 1: MUT Core ────────────────────┐
│  ObjectStore ← S3StorageBackend                           │
│  tree.read_tree / write_blob / scan_dir                   │
│  merge.three_way_merge / ConflictResolver                 │
│  diff.diff_trees                                          │
│  server.graft.graft_subtree                               │
│  HistoryManager ← SupabaseHistoryManager                  │
│  AuditLog ← SupabaseAuditManager                         │
│  ScopeManager ← SupabaseScopeManager (新)                 │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────── Layer 2: PuppyOne Server Core ────────┐
│  MutRepoManager        (per-project repo 工厂)            │
│  MutWriteService       (唯一写入入口)                      │
│  IndexSync             (MUT tree → content_nodes 同步)    │
│  PuppyOneServerRepo    (ServerRepo 适配器，S3/PG 后端)     │
│  PuppyOneAuthenticator (JWT/AccessKey → agent+scope)      │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────── Layer 3: Transport Protocols ─────────┐
│                                                           │
│  MUT Protocol    MCP Protocol    REST API    Internal API │
│  /mut/{pid}/*    /mcp            /api/v1/*   /internal/*  │
│  clone/push/     ls/cat/write    CRUD        server-side  │
│  pull/negotiate                                           │
└───┬──────────────────┬──────────────┬──────────┬─────────┘
    │                  │              │          │
    ▼                  ▼              ▼          ▼
  有文件系统的客户端   AI 工具        Web UI    连接器/任务
  (本地/沙盒/Agent)   (Cursor等)     (Next.js)  (Gmail等)
```

### 各层职责

| Layer | 职责 | 实现 |
|-------|------|------|
| **Layer 0** | 持久化存储 | S3（blobs + Merkle trees）、PostgreSQL（history/audit/metadata）、Redis（锁/缓存） |
| **Layer 1** | MUT 版本引擎 | MUT 库的 core 模块 + PuppyOne 实现的云端后端 |
| **Layer 2** | 平台核心 | per-project repo 管理、写入入口、索引同步、协议适配、认证 |
| **Layer 3** | 传输协议 | MUT HTTP、MCP、REST API、Internal API — 四种 transport，同一个 MUT Core |

---

## 2. Connection → Protocol 映射

**核心原则：有文件系统的客户端用 MUT 协议，无文件系统的客户端通过 API 在服务端产生 MUT commit。**

| Connection 类型 | Transport | 工作方式 | GitHub 类比 |
|---|---|---|---|
| **Filesystem（本地文件夹）** | MUT HTTP | `mut clone` → daemon 监听变更 → `mut push/pull` 循环 | Developer 用 `git clone/push/pull` |
| **Sandbox（Docker/E2B）** | MUT HTTP | 容器内 `mut clone` → agent 操作 → `mut commit && mut push` | GitHub Actions runner |
| **Standalone Agent** | MUT HTTP | `mut clone --credential <key>` → 工作 → `mut push` | Bot 用 Git 操作 |
| **MCP Endpoint** | MCP | MCP tools → Internal API → `MutWriteService` | GitHub App 用 REST API |
| **Datasource（SaaS）** | Internal | 服务端 fetch → `MutWriteService.write_file()` | GitHub webhook 写入 |
| **Web Frontend** | REST | 编辑 → `PUT /api/v1/nodes/{id}` → `MutWriteService` | GitHub Web Editor |

**所有 transport 最终都产生 MUT commit。区别只在于传输方式。**

---

## 3. 关键组件设计

### 3.1 PuppyOneServerRepo — 核心适配器

MUT 原生的 `ServerRepo` 依赖本地文件系统（维护 `current/` 目录存放文件）。PuppyOne 不需要 `current/` — 直接操作 S3 中的 Merkle tree。

```python
class PuppyOneServerRepo:
    """
    适配 MUT ServerRepo 接口到 S3/PG 后端。

    关键区别：
    - 没有 current/ 目录
    - list_scope_files() 通过遍历 S3 中的 Merkle tree 重建
    - write_scope_files() 是 no-op（IndexSync 替代文件系统同步）
    """

    def __init__(self, project_id, store, history, audit, scopes):
        self.project_id = project_id
        self.store = store           # ObjectStore(S3StorageBackend)
        self.history = history       # SupabaseHistoryManager
        self.audit = audit           # SupabaseAuditManager
        self.scopes = scopes         # SupabaseScopeManager

    async def async_list_scope_files(self, scope) -> dict[str, bytes]:
        """从 Merkle tree 重建 scope 内的文件列表（替代遍历 current/ 目录）"""
        root_hash = await self.async_get_root_hash()
        if not root_hash:
            return {}
        return await self._walk_tree(root_hash, scope["path"], scope.get("exclude", []))

    async def async_write_scope_files(self, scope, files):
        """No-op: PuppyOne 不维护 current/ 目录，IndexSync 负责更新 content_nodes"""
        pass

    async def async_build_scope_tree(self, scope) -> str:
        """从全量 Merkle tree 中提取 scope 子树的 hash"""
        root_hash = await self.async_get_root_hash()
        if not root_hash:
            return self.store.put(b'{}')
        return self._extract_subtree_hash(root_hash, scope["path"])

    async def async_delete_scope_file(self, scope, rel_path):
        """No-op: 删除通过 tree 操作实现，不需要文件系统"""
        pass
```

**与原生 ServerRepo 的接口对应：**

| ServerRepo 方法 | PuppyOneServerRepo 实现 |
|---|---|
| `list_scope_files(scope)` | 遍历 S3 Merkle tree，按 scope 路径过滤 |
| `write_scope_files(scope, files)` | No-op（IndexSync 替代） |
| `build_scope_tree(scope)` | 从 root tree 提取 scope 子树 hash |
| `build_full_tree()` | 直接返回 root hash |
| `delete_scope_file(scope, path)` | No-op（通过 tree 操作） |
| `store` | ObjectStore(S3StorageBackend) — 已有 |
| `history` | SupabaseHistoryManager — 已有 |
| `audit` | SupabaseAuditManager — 已有 |
| `scopes` | SupabaseScopeManager — 新建 |
| `acquire_lock / release_lock` | asyncio.Lock（单实例）/ Redis Lock（多实例） |

### 3.2 PuppyOneAuthenticator — 认证适配

```python
from mut.server.auth.base import Authenticator

class PuppyOneAuthenticator(Authenticator):
    """
    将 PuppyOne 的认证体系映射到 MUT 的 (agent, scope) 模型。

    JWT → user + full project scope
    Access Key → agent/connection + restricted scope
    """

    async def authenticate(self, headers: dict, body: dict) -> dict:
        token = self._extract_bearer(headers)

        if self._is_jwt(token):
            user_id = verify_jwt(token)
            return {
                "agent": f"user:{user_id}",
                "_scope": {"path": "", "exclude": []}  # 全量访问
            }

        # Access Key → 从 connections 表获取 scope
        conn = await self._connections_repo.get_by_access_key(token)
        scope = conn.config.get("scope", {"path": "", "exclude": []})
        return {
            "agent": conn.id,
            "_scope": scope
        }
```

### 3.3 SupabaseScopeManager — Scope 管理

```python
class SupabaseScopeManager:
    """
    Scope 存储在 connections.config JSONB 中。
    每个 connection (agent/sync/sandbox) 有自己的 scope。

    Scope 定义了 agent 能访问的路径范围：
      {"path": "docs/", "exclude": ["docs/private/"]}
    """

    async def get(self, scope_id: str) -> dict:
        conn = await self._repo.get_by_id(scope_id)
        return conn.config.get("scope", {"path": "", "exclude": []})

    async def add(self, scope_id: str, path: str, exclude: list = None) -> dict:
        scope = {"path": path, "exclude": exclude or []}
        await self._repo.update_config(scope_id, {"scope": scope})
        return scope
```

### 3.4 MUT HTTP Routes — FastAPI 端点

```python
# backend/src/mut_core/protocol_router.py

@router.post("/mut/{project_id}/clone")
async def mut_clone(project_id: str, request: Request, auth = Depends(mut_auth)):
    repo = repo_manager.get_server_repo(project_id)
    body = await request.json()
    result = await handle_clone(repo, auth, body)
    return JSONResponse(result)

@router.post("/mut/{project_id}/push")
async def mut_push(project_id: str, request: Request, auth = Depends(mut_auth)):
    repo = repo_manager.get_server_repo(project_id)
    body = await request.json()
    result = await handle_push(repo, auth, body)
    # Push 后触发 IndexSync
    await index_sync.sync_changeset(project_id, result["changes"], ...)
    return JSONResponse(result)

@router.post("/mut/{project_id}/pull")
async def mut_pull(project_id: str, request: Request, auth = Depends(mut_auth)):
    repo = repo_manager.get_server_repo(project_id)
    body = await request.json()
    result = await handle_pull(repo, auth, body)
    return JSONResponse(result)

@router.post("/mut/{project_id}/negotiate")
async def mut_negotiate(project_id: str, request: Request, auth = Depends(mut_auth)):
    repo = repo_manager.get_server_repo(project_id)
    body = await request.json()
    result = await handle_negotiate(repo, auth, body)
    return JSONResponse(result)
```

---

## 4. 各 Connection 的同步流程

### 4.1 Filesystem（本地文件夹同步）

**替换 OpenClaw 协议，改用 MUT 原生 clone/push/pull。**

```
当前 (OpenClaw — 自定义 REST):
  CLI daemon → POST /filesystem/{id}/push (自定义 JSON)
             → GET  /filesystem/{id}/pull?cursor=N
             → GET  /filesystem/{id}/changes (long-poll)

终态 (MUT Protocol — 标准协议):
  CLI daemon → mut push (POST /mut/{project_id}/push)
             → mut pull (POST /mut/{project_id}/pull)
```

**CLI daemon 变成极简循环：**

```bash
# puppyone access ~/my-folder --project proj_123
mut clone https://api.puppyone.ai/api/v1/mut/proj_123 \
  --credential $ACCESS_KEY --dir ~/my-folder

while true; do
  # 监听本地文件变更
  inotifywait -r ~/my-folder
  cd ~/my-folder
  mut commit -m "auto-sync"
  mut push
  mut pull
done
```

### 4.2 Sandbox（Docker/E2B）

```python
# 启动
async def start_sandbox(project_id, scope_key):
    container = create_container()
    container.exec(
        f"mut clone {MUT_SERVER_URL}/mut/{project_id} "
        f"--credential {scope_key} --dir /workspace"
    )
    return container

# Agent 工作中：直接在 /workspace 下读写文件

# 结束（write-back）
async def stop_sandbox(container):
    container.exec(
        "cd /workspace && mut commit -m 'agent changes' && mut push"
    )
    # 服务端 handle_push 自动触发 IndexSync
```

### 4.3 Standalone Agent

```bash
# Agent 获取 access key 后
mut clone https://api.puppyone.ai/api/v1/mut/proj_123 \
  --credential $AGENT_ACCESS_KEY --dir ./workspace

# Agent 操作文件
echo "# Meeting Notes" > ./workspace/notes.md

# 提交并推送
mut commit -m "added meeting notes" -w agent_001
mut push

# 拉取其他 agent 的变更
mut pull
```

### 4.4 MCP Endpoint

MCP 客户端（Claude Desktop、Cursor）没有文件系统，通过 MCP 工具实时操作：

```
MCP Client → MCP Server (/mcp)
  │
  ├── tool: ls("/docs")
  │     → GET /internal/nodes/resolve-path → content_nodes (PG)
  │
  ├── tool: cat("/docs/notes.md")
  │     → GET /internal/nodes/{id}/content → ObjectStore.get(hash) (S3)
  │
  └── tool: write("/docs/notes.md", "new content")
        → PUT /internal/nodes/{id}/content
        → MutWriteService.write_file()
        → MUT commit → IndexSync → content_nodes 更新
```

每次 `write` 都产生一个 MUT commit。

### 4.5 Datasource（SaaS 连接器）

服务端操作，无客户端参与：

```
Scheduler/Trigger → DatasourceEngine.run()
  │
  ├── fetch_from_api() (Gmail/GitHub/Notion/...)
  │
  └── MutWriteService.write_file(project_id, path, content_bytes, "connector:gmail")
      → MUT commit → IndexSync → content_nodes 更新
```

### 4.6 Web Frontend

```
Browser → REST API
  │
  ├── 浏览文件树: GET /api/v1/nodes/ → content_nodes (PG, 毫秒级)
  │
  ├── 读取内容: GET /api/v1/nodes/{id}/content → ObjectStore.get(hash) (S3)
  │
  └── 保存编辑: PUT /api/v1/nodes/{id}
      → MutWriteService.write_file()
      → MUT commit → IndexSync → content_nodes 更新
```

---

## 5. 数据流总图

```
写入流（所有入口最终都产生 MUT commit）:

  MUT Protocol ─┐
  MCP Tools ────┤
  REST API ─────┤──→ MutWriteService.write_file()
  Internal API ─┤         │
  Datasource ───┘         ▼
                    ┌─ MUT Core ─────────────────────────┐
                    │  1. ObjectStore.put(bytes) → hash   │
                    │  2. 修改 Merkle tree                │
                    │  3. graft_subtree → new root hash   │
                    │  4. three_way_merge (冲突时)        │
                    │  5. history.record(version, changes)│
                    │  6. audit.record(event)             │
                    └────────────┬────────────────────────┘
                                 │
                                 ▼
                    ┌─ IndexSync ─────────────────────────┐
                    │  增量更新 content_nodes (PG)         │
                    │  触发 changelog / WebSocket          │
                    └─────────────────────────────────────┘


读取流:

  前端/API ──┬── 树浏览 ────→ content_nodes (PG, 毫秒级)
             ├── 内容读取 ──→ ObjectStore.get(hash) (S3)
             ├── 版本历史 ──→ mut_commits (PG)
             └── Diff ──────→ mut.core.diff.diff_trees()
```

---

## 6. content_nodes 最终角色

```
MUT Repo (S3)              content_nodes (PG)
─────────────              ──────────────────
Source of Truth             Read Index (从 MUT 同步)
Merkle tree + blobs         Metadata only
  │                           │
  ├── 内容 (bytes)            ├── id, name, type, project_id
  ├── 树结构 (hash tree)      ├── mut_path (从 MUT 同步)
  ├── 版本 (commit chain)     ├── content_hash (从 MUT 同步)
  └── 完整性 (root hash)      ├── current_version (从 MUT 同步)
                              └── 业务字段 (created_by, mime_type, ...)

任何写入 → MUT commit → IndexSync → content_nodes 自动更新
content_nodes 可以随时从 MUT tree 完整重建
```

---

## 7. 需要新建/修改的组件

| 组件 | 状态 | 工作内容 |
|------|------|----------|
| **`PuppyOneServerRepo`** | 新建 | 适配 `ServerRepo` 接口到 S3/PG，实现 `list_scope_files`（遍历 Merkle tree）、Lock 等 |
| **`PuppyOneAuthenticator`** | 新建 | JWT/AccessKey → (agent_id, scope) |
| **`SupabaseScopeManager`** | 新建 | Scope CRUD，基于 `connections.config` JSONB |
| **MUT Protocol Router** | 新建 | 4 个端点：`/mut/{project_id}/clone\|push\|pull\|negotiate` |
| **IndexSync push hook** | 改造 | `handle_push` 后自动调用 `sync_changeset` |
| **OpenClaw → MUT** | 替换 | CLI daemon 改用 `mut clone/push/pull` |
| **Sandbox bootstrap** | 替换 | 容器内改用 `mut clone` 加载文件，`mut push` 写回 |
| **`MutWriteService`** | 已有 | 保持不变，REST/MCP/Internal 继续通过它写入 |
| **`MutRepoManager`** | 已有 | 扩展，新增 `get_server_repo()` 返回 `PuppyOneServerRepo` |
| **`MutCompatService`** | 已有 | 最终被 `MutWriteService` 完全替代后可删除 |

---

## 8. 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| MUT 协议服务端 | 适配 `ServerRepo` 接口，复用 MUT `handlers` | 复用已验证的协议逻辑，确保 `mut` CLI 兼容 |
| `current/` 目录 | 不维护 | PuppyOne 是无状态云端，直接操作 S3 Merkle tree |
| OpenClaw 协议 | 替换为 MUT 协议 | 统一协议，不再维护两套同步逻辑 |
| MCP/REST 写入 | 继续用 `MutWriteService` | 无文件系统的客户端不需要 clone/push/pull |
| Scope 管理 | `SupabaseScopeManager` | 从 `connections.config` 读取，与现有权限体系集成 |
| 二进制大文件 | 暂时作为 MUT blob 存 S3 | MVP 够用，后续可加 MUT LFS |
| 并发锁 | 单实例 asyncio.Lock → 生产 Redis Lock | 按部署规模升级 |

---

## 9. 与现有 Roadmap 的对应关系

| Roadmap Phase | 状态 | 与本文档的关系 |
|---------------|------|---------------|
| Phase 1: 集成基础 | ✅ 已完成 | Layer 0 + Layer 1 基础 |
| Phase 2: 写入路径 | ✅ 已完成 | `MutWriteService` + `MutCompatService` |
| Phase 3: 读取路径 | ✅ 已完成 | content 从 S3 读取，`preview_json/preview_md` 已删除 |
| Phase 4: MUT 协议端点 | **已完成** | `PuppyOneServerRepo` + MUT HTTP Routes + Authenticator |
| Phase 5: Scope + 清理 | 待做 | `SupabaseScopeManager` + 删除 OpenClaw + 清理旧代码 |

---

## 10. 预期收益

| 维度 | 当前 | 终态 |
|------|------|------|
| **同步协议数量** | 4 套（OpenClaw、Sandbox API、MCP、Datasource） | 2 套（MUT HTTP + REST/MCP API） |
| **Agent 交互** | MCP 逐文件操作 only | MUT clone/push/pull（批量）+ MCP（实时） |
| **冲突解决** | 各协议自己实现 | MUT 三方合并引擎统一处理 |
| **离线支持** | 无 | Agent 可 clone 后离线工作，reconnect 后 push |
| **Sandbox 文件管理** | 手动加载 + diff write-back | `mut clone` → work → `mut push` |
| **本地同步** | OpenClaw 自定义协议 | 标准 `mut` CLI 命令 |
| **CLI 工具** | `puppyone` CLI + 自定义 daemon | `mut` CLI（标准工具）+ 轻量 daemon |
